import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import pg from "pg";
import { poolConfig } from "../src/db-pool.js";
import { createApp } from "../src/app.js";

test("poolConfig: 유한한 연결 대기 시간과 운영 기본값, 환경변수 덮어쓰기", () => {
  assert.deepEqual(poolConfig({}), { ssl: false, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, query_timeout: 15_000 });
  const tuned = poolConfig({ PGSSLMODE: "require", PG_POOL_MAX: "4", PG_IDLE_TIMEOUT_MS: "1000", PG_CONNECTION_TIMEOUT_MS: "2500", PG_QUERY_TIMEOUT_MS: "3000" });
  assert.deepEqual(tuned, { ssl: { rejectUnauthorized: false }, max: 4, idleTimeoutMillis: 1000, connectionTimeoutMillis: 2500, query_timeout: 3000 });
  // 0(=pg의 무한 대기)이나 잘못된 값은 받아들이지 않고 기본값을 쓴다.
  for (const bad of ["0", "-1", "abc", "1.5", ""])
    assert.equal(poolConfig({ PG_CONNECTION_TIMEOUT_MS: bad }).connectionTimeoutMillis, 5_000, bad);
});

// 연결은 받아 주지만 PostgreSQL 프로토콜로 응답하지 않는 서버(멈춘 DB·막힌 네트워크 흉내).
async function blackhole(t) {
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on("error", () => {}); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { for (const s of sockets) s.destroy(); server.close(); });
  return server.address().port;
}

async function startWithRealPool(t, port, timeoutMs) {
  const db = new pg.Pool({
    ...poolConfig({ PG_CONNECTION_TIMEOUT_MS: String(timeoutMs), PG_POOL_MAX: "1" }),
    host: "127.0.0.1", port, user: "revcc", password: "unused", database: "revcc",
  });
  db.on("error", () => {});
  const app = createApp({ db, redis: { get: async () => JSON.stringify({ id: 7, username: "member" }) } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => { server.closeAllConnections(); server.close(); await db.end().catch(() => {}); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("DB가 응답하지 않으면 요청은 연결 대기 시간 뒤 503으로 끝난다(무한 대기 없음)", async (t) => {
  const base = await startWithRealPool(t, await blackhole(t), 500);
  for (const [path, headers] of [
    ["/api/board/posts", {}], // 비로그인 목록 조회
    ["/api/board/posts", { Cookie: `REVCC_SESSION=${"u".repeat(43)}` }], // 로그인 사용자(세션 재검증 쿼리)
    ["/health", {}],
  ]) {
    const started = Date.now();
    const res = await fetch(base + path, { headers, signal: AbortSignal.timeout(5_000) });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 503, path);
    assert.ok(elapsed >= 400 && elapsed < 3_000, `${path}: ${elapsed}ms`);
    const body = await res.text();
    assert.ok(!/127\.0\.0\.1|timeout exceeded/i.test(body), `내부 오류가 응답에 노출되면 안 된다: ${body}`);
  }
});

test("풀이 가득 차 연결을 기다리는 요청도 대기 시간 뒤 503으로 끝난다", async (t) => {
  const base = await startWithRealPool(t, await blackhole(t), 500);
  // max=1인 풀에 요청 3개를 동시에 보낸다. 모두 무한 대기하지 않고 503으로 끝나야 한다.
  const started = Date.now();
  const results = await Promise.all([1, 2, 3].map(() =>
    fetch(base + "/api/board/posts", { signal: AbortSignal.timeout(8_000) }).then((r) => r.status)));
  assert.deepEqual(results, [503, 503, 503]);
  assert.ok(Date.now() - started < 5_000);
});

// 연결 수립(인증)까지는 정상적으로 응답하고 그 뒤 쿼리에는 아무 응답도 하지 않는 최소 PostgreSQL 서버.
// "이미 열린 연결에서 DB가 멈춘" 상황을 재현한다(connectionTimeoutMillis로는 막을 수 없는 경우).
async function hangsAfterHandshake(t) {
  const sockets = new Set();
  const msg = (type, body) => {
    const head = Buffer.alloc(5);
    head.write(type, 0);
    head.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([head, body]);
  };
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on("error", () => {});
    s.once("data", () => {
      const auth = Buffer.alloc(4); // AuthenticationOk
      s.write(Buffer.concat([msg("R", auth), msg("Z", Buffer.from("I"))])); // ReadyForQuery(idle)
      // 이후 들어오는 쿼리는 읽기만 하고 응답하지 않는다.
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { for (const s of sockets) s.destroy(); server.close(); });
  return server.address().port;
}

test("이미 열린 연결에서 DB가 멈춰도 query_timeout 뒤 503으로 끝나고, 멈춘 연결은 폐기된다", async (t) => {
  const port = await hangsAfterHandshake(t);
  const db = new pg.Pool({
    ...poolConfig({ PG_CONNECTION_TIMEOUT_MS: "1000", PG_QUERY_TIMEOUT_MS: "700", PG_POOL_MAX: "2" }),
    host: "127.0.0.1", port, user: "revcc", password: "unused", database: "revcc",
  });
  db.on("error", () => {});
  // 연결이 정상적으로 열리는지(=connectionTimeout이 아니라 쿼리 대기 경로를 시험하는지) 먼저 확인한다.
  const client = await db.connect();
  client.release();
  assert.equal(db.idleCount, 1);
  const app = createApp({ db, redis: { get: async () => null } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => { server.closeAllConnections(); server.close(); await db.end().catch(() => {}); });
  const started = Date.now();
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/board/posts`, { signal: AbortSignal.timeout(5_000) });
  const elapsed = Date.now() - started;
  assert.equal(res.status, 503);
  assert.ok(elapsed >= 600 && elapsed < 3_000, `${elapsed}ms`);
  assert.equal(db.totalCount, 0, "시간 초과된 연결은 풀에 돌아가지 않고 폐기되어야 한다");
});
