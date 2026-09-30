// scripts/run-board-system.sh scripts/admin-system.mjs (임시 PostgreSQL, Neon 미사용)
import assert from "node:assert/strict";
import pg from "pg";
import { createApp } from "./src/app.js";
import { applyFlywayMigrations, assertIsolatedDatabase } from "./scripts/lib/flyway-migrations.mjs";
assertIsolatedDatabase();
const pool = new pg.Pool(),
  schema = `admin_test_${Date.now()}`;
let db, server;
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({ options: `-c search_path=${schema}` });
  await applyFlywayMigrations(db);
  await db.query(
    "INSERT INTO users(id,username,role,password) VALUES(1,'owner','USER','PRIVATE-HASH'),(2,'reader','USER','PRIVATE-HASH'),(3,'manager','ADMIN','PRIVATE-HASH')",
  );
  const redis = {
    get: async (key) => {
      const id = { a: 1, b: 2, c: 3 }[key.at(-1)];
      return id
        ? JSON.stringify({
            id,
            username: "test",
            role: id === 3 ? "ADMIN" : "USER",
          })
        : null;
    },
  };
  server = createApp({ db, redis }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/board`;
  const req = async (path, method = "GET", data, token = "c", status = 200) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Cookie: `REVCC_SESSION=${token.repeat(43)}` } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const body = await r.json();
    assert.equal(r.status, status, `${path}: ${JSON.stringify(body)}`);
    return body;
  };
  for (const path of [
    "/admin/overview",
    "/admin/members",
    "/admin/posts",
    "/admin/reports",
    "/admin/badges",
  ]) {
    await req(path, "GET", undefined, "", 401);
    await req(path, "GET", undefined, "a", 403);
  }
  await req(
    "/admin/reports/1",
    "PATCH",
    { status: "resolved", note: "x" },
    "",
    401,
  );
  await req(
    "/admin/reports/1",
    "PATCH",
    { status: "resolved", note: "x" },
    "a",
    403,
  );
  assert.equal((await req("/admin/members")).total, 3);
  assert.ok(
    !JSON.stringify(await req("/admin/members")).includes("PRIVATE-HASH"),
  );
  // 게시글 23개를 실제 API로 만든다. 글 작성 rate limit(사용자당 10/분)을 끄지 않고 지키도록
  // 작성자를 10개씩 나눈다(a: 1~10번, b: 11~20번, c: 21~23번). 1번 글은 일반 회원(a)의 글이어야
  // 아래 "관리자도 남의 글은 수정 불가" 검사가 의미를 가진다.
  for (let i = 0; i < 23; i++)
    await req(
      "/posts",
      "POST",
      {
        title: `real-${i}`,
        content: "content",
        category: i % 2 ? "free" : "maintenance",
      },
      ["a", "b", "c"][Math.floor(i / 10)],
      201,
    );
  assert.equal((await req("/admin/posts")).items.length, 20);
  assert.equal((await req("/admin/posts?page=2")).items.length, 3);
  assert.equal((await req("/admin/posts?page=9")).total, 23);
  assert.equal((await req("/admin/posts?category=free")).total, 11);
  assert.equal((await req("/admin/posts?q=%27%20OR%201%3D1--")).total, 0);
  assert.equal((await req("/admin/posts?q=%25")).total, 0);
  assert.equal((await req("/admin/overview")).totalPosts, 23);
  const report = await req(
    "/posts/1/report",
    "POST",
    { reason: "please review" },
    "b",
    201,
  );
  const items = await req("/admin/reports?status=pending");
  assert.equal(items.total, 1);
  assert.equal(items.items[0].reporter, "reader");
  await req(
    `/admin/reports/${report.id}`,
    "PATCH",
    { status: "resolved", note: "" },
    "c",
    400,
  );
  await req(
    `/admin/reports/${report.id}`,
    "PATCH",
    { status: "other", note: "x" },
    "c",
    400,
  );
  await req(`/admin/reports/${report.id}`, "PATCH", {
    status: "resolved",
    note: "reviewed",
  });
  assert.equal((await req("/admin/overview")).pendingReports, 0);
  const processed = (await req("/admin/reports?status=resolved")).items[0];
  assert.equal(processed.reviewer, "manager");
  assert.equal(processed.resolutionNote, "reviewed");
  assert.ok(processed.reviewedAt);
  await req(
    `/admin/reports/${report.id}`,
    "PATCH",
    { status: "dismissed", note: "overwrite" },
    "c",
    409,
  );
  await req(
    "/posts/1/report",
    "POST",
    { reason: "overwrite reviewed reason" },
    "b",
    409,
  );
  assert.equal((await req("/admin/reports")).items[0].reason, "please review");
  assert.equal(
    (await req("/reports", "GET", undefined, "b"))[0].status,
    "resolved",
  );
  const second = await req(
    "/posts/2/report",
    "POST",
    { reason: "second" },
    "b",
    201,
  );
  await req(`/admin/reports/${second.id}`, "PATCH", {
    status: "dismissed",
    note: "not a violation",
  });
  await req(
    "/admin/reports/2147483647",
    "PATCH",
    { status: "resolved", note: "none" },
    "c",
    404,
  );
  await req("/admin/members?page=0", "GET", undefined, "c", 400);
  await req("/admin/reports?status=bad", "GET", undefined, "c", 400);
  await db.query(
    "INSERT INTO owner_vehicles(owner_id,model,year,verified) VALUES(1,'one',2024,true),(1,'two',2024,true),(2,'unverified',2023,false)",
  );
  assert.equal((await req("/admin/badges"))[0].holders, 1);
  // Admin operational access never grants authorship editing privileges.
  await req(
    "/posts/1",
    "PUT",
    { title: "forged", content: "forged" },
    "c",
    403,
  );
  await db.query("UPDATE users SET role='USER' WHERE id=3");
  await req("/admin/overview", "GET", undefined, "c", 403);
  console.log(
    "PASS admin: real counts/lists, pagination/search/filters, no credentials, USER/guest denial, stale ADMIN revocation, report resolve/dismiss/audit/conflict/author visibility, derived badge counts, Flyway migrations, unchanged post ownership.",
  );
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (db) await db.end();
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
}
