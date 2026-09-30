import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

// STEP 5-B: 매물 등록·신고(사용자 단위), 조회수 증가(로그인 여부와 무관하게 IP 단위) rate limit.
const sessions = {
  u: { id: 7, username: "member", role: "USER" },
  s: { id: 9, username: "seller", role: "USER" },
};

function fakeDb() {
  const log = [];
  const run = (sql, values = []) => {
    log.push({ sql, values });
    if (sql.startsWith("SELECT COALESCE(auth_version"))
      return { rows: [{ version: 0, status: "ACTIVE", suspended_until: null }] };
    if (sql.startsWith("SELECT id,author_id FROM board_posts")) return { rows: [{ id: values[0], author_id: 9 }] };
    if (/RETURNING views/.test(sql)) return { rows: [{ views: 1 }], rowCount: 1 };
    if (/RETURNING id/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  };
  return { log, query: async (sql, values) => run(sql, values) };
}

async function start(t, db) {
  const app = createApp({ db, redis: { get: async (key) => JSON.stringify(sessions[key.at(-1)]) } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // ip: nginx가 덮어써서 보내는 X-Forwarded-For 한 개(trust proxy 1 → req.ip).
  return ({ who, ip = "203.0.113.1" } = {}, path, method = "POST", body = {}) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
        ...(who ? { Cookie: `REVCC_SESSION=${who.repeat(43)}` } : {}),
      },
      body: JSON.stringify(body),
    });
}

const listingBody = {
  title: "브레이크 패드", description: "설명", price: 10000, category: "brakes",
  vehicle: "아반떼 N", region: "서울", contact: "010-0000-0000",
};
const count = (db, pattern) => db.log.filter(({ sql }) => pattern.test(sql)).length;

test("market listing create: 10 per user per minute, then 429 without inserting; other users unaffected", async (t) => {
  const db = fakeDb();
  const req = await start(t, db);
  for (let i = 0; i < 10; i++)
    assert.equal((await req({ who: "u" }, "/api/parts/listings", "POST", listingBody)).status, 201);
  const blocked = await req({ who: "u", ip: "198.51.100.9" }, "/api/parts/listings", "POST", listingBody);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
  assert.equal(count(db, /^INSERT INTO parts_listings/), 10);
  assert.equal((await req({ who: "s" }, "/api/parts/listings", "POST", listingBody)).status, 201);
});

test("community report: 10 per user per minute, then 429 without inserting; other users unaffected", async (t) => {
  const db = fakeDb();
  const req = await start(t, db);
  for (let i = 1; i <= 10; i++)
    assert.equal((await req({ who: "u" }, `/api/board/posts/${i}/report`, "POST", { reason: "spam" })).status, 201);
  assert.equal((await req({ who: "u" }, "/api/board/posts/11/report", "POST", { reason: "spam" })).status, 429);
  assert.equal(count(db, /^INSERT INTO community_reports/), 10);
  assert.equal((await req({ who: "s" }, "/api/board/posts/11/report", "POST", { reason: "spam" })).status, 201);
});

for (const [name, path, pattern] of [
  ["community post", "/api/board/posts/1/view", /^UPDATE board_posts SET views/],
  ["market listing", "/api/parts/listings/1/view", /^UPDATE parts_listings SET views/],
]) {
  test(`${name} view: 60 per IP per minute whether logged in or not`, async (t) => {
    const db = fakeDb();
    const req = await start(t, db);
    // 같은 IP에서 비로그인·로그인 사용자 두 명이 섞여도 IP 하나의 한도를 함께 쓴다.
    for (let i = 0; i < 60; i++)
      assert.equal((await req({ who: [undefined, "u", "s"][i % 3] }, path)).status, 200);
    const blocked = await req({ who: "s" }, path);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    assert.equal(count(db, pattern), 60);
    assert.equal((await req({ ip: "203.0.113.2" }, path)).status, 200);
  });
}
