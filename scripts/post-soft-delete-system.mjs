// Run: scripts/run-board-system.sh scripts/post-soft-delete-system.mjs (임시 PostgreSQL, Neon 미사용)
// STEP 10-impl-B: 게시글 삭제는 행을 남기는 soft delete(deleted_by=삭제한 사용자 id, deleted_reason=AUTHOR|ADMIN)이고,
// 댓글·신고·좋아요·알림·운영 기록이 보존되며, 삭제 글은 공개 경로 어디에도 나오지 않는다.
// 사진은 공개 데이터가 참조할 때만 공개된다(삭제 글 전용·미첨부 사진은 id를 알아도 404).
import assert from "node:assert/strict";
import pg from "pg";
import { createApp } from "./src/app.js";
import { applyFlywayMigrations, assertIsolatedDatabase } from "./scripts/lib/flyway-migrations.mjs";
assertIsolatedDatabase();
const admin = new pg.Pool();
const schema = `soft_delete_test_${Date.now()}`;
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=";
const A = 1, B = 2, Z = 3, W = 4; // A: 작성자, B: 다른 회원, Z: 관리자, W: 탈퇴할 회원
const roles = { a: [A, "USER"], b: [B, "USER"], z: [Z, "ADMIN"], w: [W, "USER"] };
let db, server;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({ options: `-c search_path=${schema}` });
  await applyFlywayMigrations(db);
  // V4: image_ids GIN 인덱스.
  const indexes = (await db.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname LIKE '%image_ids_gin' ORDER BY 1`, [schema])).rows;
  assert.deepEqual(indexes.map((r) => r.indexname), ["board_posts_image_ids_gin", "parts_listings_image_ids_gin"]);
  assert.ok(indexes.every((r) => /USING gin \(image_ids\)/.test(r.indexdef)));

  await db.query(`INSERT INTO users(id,username,password,role) VALUES
    (${A},'author-a','x','USER'),(${B},'reader-b','x','USER'),(${Z},'admin-z','x','ADMIN'),(${W},'leaver-w','x','USER')`);
  const redis = { get: async (key) => {
    const [id, role] = roles[key.at(-1)] ?? [];
    return id ? JSON.stringify({ id, username: "session", role, version: 0 }) : null;
  } };
  server = createApp({ db, redis }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cookie = (t) => (t ? { Cookie: `REVCC_SESSION=${t.repeat(43)}` } : {});
  async function req(path, { method = "GET", data, token = "", expected = 200 } = {}) {
    const r = await fetch(origin + path, {
      method, headers: { "Content-Type": "application/json", ...cookie(token) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const text = await r.text();
    assert.equal(r.status, expected, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  const image = async (id, token = "") => (await fetch(`${origin}/api/board/images/${id}`, { headers: cookie(token) })).status;
  const upload = async (token) => (await req("/api/board/images", { method: "POST", token, data: { data: png }, expected: 201 })).id;
  const count = async (sql, values) => Number((await db.query(sql, values)).rows[0].count);

  // A의 사진: 삭제할 글 전용(onlyDeleted), 두 글이 함께 쓰는 사진(shared), 어디에도 안 쓴 사진(orphan), 매물 사진.
  const [onlyDeleted, shared, orphan, listingImage] = [await upload("a"), await upload("a"), await upload("a"), await upload("a")];
  const doomed = (await req("/api/board/posts", { method: "POST", token: "a", expected: 201,
    data: { title: "지울 글 zq-token", content: "작성자 원문", category: "maintenance", vehicle: "Avante", imageIds: [onlyDeleted, shared] } })).id;
  const kept = (await req("/api/board/posts", { method: "POST", token: "a", expected: 201,
    data: { title: "남는 글", content: "공개 유지", category: "free", imageIds: [shared] } })).id;
  await req(`/api/board/posts/${doomed}/comments`, { method: "POST", token: "b", data: { content: "B의 댓글" }, expected: 201 });
  await req(`/api/board/posts/${doomed}/report`, { method: "POST", token: "b", data: { reason: "B의 신고" }, expected: 201 });
  await req(`/api/board/posts/${doomed}/like`, { method: "PUT", token: "b", data: { active: true } });
  await req(`/api/board/posts/${doomed}/bookmark`, { method: "PUT", token: "b", data: { active: true } });
  const listing = (await req("/api/parts/listings", { method: "POST", token: "a", expected: 201,
    data: { title: "휠", description: "판매", price: 1000, category: "wheels", vehicle: "Avante", region: "서울", contact: "010", imageIds: [listingImage] } })).id;

  // 삭제 전 사진 규칙: 공개 글·매물 사진은 누구나, 미첨부 사진은 소유자·관리자만.
  for (const id of [onlyDeleted, shared, listingImage]) assert.equal(await image(id), 200);
  assert.deepEqual([await image(orphan), await image(orphan, "b"), await image(orphan, "a"), await image(orphan, "z")], [404, 404, 200, 200]);
  assert.equal(await image(999999, "z"), 404);
  // 숫자가 아닌 id(경로 조작 포함)는 DB 조회 전에 400이다.
  for (const bad of ["..%2F..%2Fetc%2Fpasswd", "1.png", "-1", "1%20OR%201=1"])
    assert.equal((await fetch(`${origin}/api/board/images/${bad}`)).status, 400, bad);

  // 1~3. 작성자 삭제: 행이 남고 deleted_at / deleted_by=작성자 id / deleted_reason=AUTHOR, 원문 유지.
  await req(`/api/board/posts/${doomed}`, { method: "DELETE", token: "a" });
  const row = (await db.query("SELECT * FROM board_posts WHERE id=$1", [doomed])).rows[0];
  assert.ok(row, "row must remain");
  assert.equal(row.deleted, true);
  assert.ok(row.deleted_at instanceof Date);
  assert.equal(Number(row.deleted_by), A);
  assert.equal(row.deleted_reason, "AUTHOR");
  assert.deepEqual([row.title, row.content, row.image_ids], ["지울 글 zq-token", "작성자 원문", [onlyDeleted, shared]]);
  // 5~7. 댓글·신고·좋아요·북마크·알림 보존, 작성자 삭제는 운영 기록을 만들지 않는다.
  for (const table of ["board_comments", "community_reports", "board_likes", "board_bookmarks", "community_notifications"])
    assert.equal(await count(`SELECT count(*) FROM ${table} WHERE post_id=$1`, [doomed]), 1, table);
  assert.equal(await count("SELECT count(*) FROM moderation_logs"), 0);
  // 15. 반복 삭제는 404(상태·기록 변화 없음), 관리자도 이미 삭제된 글은 다시 지울 수 없다.
  await req(`/api/board/posts/${doomed}`, { method: "DELETE", token: "a", expected: 404 });
  await req(`/api/board/posts/${doomed}`, { method: "DELETE", token: "z", data: { reason: "중복" }, expected: 404 });
  assert.equal(await count("SELECT count(*) FROM moderation_logs"), 0);
  assert.equal((await db.query("SELECT deleted_reason FROM board_posts WHERE id=$1", [doomed])).rows[0].deleted_reason, "AUTHOR");

  // 8~9. 공개 경로에서 사라진다: 상세·댓글·조회수·좋아요·신고·목록·카테고리·정렬·검색·차종·북마크·작성자 프로필·통계·알림.
  await req(`/api/board/posts/${doomed}`, { expected: 404 });
  await req(`/api/board/posts/${doomed}/comments`, { expected: 404 });
  await req(`/api/board/posts/${doomed}/view`, { method: "POST", data: {}, expected: 404 });
  await req(`/api/board/posts/${doomed}/like`, { method: "PUT", token: "b", data: { active: false }, expected: 404 });
  await req(`/api/board/posts/${doomed}/report`, { method: "POST", token: "b", data: { reason: "다시" }, expected: 404 });
  await req(`/api/board/posts/${doomed}`, { method: "PUT", token: "a", data: { title: "복구", content: "복구" }, expected: 403 });
  for (const query of ["", "?category=maintenance", "?sort=popular", "?sort=popular&period=week", "?sort=latest",
    `?q=${encodeURIComponent("zq-token")}`, "?vehicle=Avante", "?period=today"])
    assert.ok(!(await req(`/api/board/posts${query}`)).some((p) => p.id === doomed), query);
  for (const scope of ["bookmarks", "commented"]) assert.equal((await req(`/api/board/posts?scope=${scope}`, { token: "b" })).length, 0, scope);
  assert.equal((await req("/api/board/posts?scope=mine", { token: "a" })).length, 1);
  const profile = await req(`/api/board/members/${A}`);
  assert.deepEqual([profile.posts.map((p) => p.id), profile.postCount, profile.receivedLikes], [[kept], 1, 0]);
  assert.equal((await req(`/api/board/members/${B}`)).commentCount, 0);
  assert.equal((await req("/api/board/stats/summary")).postCount, 1);
  assert.equal((await req("/api/board/categories/summary")).find((c) => c.category === "maintenance").postCount, 0);
  assert.ok(!(await req("/api/board/vehicles/popular")).some((v) => v.vehicle === "Avante"));
  assert.equal((await req("/api/board/notifications", { token: "a" })).length, 0);
  assert.equal((await req("/api/board/reports", { token: "b" })).length, 0);

  // 10, 12, 13. 삭제 글 전용 사진은 공개 404(소유자·관리자는 가능), 다른 공개 글이 쓰는 사진은 그대로 공개.
  assert.deepEqual([await image(onlyDeleted), await image(onlyDeleted, "b"), await image(onlyDeleted, "a"), await image(onlyDeleted, "z")], [404, 404, 200, 200]);
  assert.equal(await image(shared), 200);
  assert.deepEqual((await req(`/api/board/posts/${kept}`)).imageIds, [shared]);
  assert.equal(await image(listingImage), 200);
  // 11. 미첨부 사진은 계속 비공개.
  assert.equal(await image(orphan), 404);

  // 14. 관리자: 게시글 수·목록에서는 빠지고, 신고 목록에는 남아 삭제 주체와 원문을 볼 수 있다.
  assert.equal((await req("/api/board/admin/overview", { token: "z" })).totalPosts, 1);
  const adminPosts = await req("/api/board/admin/posts", { token: "z" });
  assert.deepEqual([adminPosts.total, adminPosts.items.map((p) => p.id)], [1, [kept]]);
  assert.equal((await req(`/api/board/admin/members?q=author-a`, { token: "z" })).items[0].postCount, 1);
  const report = (await req("/api/board/admin/reports", { token: "z" })).items.find((r) => r.postId === doomed);
  assert.deepEqual([report.status, report.postDeleted, report.deletedReason, report.deletedContent, report.title],
    ["pending", true, "AUTHOR", "작성자 원문", "지울 글 zq-token"]);
  assert.ok(report.deletedAt);
  // 삭제된 글의 신고도 처리할 수 있다.
  await req(`/api/board/admin/reports/${report.id}`, { method: "PATCH", token: "z", data: { status: "resolved", note: "작성자 삭제 확인" } });

  // 4. 관리자 삭제: deleted_by=관리자 id, deleted_reason=ADMIN, 원문은 moderation_logs로, 사진 참조는 비운다.
  await req(`/api/board/posts/${kept}/report`, { method: "POST", token: "b", data: { reason: "관리 대상" }, expected: 201 });
  await req(`/api/board/posts/${kept}`, { method: "DELETE", token: "z", data: { reason: "운영 정책" } });
  const moderated = (await db.query("SELECT * FROM board_posts WHERE id=$1", [kept])).rows[0];
  assert.deepEqual([moderated.deleted, Number(moderated.deleted_by), moderated.deleted_reason, moderated.image_ids],
    [true, Z, "ADMIN", []]);
  assert.ok(moderated.deleted_at instanceof Date);
  const logs = (await req("/api/board/admin/logs", { token: "z" })).items;
  assert.deepEqual(logs.map((l) => [l.action_type, l.post_id, l.original_content, Number(l.target_author_id), Number(l.admin_id)]),
    [["POST_DELETE", kept, "공개 유지", A, Z]]);
  const adminReport = (await req("/api/board/admin/reports", { token: "z" })).items.find((r) => r.postId === kept);
  assert.deepEqual([adminReport.postDeleted, adminReport.deletedReason, adminReport.deletedContent], [true, "ADMIN", null]);
  // 이제 shared를 공개 참조하는 글이 없다.
  assert.deepEqual([await image(shared), await image(shared, "a"), await image(shared, "z")], [404, 200, 200]);
  assert.equal((await req("/api/board/stats/summary")).postCount, 0);
  assert.equal((await req("/api/board/admin/overview", { token: "z" })).totalPosts, 0);

  // image_ids 응답은 실제로 남아 있는 사진만, 저장 순서대로 준다(과거 데이터 방어).
  const fresh = [await upload("a"), await upload("a")];
  const live = (await req("/api/board/posts", { method: "POST", token: "a", expected: 201,
    data: { title: "사진 순서", content: "c", imageIds: [fresh[1], fresh[0]] } })).id;
  await db.query("UPDATE board_posts SET image_ids=ARRAY[$2::int,999999,$3::int] WHERE id=$1", [live, fresh[1], fresh[0]]);
  assert.deepEqual((await req(`/api/board/posts/${live}`)).imageIds, [fresh[1], fresh[0]]);
  await db.query("UPDATE parts_listings SET image_ids=ARRAY[999998,$2::int] WHERE id=$1", [listing, listingImage]);
  assert.deepEqual((await req(`/api/parts/listings/${listing}`)).imageIds, [listingImage]);
  assert.deepEqual((await req("/api/parts/listings")).items.find((l) => l.id === listing).imageIds, [listingImage]);

  // 프로필·차량 사진: 공개 회원이면 공개, 탈퇴하면 비공개. 탈퇴 세션 차단(impl-A)도 유지된다.
  const [avatar, carPhoto] = [await upload("w"), await upload("w")];
  await req("/api/board/profile", { method: "PUT", token: "w", data: { bio: "", avatarImageId: avatar } });
  await req("/api/board/garage", { method: "POST", token: "w", data: { model: "Sonata", year: 2020, imageId: carPhoto }, expected: 201 });
  assert.deepEqual([await image(avatar), await image(carPhoto)], [200, 200]);
  await db.query("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=NOW(),auth_version=1 WHERE id=$1", [W]);
  assert.deepEqual([await image(avatar), await image(carPhoto), await image(avatar, "z")], [404, 404, 200]);
  await req("/api/board/me", { token: "w", expected: 401 });
  assert.equal(await image(avatar, "w"), 404, "withdrawn session is not the owner any more");

  console.log("PASS post soft delete: AUTHOR/ADMIN soft delete with deleted_at/by/reason, comments/reports/likes/bookmarks/notifications/logs kept, repeat delete 404, hidden from detail/list/category/sort/search/vehicle/bookmark/profile/stats/notifications/admin counts, admin reports show deletion and original, image visibility by public reference (deleted-only/orphan 404, shared kept, owner/admin preview, withdrawn profile/vehicle 404), image_ids intersection, V4 GIN indexes, non-numeric image ids rejected.");
} finally {
  server?.closeAllConnections?.();
  server?.close();
  await db?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
