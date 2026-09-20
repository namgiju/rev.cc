// Run: docker compose exec -T board node --input-type=module < scripts/community-system.mjs
// Uses an isolated PostgreSQL schema; always cleans it up. No live posts are created.
import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { createApp } from "./src/app.js";
const admin = new pg.Pool();
const schema = `community_test_${Date.now()}`;
let db, server;
const tokenA = "a".repeat(43),
  tokenB = "b".repeat(43);
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=";
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({ options: `-c search_path=${schema}` });
  await db.query(
    "CREATE TABLE users(id BIGINT PRIMARY KEY,username TEXT NOT NULL); INSERT INTO users VALUES(1,'owner'),(2,'reader')",
  );
  const sql = await readFile("./src/schema.sql", "utf8");
  await db.query(sql);
  await db.query(sql);
  const redis = {
    get: async (key) =>
      key.endsWith(tokenA)
        ? JSON.stringify({ id: 1, username: "owner" })
        : key.endsWith(tokenB)
          ? JSON.stringify({ id: 2, username: "reader" })
          : null,
  };
  server = createApp({ db, redis }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/board`;
  async function req(
    path,
    method = "GET",
    data,
    token = tokenA,
    expected = 200,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: token ? `REVCC_SESSION=${token}` : "",
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const body = await r.json();
    assert.equal(
      r.status,
      expected,
      `${method} ${path}: ${JSON.stringify(body)}`,
    );
    return body;
  }
  await req("/posts", "POST", { title: "bad", content: "no auth" }, "", 401);
  const image = await req("/images", "POST", { data: png }, tokenA, 201);
  const raw = await fetch(base + `/images/${image.id}`);
  assert.equal(raw.headers.get("content-type"), "image/png");
  assert.equal(
    (await raw.arrayBuffer()).byteLength,
    Buffer.from(png.split(",")[1], "base64").length,
  );
  await req(
    "/images",
    "POST",
    { data: "data:image/svg+xml;base64,PHN2Zz4=" },
    tokenA,
    400,
  );
  const car = await req(
    "/garage",
    "POST",
    {
      model: "아반떼 N",
      year: 2024,
      trim: "DCT",
      bio: "테스트 차고",
      imageId: image.id,
    },
    tokenA,
    201,
  );
  const draft = {
    title: "타이어 교체 경험",
    content: "안전한 사진과 내용 <script>alert(1)</script>",
    category: "maintenance",
    vehicle: "아반떼 N",
    imageIds: [image.id],
  };
  await req("/posts", "POST", draft, tokenB, 400);
  const post = await req("/posts", "POST", draft, tokenA, 201);
  let detail = await req(`/posts/${post.id}`);
  assert.equal(detail.authorId, 1);
  assert.equal(detail.ownerVehicle, "아반떼 N");
  assert.deepEqual(detail.imageIds, [image.id]);
  assert.equal(
    (await req("/posts?q=타이어&category=maintenance&vehicle=아반떼&limit=20"))
      .length,
    1,
  );
  assert.equal((await req("/posts?category=parts")).length, 0);
  assert.equal((await req("/posts?q=%25")).length, 0);
  await req("/posts?limit=0", "GET", undefined, tokenA, 400);
  await req(
    `/posts/${post.id}`,
    "PUT",
    { ...draft, title: "forged" },
    tokenB,
    400,
  ); // foreign image rejected before owner mutation
  await req(
    `/posts/${post.id}`,
    "PUT",
    { ...draft, title: "forged", imageIds: [] },
    tokenB,
    403,
  );
  await req(`/posts/${post.id}`, "DELETE", {}, tokenB, 403);
  await req(`/posts/${post.id}`, "PUT", {
    ...draft,
    title: "타이어 교체 후기",
  });
  await req(`/posts/${post.id}/like`, "PUT", { active: true }, tokenB);
  await req(`/posts/${post.id}/like`, "PUT", { active: true }, tokenB);
  await req(`/posts/${post.id}/bookmark`, "PUT", { active: true }, tokenB);
  detail = await req(`/posts/${post.id}`, "GET", undefined, tokenB);
  assert.equal(detail.likeCount, 1);
  assert.equal(detail.bookmarked, true);
  assert.equal(
    (await req("/posts?scope=bookmarks", "GET", undefined, tokenB)).length,
    1,
  );
  assert.equal(
    (await req("/posts?scope=mine", "GET", undefined, tokenB)).length,
    0,
  );
  await req("/posts?scope=mine", "GET", undefined, "", 401);
  const comment = await req(
    `/posts/${post.id}/comments`,
    "POST",
    { content: "도움이 됐어요." },
    tokenB,
    201,
  );
  const reply = await req(
    `/posts/${post.id}/comments`,
    "POST",
    { content: "감사합니다.", parentId: comment.id },
    tokenA,
    201,
  );
  await req(
    `/posts/${post.id}/comments`,
    "POST",
    { content: "깊은 답글", parentId: reply.id },
    tokenA,
    404,
  );
  const other = await req(
    "/posts",
    "POST",
    { title: "다른 글", content: "테스트" },
    tokenB,
    201,
  );
  await req(
    `/posts/${other.id}/comments`,
    "POST",
    { content: "잘못된 부모", parentId: comment.id },
    tokenA,
    404,
  );
  assert.equal((await req("/notifications")).length, 1);
  assert.equal(
    (await req("/notifications", "GET", undefined, tokenB)).length,
    1,
  );
  await req("/notifications/read", "PUT", {});
  assert.equal((await req("/notifications"))[0].isRead, true);
  assert.equal((await req(`/posts/${post.id}/comments`)).length, 2);
  assert.equal(
    (await req("/posts?scope=commented", "GET", undefined, tokenB)).length,
    1,
  );
  await req(`/comments/${comment.id}`, "DELETE", {}, tokenA, 403);
  await req(`/comments/${comment.id}`, "DELETE", {}, tokenB);
  assert.equal((await req(`/posts/${post.id}/comments`))[0].deleted, true);
  await req(
    `/posts/${post.id}/report`,
    "POST",
    { reason: "신고 테스트" },
    tokenB,
    201,
  );
  await req(
    `/posts/${post.id}/report`,
    "POST",
    { reason: "신고 수정" },
    tokenB,
    201,
  );
  assert.equal((await req("/reports", "GET", undefined, tokenB)).length, 1);
  assert.equal((await req("/reports")).length, 0);
  await req(
    `/garage/${car.id}`,
    "PUT",
    { model: "변조", year: 2024 },
    tokenB,
    403,
  );
  await req(
    `/garage/${car.id}/records`,
    "POST",
    {
      kind: "maintenance",
      title: "오일 교체",
      date: "2026-09-20",
      mileage: 12000,
      cost: 90000,
    },
    tokenB,
    403,
  );
  const record = await req(
    `/garage/${car.id}/records`,
    "POST",
    {
      kind: "maintenance",
      title: "오일 교체",
      date: "2026-09-20",
      mileage: 12000,
      cost: 90000,
    },
    tokenA,
    201,
  );
  await req(
    `/garage/${car.id}/records`,
    "POST",
    { kind: "maintenance", title: "잘못된 날짜", date: "2026-02-31" },
    tokenA,
    400,
  );
  assert.equal((await req(`/garage/${car.id}`)).records[0].cost, 90000);
  await req(
    `/garage/${car.id}/records/${record.id}`,
    "DELETE",
    {},
    tokenB,
    403,
  );
  await req(`/garage/${car.id}/records/${record.id}`, "DELETE", {});
  assert.equal((await req("/members/1")).posts.length, 1);
  await req(`/posts/${post.id}/view`, "POST", {});
  assert.equal((await req(`/posts/${post.id}`)).views, 1);
  await req(`/posts/${post.id}/like`, "PUT", { active: false }, tokenB);
  assert.equal((await req(`/posts/${post.id}`)).likeCount, 0);
  await req(`/posts/${post.id}/bookmark`, "PUT", { active: false }, tokenB);
  assert.equal(
    (await req("/posts?scope=bookmarks", "GET", undefined, tokenB)).length,
    0,
  );
  await req(`/posts/${post.id}`, "DELETE", {});
  await req(`/posts/${post.id}`, "GET", undefined, tokenA, 404);
  assert.equal(
    (await req("/notifications", "GET", undefined, tokenB)).length,
    0,
  );
  await req(`/garage/${car.id}`, "DELETE", {});
  await req(`/garage/${car.id}`, "GET", undefined, tokenA, 404);
  console.log(
    "PASS: migration idempotency, image validation, posts, search/categories, ownership, likes/bookmarks, comments/replies, notifications, reports, garage/records, cascade deletion.",
  );
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
