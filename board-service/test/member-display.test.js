import test from "node:test";
import assert from "node:assert/strict";
import {
  WITHDRAWN_DISPLAY_NAME,
  displayNameSql,
  isWithdrawnSql,
  publicMemberId,
  unlessWithdrawnSql,
} from "../src/member-display.js";
import { requireCurrentAdmin } from "../src/admin-access.js";

// 실제 SQL 동작(탈퇴 작성자 표시·id 숨김)은 scripts/withdrawn-member-system.mjs가 PostgreSQL로 검증한다.
test("withdrawn display helpers build fixed SQL and keep null ids null", () => {
  assert.equal(WITHDRAWN_DISPLAY_NAME, "탈퇴한 회원"); // Spring ReservedUsernames와 같은 값
  assert.equal(isWithdrawnSql("u"), "COALESCE(u.account_status = 'WITHDRAWN', false)");
  assert.equal(
    displayNameSql("u"),
    "CASE WHEN COALESCE(u.account_status = 'WITHDRAWN', false) THEN '탈퇴한 회원' ELSE u.username END",
  );
  assert.equal(
    unlessWithdrawnSql("u", "p.author_id"),
    "CASE WHEN COALESCE(u.account_status = 'WITHDRAWN', false) THEN NULL ELSE p.author_id END",
  );
  assert.equal(publicMemberId(null), null);
  assert.equal(publicMemberId(undefined), null);
  assert.equal(publicMemberId("42"), 42);
});

test("moderation requires a current, usable ADMIN in the database", async () => {
  const row = (fields) => ({ query: async () => ({ rows: [{ id: 1, username: "a", role: "ADMIN", status: "ACTIVE", suspended_until: null, ...fields }] }) });
  const session = { id: 1, role: "ADMIN" };
  assert.deepEqual(await requireCurrentAdmin(row({}), session), { id: 1, username: "a", role: "ADMIN" });
  assert.deepEqual(await requireCurrentAdmin(row({ status: "SUSPENDED", suspended_until: "2000-01-01" }), session), { id: 1, username: "a", role: "ADMIN" });
  for (const blocked of [{ status: "WITHDRAWN" }, { status: "DISABLED" }, { status: "SUSPENDED" }, { status: "SUSPENDED", suspended_until: "2999-01-01" }, { role: "USER" }]) {
    await assert.rejects(requireCurrentAdmin(row(blocked), session), (e) => e.status === 403, JSON.stringify(blocked));
  }
  await assert.rejects(requireCurrentAdmin({ query: async () => ({ rows: [] }) }, session), (e) => e.status === 403);
  await assert.rejects(requireCurrentAdmin(row({}), { id: 1, role: "USER" }), (e) => e.status === 403);
});
