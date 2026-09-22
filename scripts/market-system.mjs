// Real PostgreSQL isolation; no production listings or users.
import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { createApp } from "./src/app.js";
const pool = new pg.Pool(),
  schema = `market_test_${Date.now()}`;
let db, server;
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({ options: `-c search_path=${schema}` });
  await db.query(
    "CREATE TABLE users(id BIGINT PRIMARY KEY,username TEXT NOT NULL); INSERT INTO users VALUES(1,'seller'),(2,'buyer'),(3,'admin')",
  );
  const sql = await readFile("./src/schema.sql", "utf8");
  await db.query(sql);
  await db.query(sql);
  const redis = {
    get: async (key) => {
      const id = { a: 1, b: 2, c: 3 }[key.at(-1)];
      return id
        ? JSON.stringify({
            id,
            username: "user",
            role: id === 3 ? "ADMIN" : "USER",
          })
        : null;
    },
  };
  server = createApp({ db, redis }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function req(path, method = "GET", data, token = "a", expected = 200) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Cookie: `REVCC_SESSION=${token.repeat(43)}` } : {}),
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
  const endpoint = "/parts/listings",
    body = {
      title: "휠 % 테스트",
      description: "직거래 설명",
      price: 120000,
      category: "wheels",
      status: "selling",
      vehicle: "내 차종 2024",
      region: "성남",
      contact: "test@example.test",
      imageIds: [],
    };
  await req(endpoint, "POST", body, "", 401);
  await req(endpoint + "?scope=mine", "GET", undefined, "", 401);
  const image = await req(
    "/board/images",
    "POST",
    {
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=",
    },
    "a",
    201,
  );
  body.imageIds = [image.id];
  const item = await req(endpoint, "POST", { ...body, sellerId: 2 }, "a", 201);
  const path = `${endpoint}/${item.id}`;
  assert.equal((await req(path)).sellerId, 1);
  assert.equal((await req(path, "GET", undefined, "")).contact, undefined);
  assert.equal((await req(path, "GET", undefined, "b")).contact, body.contact);
  assert.equal((await req(endpoint)).items[0].contact, undefined);
  for (const token of ["b", "c"]) {
    await req(path, "PUT", { ...body, imageIds: [] }, token, 403);
    await req(path, "PATCH", {}, token, 404);
    await req(path + "/status", "PATCH", { status: "sold" }, token, 403);
    await req(path, "DELETE", {}, token, 403);
  }
  await req(endpoint, "POST", body, "b", 400);
  for (const invalid of [
    { price: -1 },
    { price: 1.2 },
    { category: "invalid" },
    { status: "invalid" },
    { contact: "" },
    { imageIds: [999] },
  ])
    await req(endpoint, "POST", { ...body, ...invalid }, "a", 400);
  const second = await req(
    endpoint,
    "POST",
    {
      ...body,
      title: "제동 장치",
      price: 300000,
      category: "brakes",
      region: "서울",
    },
    "a",
    201,
  );
  await req(path + "/favorite", "PUT", { active: true }, "b");
  await req(path + "/favorite", "PUT", { active: true }, "b");
  assert.equal((await req(path)).favoriteCount, 1);
  assert.equal((await req(path, "GET", undefined, "b")).favorited, true);
  assert.equal((await req(path)).favorited, false);
  assert.equal(
    (await req(endpoint + "?scope=favorites", "GET", undefined, "b")).total,
    1,
  );
  assert.equal(
    (await req(endpoint + "?scope=mine", "GET", undefined, "c")).total,
    0,
  );
  assert.equal((await req(endpoint + "?q=%25")).total, 1);
  assert.equal(
    (await req(endpoint + "?category=wheels&region=성남&vehicle=2024")).total,
    1,
  );
  assert.equal((await req(endpoint + "?sort=price-low")).items[0].id, item.id);
  assert.equal(
    (await req(endpoint + "?sort=price-high")).items[0].id,
    second.id,
  );
  assert.equal((await req(endpoint + "?sort=popular")).items[0].id, item.id);
  const page = await req(endpoint + "?limit=1&page=2");
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal((await req(endpoint + "?limit=1&page=3")).items.length, 0);
  for (const query of [
    "sort=invalid",
    "limit=0",
    "page=-1",
    "category=invalid",
    "scope=all",
    "status=invalid",
  ])
    await req(endpoint + "?" + query, "GET", undefined, "a", 400);
  await req(path + "/view", "POST", {}, "");
  assert.equal((await req(path)).views, 1);
  await req(path + "/status", "PATCH", { status: "reserved" });
  assert.equal((await req(endpoint + "?status=reserved")).total, 1);
  await req(path, "PUT", { ...body, title: "수정 완료", status: "sold" });
  assert.equal((await req(path)).status, "sold");
  await req(path, "DELETE", {});
  await req(path, "GET", undefined, "", 404);
  assert.equal(
    (await req(endpoint + "?scope=favorites", "GET", undefined, "b")).total,
    0,
  );
  assert.equal(
    (await db.query("SELECT COUNT(*)::int AS count FROM board_posts")).rows[0]
      .count,
    0,
  );
  console.log(
    "PASS market SQL/HTTP: shared session, owner/admin permissions, contact visibility, owned images, validation, filters/ranking/pagination, favorites idempotency, view/status/edit/delete/cascade, community separation, schema idempotency",
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
