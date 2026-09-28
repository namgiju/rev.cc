export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export function text(value, max, required = true) {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(400, `입력 내용을 확인해주세요. (최대 ${max}자)`);
  return value.trim();
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
