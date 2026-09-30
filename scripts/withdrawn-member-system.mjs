// Run: scripts/run-board-system.sh scripts/withdrawn-member-system.mjs (임시 PostgreSQL, Neon 미사용)
// STEP 10-impl-A: 탈퇴(WITHDRAWN) 회원의 콘텐츠는 남기고, 공개 응답에서는 "탈퇴한 회원"으로 보이며
// 내부 회원 id·원래 아이디·차고·연락처를 내보내지 않는지 실제 PostgreSQL(Flyway V1~V3)로 확인한다.
// 탈퇴 API는 아직 없으므로(STEP 10-impl-C) Spring User.markWithdrawn과 같은 UPDATE로 상태만 바꾼다.
import assert from "node:assert/strict";
import pg from "pg";
import { createApp } from "./src/app.js";
import { applyFlywayMigrations, assertIsolatedDatabase } from "./scripts/lib/flyway-migrations.mjs";
assertIsolatedDatabase();
const admin = new pg.Pool();
const schema = `withdrawn_test_${Date.now()}`;
let db, server;
const W = 101, A = 102, Z = 103; // W: 탈퇴할 회원, A: 일반 회원, Z: 관리자
const OLD_NAME = "writer-w-original";
const tokens = { w: "w".repeat(43), a: "a".repeat(43), z: "z".repeat(43) };
const sessions = {
  [tokens.w]: { id: W, username: OLD_NAME, role: "USER", version: 0 },
  [tokens.a]: { id: A, username: "reader-a", role: "USER", version: 0 },
  [tokens.z]: { id: Z, username: "admin-z", role: "ADMIN", version: 0 },
};
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({ options: `-c search_path=${schema}` });
  await applyFlywayMigrations(db);
  // V3가 적용됐는지: 새 컬럼과 상태 CHECK.
  const columns = (await db.query(
    `SELECT table_name||'.'||column_name AS c FROM information_schema.columns WHERE table_schema=$1
     AND column_name IN ('withdrawn_at','deleted_at','deleted_by','deleted_reason')`, [schema])).rows.map((r) => r.c).sort();
  assert.deepEqual(columns, ["board_posts.deleted_at", "board_posts.deleted_by", "board_posts.deleted_reason", "users.withdrawn_at"]);
  await assert.rejects(db.query("INSERT INTO users(username,password,account_status) VALUES('bad','x','GONE')"), /users_account_status_check/);

  await db.query(
    `INSERT INTO users(id,username,password,role) VALUES($1,$4,'x','USER'),($2,'reader-a','x','USER'),($3,'admin-z','x','ADMIN')`,
    [W, A, Z, OLD_NAME],
  );
  server = createApp({ db, redis: { get: async (key) => JSON.stringify(sessions[key.slice("revcc:session:".length)] ?? null) } })
    .listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const publicBodies = [];
  async function req(path, { method = "GET", data, token, expected = 200, record = true } = {}) {
    const r = await fetch(origin + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: token ? `REVCC_SESSION=${token}` : "" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const text = await r.text();
    assert.equal(r.status, expected, `${method} ${path}: ${text}`);
    if (record && method === "GET") publicBodies.push([path, text]);
    return text ? JSON.parse(text) : null;
  }

  // 탈퇴 전 W의 활동: 차량, 차량을 연결한 글, 자기 글의 댓글, A 글의 댓글(A에게 알림), A 차고 방명록, 매물.
  const vehicle = await req("/api/board/garage", { method: "POST", token: tokens.w, data: { model: "Avante N", year: 2022 }, expected: 201 });
  const wPost = (await req("/api/board/posts", { method: "POST", token: tokens.w, data: { title: "W의 글", content: "탈퇴 전 작성", vehicleId: vehicle.id }, expected: 201 })).id;
  const aPost = (await req("/api/board/posts", { method: "POST", token: tokens.a, data: { title: "A의 글", content: "일반 회원" }, expected: 201 })).id;
  await req(`/api/board/posts/${wPost}/comments`, { method: "POST", token: tokens.w, data: { content: "W 자기 글 댓글" }, expected: 201 });
  await req(`/api/board/posts/${wPost}/comments`, { method: "POST", token: tokens.a, data: { content: "A가 W 글에 댓글" }, expected: 201 });
  await req(`/api/board/posts/${aPost}/comments`, { method: "POST", token: tokens.w, data: { content: "W가 A 글에 댓글" }, expected: 201 });
  await req(`/api/board/members/${A}/guestbook`, { method: "POST", token: tokens.w, data: { content: "W가 A 차고에" }, expected: 201 });
  await req(`/api/board/members/${W}/guestbook`, { method: "POST", token: tokens.a, data: { content: "A가 W 차고에" }, expected: 201 });
  const listing = await req("/api/parts/listings", {
    method: "POST", token: tokens.w, expected: 201,
    data: { title: "W 휠", description: "판매", price: 1000, category: "wheels", vehicle: "Avante", region: "서울", contact: "010-1111-2222" },
  });
  const beforeW = await req(`/api/board/posts/${wPost}`, { record: false });
  assert.equal(beforeW.authorId, W);
  assert.equal(beforeW.username, OLD_NAME);
  assert.equal(beforeW.authorWithdrawn, false);

  // 탈퇴 상태로 전환(Spring User.markWithdrawn과 같음: 상태, 시각, 세션 버전).
  await db.query("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=NOW(),auth_version=COALESCE(auth_version,0)+1 WHERE id=$1", [W]);

  // 기존 세션은 board에서도 거부된다.
  await req("/api/board/me", { token: tokens.w, expected: 401, record: false });
  await req("/api/board/posts", { method: "POST", token: tokens.w, data: { title: "x", content: "y" }, expected: 401 });

  // 게시글: 목록·상세·검색. 콘텐츠는 남고 작성자는 익명이다.
  const list = await req("/api/board/posts", { token: tokens.a });
  const wRow = list.find((p) => p.id === wPost), aRow = list.find((p) => p.id === aPost);
  for (const post of [wRow, await req(`/api/board/posts/${wPost}`, { token: tokens.a }), await req(`/api/board/posts/${wPost}`)]) {
    assert.equal(post.title, "W의 글");
    assert.equal(post.username, "탈퇴한 회원");
    assert.equal(post.authorId, null);
    assert.equal(post.authorWithdrawn, true);
    assert.equal(post.vehicleId, null);
    assert.equal(post.linkedVehicle, null);
    assert.equal(post.ownerVehicle, null);
  }
  assert.equal(aRow.authorId, A);
  assert.equal(aRow.username, "reader-a");
  assert.equal(aRow.authorWithdrawn, false);
  assert.equal((await req(`/api/board/posts?q=${OLD_NAME}`)).length, 0, "원래 아이디로 글을 찾을 수 없다");
  assert.deepEqual((await req(`/api/board/posts?q=${encodeURIComponent("탈퇴한")}`)).map((p) => p.id), [wPost]);

  // 댓글: W 글 아래의 타인 댓글은 그대로, W의 댓글은 익명.
  const wComments = await req(`/api/board/posts/${wPost}/comments`);
  assert.deepEqual(wComments.map((c) => [c.content, c.username, c.authorId]),
    [["W 자기 글 댓글", "탈퇴한 회원", null], ["A가 W 글에 댓글", "reader-a", A]]);
  const aComments = await req(`/api/board/posts/${aPost}/comments`);
  assert.deepEqual(aComments.map((c) => [c.username, c.authorId, c.authorWithdrawn]), [["탈퇴한 회원", null, true]]);

  // 알림(A가 받은 W의 댓글 알림)도 이름을 바꿔 보여 준다.
  const notes = await req("/api/board/notifications", { token: tokens.a });
  assert.deepEqual(notes.map((n) => n.username), ["탈퇴한 회원"]);

  // 공개 프로필·차고·방명록: 탈퇴 회원 것은 없다. 다른 회원 차고에 쓴 방명록은 익명으로 남는다.
  await req(`/api/board/members/${W}`, { expected: 404 });
  await req(`/api/board/members/${W}/guestbook`, { expected: 404 });
  await req(`/api/board/members/${W}/guestbook`, { method: "POST", token: tokens.a, data: { content: "더 쓸 수 없다" }, expected: 404 });
  assert.deepEqual(await req(`/api/board/garage?owner=${W}`), []);
  assert.equal((await req("/api/board/garage")).some((v) => v.id === vehicle.id), false);
  await req(`/api/board/garage/${vehicle.id}`, { expected: 404 });
  const aGuestbook = await req(`/api/board/members/${A}/guestbook`);
  assert.deepEqual(aGuestbook.items.map((g) => [g.content, g.username, g.authorId]), [["W가 A 차고에", "탈퇴한 회원", null]]);
  const aProfile = await req(`/api/board/members/${A}`);
  assert.equal(aProfile.username, "reader-a");

  // 장터: 판매자 익명, 로그인해도 연락처를 주지 않는다.
  const market = await req("/api/parts/listings");
  const wListing = market.items.find((l) => l.id === listing.id);
  assert.equal(wListing.username, "탈퇴한 회원");
  assert.equal(wListing.sellerId, null);
  assert.equal(wListing.sellerWithdrawn, true);
  const detail = await req(`/api/parts/listings/${listing.id}`, { token: tokens.a });
  assert.equal(detail.sellerId, null);
  assert.equal(detail.contact, undefined);

  // 통계: 탈퇴 회원은 회원 수에서 빠진다.
  assert.equal((await req("/api/board/stats/summary")).memberCount, 2);

  // 공개 응답 어디에도 원래 아이디나 탈퇴 회원 id가 작성자 필드로 남지 않는다.
  for (const [path, text] of publicBodies) {
    assert.ok(!text.includes(OLD_NAME), `${path} leaks the original username`);
    assert.ok(!new RegExp(`"(authorId|sellerId|ownerId|userId)":${W}\\b`).test(text), `${path} leaks the withdrawn member id`);
  }

  // 관리자: 관리자 API는 내부 id를 쓰고, 탈퇴 작성자의 글도 사유를 남겨 삭제할 수 있다. 회원 목록에서는 빠진다.
  const members = await req(`/api/board/admin/members?q=${OLD_NAME}`, { token: tokens.z, record: false });
  assert.equal(members.total, 0);
  // 관리자 게시글 목록도 이름은 "탈퇴한 회원"이고, 운영용 내부 id는 남는다. 원래 아이디로는 찾을 수 없다.
  const adminPosts = await req("/api/board/admin/posts", { token: tokens.z, record: false });
  const adminW = adminPosts.items.find((p) => p.id === wPost);
  assert.deepEqual([adminW.username, Number(adminW.authorId)], ["탈퇴한 회원", W]);
  assert.equal((await req(`/api/board/admin/posts?q=${OLD_NAME}`, { token: tokens.z, record: false })).total, 0);
  await req(`/api/board/posts/${wPost}`, { method: "DELETE", token: tokens.z, data: { reason: "운영 확인" } });
  const log = (await db.query("SELECT target_author_id,admin_id FROM moderation_logs")).rows;
  assert.deepEqual(log.map((r) => [Number(r.target_author_id), Number(r.admin_id)]), [[W, Z]]);
  console.log("PASS withdrawn members: V3 schema, board session refusal, anonymous author/seller/guestbook/notification display, hidden ids/profile/garage/contact, search by old name blocked, member count, admin moderation still works.");
} finally {
  server?.closeAllConnections?.();
  server?.close();
  await db?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
