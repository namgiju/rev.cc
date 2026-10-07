// Return-path handling for /login (and later /signup), ported from
// assignment-frontend/js/auth.js's safeReturn(). Same safety rules — a
// same-origin absolute path only, no `//`, backslash or control/space
// characters — with the allow-list extended to the Next.js routes that
// actually send people to /login?next=… (community editor/edit, member
// garage, public vehicle). Anything else falls back to the default target.
const ALLOWED_PATH =
  /^(?:\/|\/home\/?|\/admin\/?|\/parts\/?|\/garage\/?|\/community\/?|\/community\/new|\/community\/(?:free|maintenance|parts|drive)\/[0-9]+(?:\/edit)?|\/community\/(?:members|cars)\/[0-9]+)$/;

export function safeNext(value: string | null, origin: string): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value)) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !ALLOWED_PATH.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

// auth.js's route(): carry a valid `next` across /login ↔ /signup links.
export function withNext(path: string, next: string | null): string {
  return next === null ? path : `${path}?${new URLSearchParams({next})}`;
}
