import test from "node:test";
import assert from "node:assert/strict";
import { rateLimiter } from "../src/rate-limit.js";

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (body) => {
    res.body = body;
    return res;
  };

  res.set = (key, value) => {
    res.headers[key] = value;
    return res;
  };

  return res;
}

test("rateLimiter allows up to max requests per user then blocks within the window", () => {
  const limiter = rateLimiter({ windowMs: 60_000, max: 2 });
  const req = { user: { id: 1 } };

  let calls = 0;

  const next = () => {
    calls++;
  };

  limiter(req, mockRes(), next);
  limiter(req, mockRes(), next);

  const blocked = mockRes();
  limiter(req, blocked, next);

  assert.equal(calls, 2);
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers["Retry-After"]);
});

test("rateLimiter tracks each authenticated user in a separate bucket", () => {
  const limiter = rateLimiter({ windowMs: 60_000, max: 1 });

  let calls = 0;

  const next = () => {
    calls++;
  };

  limiter({ user: { id: 1 } }, mockRes(), next);
  limiter({ user: { id: 2 } }, mockRes(), next);

  assert.equal(calls, 2);
});

test("rateLimiter falls back to IP when there is no authenticated user", () => {
  const limiter = rateLimiter({ windowMs: 60_000, max: 1 });

  let calls = 0;

  const next = () => {
    calls++;
  };

  limiter({ ip: "203.0.113.1" }, mockRes(), next);

  const blocked = mockRes();
  limiter({ ip: "203.0.113.1" }, blocked, next);

  assert.equal(calls, 1);
  assert.equal(blocked.statusCode, 429);
});