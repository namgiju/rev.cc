import test from "node:test";
import assert from "node:assert/strict";
import { decodeImage } from "../src/community.js";
import { createApp } from "../src/app.js";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=";
test("image validation rejects SVG, disguised content and oversized uploads", () => {
  assert.equal(decodeImage(png).mime, "image/png");
  for (const value of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,aGVsbG8=",
    "x".repeat(4200001),
    null,
  ])
    assert.throws(
      () => decodeImage(value),
      (e) => e.status === 400,
    );
});
test("mutations enforce session ownership and validate filters before SQL", async (t) => {
  const token = "b".repeat(43);
  let calls = 0;
  const app = createApp({
    redis: { get: async () => JSON.stringify({ id: 7, username: "owner" }) },
    db: {
      query: async () => {
        calls++;
        return { rows: [], rowCount: 0 };
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/board`;
  const request = (path, method = "GET", body, authenticated = true) =>
    fetch(url + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Cookie: `REVCC_SESSION=${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await request("/posts/1", "DELETE", {}, false)).status, 401);
  assert.equal(calls, 0);
  assert.equal((await request("/posts?category=invalid")).status, 400);
  assert.equal((await request("/posts?q=a&q=b")).status, 400);
  assert.equal((await request("/posts/abc")).status, 400);
  assert.equal(calls, 0);
  assert.equal(
    (await request("/posts/1", "PUT", { title: "x", content: "y" })).status,
    403,
  );
  assert.equal((await request("/posts/1", "DELETE", {})).status, 403);
  assert.equal((await request("/garage/1", "DELETE", {})).status, 403);
  assert.equal((await request("/comments/1", "DELETE", {})).status, 403);
});
