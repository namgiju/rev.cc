import sanitizeHtml from "sanitize-html";

export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

// 서버측 XSS 방어선: 자유 텍스트는 HTML 태그를 모두 제거한 순수 텍스트로 저장한다(STEP 6, B안).
// 프론트는 textContent로 그리므로 저장 값은 HTML 이스케이프하지 않은 평문이어야 한다.
// sanitize-html은 결과를 HTML로 내보내며 텍스트의 < > & "를 엔티티로 바꾸므로, 그 네 가지만 되돌린다.
// 되돌린 결과에 엔티티로 숨겨 둔 태그(&lt;script&gt; 등)가 다시 나타날 수 있어 값이 바뀌지 않을 때까지 반복한다.
const NO_HTML = { allowedTags: [], allowedAttributes: {} };
const MAX_PASSES = 5;
// 제어 문자(줄바꿈·탭 제외), 방향 재정의(bidi) 문자, 폭 없는 공백/BOM. 이모지 결합에 쓰이는 ZWJ/ZWNJ는 남긴다.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​‪-‮⁠⁦-⁩﻿]/g;
const unescapeSanitized = (html) =>
  html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
export function plainText(value) {
  let current = value.replace(INVISIBLE, "");
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = unescapeSanitized(sanitizeHtml(current, NO_HTML));
    if (next === current) return current;
    current = next;
  }
  // 엔티티를 여러 겹으로 감싸 반복해도 수렴하지 않는 입력은 저장하지 않는다.
  fail(400, "입력 내용을 확인해주세요.");
}

export function text(value, max, required = true) {
  if (value === undefined && !required) return "";
  // 길이는 정리 전 원문 기준으로 먼저 검사해 과대 입력을 sanitize하기 전에 거부한다.
  if (typeof value !== "string" || value.length > max)
    fail(400, `입력 내용을 확인해주세요. (최대 ${max}자)`);
  const cleaned = plainText(value).trim();
  // 태그만 있어 정리 후 비는 값은 빈 입력과 똑같이 거부한다.
  if (required && !cleaned) fail(400, `입력 내용을 확인해주세요. (최대 ${max}자)`);
  return cleaned;
}
export function positive(value) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    fail(400, "올바른 항목을 선택해주세요.");
  return Number(value);
}
export function integer(value, min, max, optional = false) {
  if (optional && (value === "" || value == null)) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    fail(400, "숫자 입력 범위를 확인해주세요.");
  return value;
}
