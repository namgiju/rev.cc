// Run: scripts/run-board-system.sh scripts/withdrawal-system.mjs (임시 PostgreSQL, Neon 미사용)
// STEP 10-impl-C: 회원 탈퇴 뒤 board 공개 화면. 탈퇴 처리 자체는 Spring WithdrawalService(WithdrawalIntegrationTest)가 하고,
// 여기서는 그 결과 상태(아래 withdraw()가 같은 SQL로 만든다)에서 board가 무엇을 보여 주는지 확인한다:
// 닫힌(closed) 매물 비공개, 판매완료 매물 유지(연락처 없음, 지역·사진 유지), 공개 글 사진 유지, 차고·프로필 사진 비공개, 세션 거부.
import assert from "node:assert/strict";
import pg from "pg";
import { createApp } from "./src/app.js";
import { applyFlywayMigrations, assertIsolatedDatabase } from "./scripts/lib/flyway-migrations.mjs";
assertIsolatedDatabase();
const admin = new pg.Pool();
const schema = `withdrawal_test_${Date.now()}`;
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=";
const W = 201, A = 202, Z = 203;
const roles = { w: [W, "USER"], a: [A, "USER"], z: [Z, "ADMIN"] };
let db, server;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({ options: `-c search_path=${schema}` });
  await applyFlywayMigrations(db);
  // V5: closed 상태, closed_at, withdrawal_blocks(원문이 들어갈 수 없는 hex CHECK).
  await db.query("INSERT INTO users(id,username,password) VALUES(1,'probe','x')");
  await assert.rejects(db.query("INSERT INTO withdrawal_blocks(identifier_type,identifier_hmac,reason,user_id) VALUES('EMAIL','user@example.com','COOLDOWN',1)"), /check/);
  await assert.rejects(db.query("INSERT INTO withdrawal_blocks(identifier_type,identifier_hmac,reason,user_id) VALUES('PHONE',repeat('a',64),'COOLDOWN',1)"), /check/);
  await db.query(`INSERT INTO users(id,username,password,role) VALUES(${W},'seller-w','x','USER'),(${A},'buyer-a','x','USER'),(${Z},'admin-z','x','ADMIN')`);
  const redis = { get: async (key) => {
    const [id, role] = roles[key.at(-1)] ?? [];
    return id ? JSON.stringify({ id, username: "session", role, version: 0 }) : null;
  } };
  server = createApp({ db, redis }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cookie = (t) => (t ? { Cookie: `REVCC_SESSION=${t.repeat(43)}` } : {});
  async function req(path, { method = "GET", data, token = "", expected = 200 } = {}) {
    const r = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...cookie(token) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const text = await r.text();
    assert.equal(r.status, expected, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  const image = async (id, token = "") => (await fetch(`${origin}/api/board/images/${id}`, { headers: cookie(token) })).status;
  const upload = async () => (await req("/api/board/images", { method: "POST", token: "w", data: { data: png }, expected: 201 })).id;
  const [postImage, sellingImage, soldImage, carImage, avatar] = [await upload(), await upload(), await upload(), await upload(), await upload()];
  const post = (await req("/api/board/posts", { method: "POST", token: "w", expected: 201, data: { title: "W 글", content: "남는 글", imageIds: [postImage] } })).id;
  const item = (title, status, imageId) => ({ title, description: "설명", price: 1000, category: "wheels", status, vehicle: "Avante",
    region: "서울 마포구", contact: "010-1234-5678", imageIds: [imageId] });
  const selling = (await req("/api/parts/listings", { method: "POST", token: "w", data: item("판매중 휠", "selling", sellingImage), expected: 201 })).id;
  const sold = (await req("/api/parts/listings", { method: "POST", token: "w", data: item("판매완료 휠", "sold", soldImage), expected: 201 })).id;
  await req("/api/board/garage", { method: "POST", token: "w", data: { model: "Avante", year: 2022, imageId: carImage }, expected: 201 });
  await req("/api/board/profile", { method: "PUT", token: "w", data: { bio: "", avatarImageId: avatar } });
  await req(`/api/parts/listings/${selling}/favorite`, { method: "PUT", token: "a", data: { active: true } });
  assert.equal((await req(`/api/parts/listings/${selling}`, { token: "a" })).contact, "010-1234-5678");
  await assert.rejects(db.query("UPDATE parts_listings SET status='gone' WHERE id=$1", [selling]), /parts_listings_status_check/);

  // WithdrawalService와 같은 결과 상태(차고·프로필 삭제, 판매중 → closed, 연락처 삭제, 참조 없는 사진 삭제, WITHDRAWN + 세션 버전 증가).
  await db.query("DELETE FROM member_profiles WHERE user_id=$1", [W]);
  await db.query("DELETE FROM owner_vehicles WHERE owner_id=$1", [W]);
  await db.query("DELETE FROM parts_favorites WHERE listing_id IN (SELECT id FROM parts_listings WHERE seller_id=$1 AND status='selling')", [W]);
  await db.query("UPDATE parts_listings SET status='closed',closed_at=NOW(),contact='' WHERE seller_id=$1 AND status='selling'", [W]);
  await db.query("UPDATE parts_listings SET contact='' WHERE seller_id=$1 AND status='sold'", [W]);
  await db.query(`DELETE FROM community_images i WHERE i.owner_id=$1
    AND NOT EXISTS(SELECT 1 FROM board_posts p WHERE p.image_ids @> ARRAY[i.id])
    AND NOT EXISTS(SELECT 1 FROM parts_listings l WHERE l.image_ids @> ARRAY[i.id])`, [W]);
  await db.query("UPDATE users SET username='withdrawn:'||id,account_status='WITHDRAWN',withdrawn_at=NOW(),auth_version=1 WHERE id=$1", [W]);

  // 세션: 탈퇴 회원의 기존 세션은 board에서도 거부된다.
  await req("/api/board/me", { token: "w", expected: 401 });
  await req("/api/parts/listings", { method: "POST", token: "w", data: item("x", "selling", postImage), expected: 401 });

  // 닫힌 매물: 목록·검색·찜 목록·상세·조회수·찜·수정에서 사라진다. 관리자는 상세를 볼 수 있다(연락처 없음).
  for (const [query, token] of [["", ""], ["?q=휠", "a"], ["?status=selling", ""], ["?scope=favorites", "a"], ["?region=마포", ""]])
    assert.ok(!(await req(`/api/parts/listings${query}`, { token })).items.some((l) => l.id === selling), query);
  await req(`/api/parts/listings/${selling}`, { expected: 404 });
  await req(`/api/parts/listings/${selling}`, { token: "a", expected: 404 });
  await req(`/api/parts/listings/${selling}/view`, { method: "POST", data: {}, expected: 404 });
  await req(`/api/parts/listings/${selling}/favorite`, { method: "PUT", token: "a", data: { active: true }, expected: 404 });
  await req("/api/parts/listings?status=closed", { expected: 400 });
  const closedForAdmin = await req(`/api/parts/listings/${selling}`, { token: "z" });
  assert.deepEqual([closedForAdmin.status, closedForAdmin.username, closedForAdmin.sellerId, closedForAdmin.contact], ["closed", "탈퇴한 회원", null, undefined]);
  // 판매완료 매물: 목록과 상세에 남고 판매자는 "탈퇴한 회원", 연락처 없음, 지역·사진 유지.
  const soldList = (await req("/api/parts/listings?status=sold")).items.find((l) => l.id === sold);
  const soldDetail = await req(`/api/parts/listings/${sold}`, { token: "a" });
  for (const l of [soldList, soldDetail]) {
    assert.deepEqual([l.status, l.username, l.sellerId, l.sellerWithdrawn, l.region, l.imageIds], ["sold", "탈퇴한 회원", null, true, "서울 마포구", [soldImage]]);
  }
  assert.equal(soldDetail.contact, undefined);
  assert.equal((await db.query("SELECT contact FROM parts_listings WHERE id=$1", [sold])).rows[0].contact, "");
  assert.equal((await req("/api/board/stats/summary")).soldPartsCount, 1);
  // 게시글은 "탈퇴한 회원"으로 남고 사진도 공개된다.
  const kept = await req(`/api/board/posts/${post}`);
  assert.deepEqual([kept.username, kept.authorId, kept.imageIds], ["탈퇴한 회원", null, [postImage]]);
  // 사진: 공개 글·판매완료 매물 사진은 공개, 닫힌 매물 사진은 비공개(관리자만), 차량·프로필 사진은 삭제됨.
  assert.deepEqual([await image(postImage), await image(soldImage)], [200, 200]);
  assert.deepEqual([await image(sellingImage), await image(sellingImage, "a"), await image(sellingImage, "z")], [404, 404, 200]);
  assert.deepEqual([await image(carImage, "z"), await image(avatar, "z")], [404, 404]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM community_images WHERE id=ANY($1)", [[carImage, avatar]])).rows[0].n, 0);
  // 탈퇴 회원의 차고·프로필은 없다.
  await req(`/api/board/members/${W}`, { expected: 404 });
  assert.deepEqual(await req(`/api/board/garage?owner=${W}`), []);
  console.log("PASS withdrawal (board view): V5 schema checks, withdrawn session refused, closed listing hidden from list/search/favorites/detail/view/favorite (admin detail only, no contact), sold listing kept with anonymous seller/no contact/region/photos, retained post and photo, closed-listing photo private, garage/profile photos removed.");
} finally {
  server?.closeAllConnections?.();
  server?.close();
  await db?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
