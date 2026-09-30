import test from "node:test";
import assert from "node:assert/strict";
import { text } from "../src/validation.js";
import { createApp } from "../src/app.js";

// STEP 6 (B안): 자유 텍스트는 HTML 태그를 제거한 평문으로 저장한다. 프론트가 textContent로 그리므로
// 결과는 HTML 이스케이프되지 않은 평문이어야 한다(&lt; 같은 엔티티가 남으면 화면에 그대로 보인다).
const cases = [
  ["script 태그는 내용째 제거", "<script>alert(1)</script>안녕", "안녕"],
  ["img onerror 제거", '사진 <img src=x onerror="alert(1)"> 끝', "사진  끝"],
  ["javascript: 링크 태그 제거, 글자는 남김", '<a href="javascript:alert(1)">클릭</a>', "클릭"],
  ["태그 없는 javascript: 글자는 평문으로 남음", "javascript:alert(1)", "javascript:alert(1)"],
  ["style 태그는 내용째 제거", "<style>body{}</style>본문", "본문"],
  ["엔티티로 숨긴 태그도 제거", "&lt;script&gt;alert(1)&lt;/script&gt;본문", "본문"],
  ["엔티티로 숨긴 img도 제거", "&lt;img src=x onerror=alert(1)&gt;본문", "본문"],
  ["한글", "한글 게시글입니다", "한글 게시글입니다"],
  ["이모지(ZWJ 결합 포함)", "좋아요 😀👍 👨‍👩‍👧", "좋아요 😀👍 👨‍👩‍👧"],
  ["줄바꿈과 탭 유지", "첫 줄\n둘째 줄\n\t들여쓰기", "첫 줄\n둘째 줄\n\t들여쓰기"],
  ["<3 은 평문 그대로", "사랑해 <3", "사랑해 <3"],
  ["a<b 는 <b 태그 시작으로 해석되어 뒤가 잘린다(B안의 알려진 변형)", "a<b", "a"],
  ["띄어 쓴 부등호는 그대로", "a < b 이고 c > d", "a < b 이고 c > d"],
  ["붙여 쓴 숫자 비교도 그대로", "1<2 그리고 3>2", "1<2 그리고 3>2"],
  ["화살표와 & 따옴표는 그대로", 'A -> B & "C"', 'A -> B & "C"'],
  ["보이지 않는 제어·bidi·폭 없는 문자 제거", "a\u0000b‮c​d﻿", "abcd"],
];
for (const [name, input, expected] of cases)
  test(`text(): ${name}`, () => assert.equal(text(input, 5000), expected));

test("text(): 태그만 있어 정리 후 빈 값이면 필수 필드는 400, 선택 필드는 빈 문자열", () => {
  for (const onlyTags of ["<b></b>", "<script>alert(1)</script>", "  <img src=x onerror=alert(1)>  ", "&lt;script&gt;x&lt;/script&gt;"]) {
    assert.throws(() => text(onlyTags, 100), (e) => e.status === 400, onlyTags);
    assert.equal(text(onlyTags, 100, false), "", onlyTags);
  }
});

test("text(): 길이는 정리 전 원문 기준으로 검사한다", () => {
  // 정리 후에는 5자("안녕하세요")지만 원문이 10자를 넘으므로 거부한다.
  const tagged = "<b>안녕하세요</b>";
  assert.ok(tagged.length > 10);
  assert.throws(() => text(tagged, 10), (e) => e.status === 400);
  // 원문이 한도 안이면 통과하고 정리된 값을 돌려준다.
  assert.equal(text(tagged, tagged.length), "안녕하세요");
  // 과대 입력은 sanitize 전에 거부된다(원문 길이만으로 결정).
  assert.throws(() => text("<script>".repeat(1000), 5000), (e) => e.status === 400);
});

test("text(): 엔티티를 여러 겹 감싸 정리가 수렴하지 않는 입력은 400", () => {
  let nested = "<script>x</script>";
  for (let i = 0; i < 6; i++) nested = nested.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  assert.throws(() => text(nested, 5000), (e) => e.status === 400);
});

// 라우트 단위: 게시글·댓글·장터글·방명록·프로필이 태그 없이 DB로 전달되는지 확인한다.
function fakeDb() {
  const log = [];
  const run = (sql, values = []) => {
    log.push({ sql, values });
    if (sql.startsWith("SELECT COALESCE(auth_version"))
      return { rows: [{ version: 0, status: "ACTIVE", suspended_until: null }] };
    if (/RETURNING/.test(sql) || /SELECT id FROM inserted/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  };
  return { log, query: async (sql, values) => run(sql, values) };
}

async function start(t, db) {
  const app = createApp({ db, redis: { get: async () => JSON.stringify({ id: 7, username: "member", role: "USER" }) } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, method, body) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: `REVCC_SESSION=${"u".repeat(43)}` },
      body: JSON.stringify(body),
    });
}

const XSS = '<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">링크</a>';
const stored = (db, pattern) => db.log.find(({ sql }) => pattern.test(sql))?.values;
const hasNoTag = (values) => values.every((v) => typeof v !== "string" || !/[<>]|javascript:alert|onerror/.test(v));

test("저장 경로: 게시글·댓글·장터글·방명록·프로필에 태그가 저장되지 않는다", async (t) => {
  const db = fakeDb();
  const req = await start(t, db);
  const routes = [
    ["게시글", "/api/board/posts", "POST", { title: `제목${XSS}`, content: `본문${XSS}`, category: "free" }, /^INSERT INTO board_posts/, 201],
    ["댓글", "/api/board/posts/1/comments", "POST", { content: `댓글${XSS}` }, /INSERT INTO board_comments/, 201],
    ["장터글", "/api/parts/listings", "POST", {
      title: `패드${XSS}`, description: `설명${XSS}`, price: 1000, category: "brakes",
      vehicle: `차${XSS}`, region: `서울${XSS}`, contact: `연락${XSS}`,
    }, /^INSERT INTO parts_listings/, 201],
    ["방명록", "/api/board/members/9/guestbook", "POST", { content: `방명록${XSS}` }, /^INSERT INTO garage_guestbook/, 201],
    ["프로필", "/api/board/profile", "PUT", { bio: `소개${XSS}` }, /^INSERT INTO member_profiles/, 200],
  ];
  for (const [name, path, method, body, pattern, status] of routes) {
    const res = await req(path, method, body);
    assert.equal(res.status, status, `${name}: ${await res.text()}`);
    const values = stored(db, pattern);
    assert.ok(values, `${name}: INSERT가 없다`);
    assert.ok(hasNoTag(values), `${name}: ${JSON.stringify(values)}`);
    assert.ok(values.some((v) => typeof v === "string" && v.includes("링크")), `${name}: 태그 안 글자는 남아야 한다`);
  }
});

test("저장 경로: 태그만 있는 게시글은 400이고 DB에 쓰지 않는다", async (t) => {
  const db = fakeDb();
  const req = await start(t, db);
  const res = await req("/api/board/posts", "POST", { title: "<b></b>", content: "<script>x</script>", category: "free" });
  assert.equal(res.status, 400);
  assert.equal(stored(db, /^INSERT INTO board_posts/), undefined);
});
