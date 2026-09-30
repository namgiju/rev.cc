import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

// Sessions: token letter -> Redis session JSON. DB roles are kept separately so a
// demoted admin (session still says ADMIN, DB now says USER) can be simulated.
const sessions = {
  u: { id: 7, username: "member", role: "USER" },
  s: { id: 9, username: "seller", role: "USER" },
  a: { id: 1, username: "admin", role: "ADMIN" },
  d: { id: 2, username: "demoted", role: "ADMIN" },
};
const dbRoles = { 7: "USER", 9: "USER", 1: "ADMIN", 2: "USER" };
const listing = {
  id: 5, seller_id: 9, username: "seller", title: "브레이크 패드",
  description: "원문 설명", category: "brakes",
};

function fakeDb() {
  const log = [];
  let released = 0;
  const run = (sql, values = []) => {
    log.push({ sql, values });
    if (sql.startsWith("SELECT COALESCE(auth_version"))
      return { rows: [{ version: 0, status: "ACTIVE", suspended_until: null }] };
    if (sql.startsWith("SELECT id,username,role")) {
      const id = values[0];
      return { rows: dbRoles[id] ? [{ id, username: "db-user", role: dbRoles[id], status: "ACTIVE", suspended_until: null }] : [] };
    }
    if (/FOR UPDATE OF l/.test(sql))
      return { rows: values[0] === listing.id ? [listing] : [] };
    if (/^UPDATE parts_listings .* WHERE id=\$1 AND seller_id=\$2/s.test(sql))
      return { rows: [], rowCount: values[0] === listing.id && values[1] === listing.seller_id ? 1 : 0 };
    if (/totalPosts/.test(sql)) return { rows: [{ totalPosts: 0, pendingReports: 0 }] };
    return { rows: [], rowCount: 1 };
  };
  return {
    log,
    get released() { return released; },
    query: async (sql, values) => run(sql, values),
    connect: async () => ({
      query: async (sql, values) => run(sql, values),
      release: () => { released++; },
    }),
  };
}

async function start(t, db) {
  const app = createApp({
    db,
    redis: { get: async (key) => JSON.stringify(sessions[key.at(-1)]) },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return (who, path, method = "GET", body) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(who ? { Cookie: `REVCC_SESSION=${who.repeat(43)}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

const writes = (db) => db.log.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql.trim()));

test("board admin API: anonymous 401, member 403, demoted admin 403, current admin 200", async (t) => {
  const db = fakeDb();
  const request = await start(t, db);
  for (const path of ["/api/board/admin/overview", "/api/board/admin/logs", "/api/board/admin/members"]) {
    assert.equal((await request(null, path)).status, 401);
    assert.equal((await request("u", path)).status, 403);
    // Session role alone is not enough: the DB role is re-checked on every request.
    assert.equal((await request("d", path)).status, 403);
    assert.equal((await request("a", path)).status, 200);
  }
  assert.equal((await request("u", "/api/board/admin/reports/1", "PATCH", { status: "resolved", note: "x" })).status, 403);
  assert.equal((await request("d", "/api/board/admin/reports/1", "PATCH", { status: "resolved", note: "x" })).status, 403);
  assert.equal(writes(db).length, 0);
});

test("market IDOR: another member cannot edit, change status of, or delete a listing", async (t) => {
  const db = fakeDb();
  const request = await start(t, db);
  const body = { title: "t", description: "d", price: 1000, category: "brakes", vehicle: "v", region: "r", contact: "c" };
  assert.equal((await request("u", "/api/parts/listings/5", "PUT", body)).status, 403);
  assert.equal((await request("u", "/api/parts/listings/5/status", "PATCH", { status: "sold" })).status, 403);
  // The UPDATEs are scoped by seller_id from the session, so they matched no row.
  for (const { values } of writes(db)) assert.equal(values[1], 7);
  const before = db.log.length;
  const res = await request("u", "/api/parts/listings/5", "DELETE", { reason: "not mine" });
  assert.equal(res.status, 403);
  const deleteCalls = db.log.slice(before).map(({ sql }) => sql.trim());
  assert.ok(!deleteCalls.some((sql) => sql.startsWith("DELETE") || sql.startsWith("INSERT")));
  assert.ok(deleteCalls.includes("ROLLBACK"));
  assert.equal(db.released, 1);
});

test("market: seller can edit and delete own listing without a moderation log", async (t) => {
  const db = fakeDb();
  const request = await start(t, db);
  const body = { title: "t", description: "d", price: 1000, category: "brakes", vehicle: "v", region: "r", contact: "c" };
  assert.equal((await request("s", "/api/parts/listings/5", "PUT", body)).status, 200);
  assert.equal((await request("s", "/api/parts/listings/5", "DELETE", {})).status, 200);
  const sqls = db.log.map(({ sql }) => sql.trim());
  assert.ok(sqls.includes("DELETE FROM parts_listings WHERE id=$1"));
  assert.ok(!sqls.some((sql) => sql.includes("moderation_logs")));
  assert.ok(sqls.includes("COMMIT"));
});

test("market admin moderation: current admin deletes with a reason and the snapshot is logged", async (t) => {
  const db = fakeDb();
  const request = await start(t, db);
  // A reason is required; nothing is deleted or logged without one.
  for (const body of [{}, { reason: "   " }, { reason: "x".repeat(501) }]) {
    assert.equal((await request("a", "/api/parts/listings/5", "DELETE", body)).status, 400);
  }
  assert.equal(writes(db).length, 0);
  assert.equal((await request("a", "/api/parts/listings/999", "DELETE", { reason: "spam" })).status, 404);
  assert.equal((await request("a", "/api/parts/listings/5", "DELETE", { reason: " 사기 매물 " })).status, 200);
  const [insert, remove] = writes(db);
  assert.match(insert.sql, /INSERT INTO moderation_logs/);
  assert.match(insert.sql, /'LISTING_DELETE'/);
  assert.deepEqual(insert.values, ["brakes", 5, "브레이크 패드", 9, "seller", "원문 설명", "사기 매물", 1, "db-user"]);
  assert.equal(remove.sql, "DELETE FROM parts_listings WHERE id=$1");
  assert.deepEqual(remove.values, [5]);
});

test("market admin moderation: demoted admin is rejected and nothing is written", async (t) => {
  const db = fakeDb();
  const request = await start(t, db);
  assert.equal((await request("d", "/api/parts/listings/5", "DELETE", { reason: "spam" })).status, 403);
  assert.equal(writes(db).length, 0);
  assert.ok(db.log.some(({ sql }) => sql === "ROLLBACK"));
});
