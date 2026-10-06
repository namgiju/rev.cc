// Spring core /api/auth/* calls for the auth screens. The HttpOnly session
// cookie is set by the server; nothing is stored client-side.
import {ApiError} from './home-api';

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {credentials: 'same-origin', cache: 'no-store', ...init});
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.message || '', res.status);
  return data as T;
}

export type AuthUser = {id: number; username: string; role: string};

export function login(username: string, password: string): Promise<AuthUser> {
  return authFetch<AuthUser>('/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username, password}),
  });
}

export function fetchAuthMe(): Promise<AuthUser> {
  return authFetch<AuthUser>('/api/auth/me');
}

export function checkUsername(username: string): Promise<{available: boolean}> {
  return authFetch<{available: boolean}>('/api/auth/check-username?' + new URLSearchParams({username}));
}

export function signup(username: string, password: string, email: string): Promise<unknown> {
  return authFetch('/api/auth/signup', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username, password, ...(email ? {email} : {})}),
  });
}

// password-reset.js's post(): unlike authFetch/ApiError, the final error
// message depends on the step — only the "request" step's known failure
// codes (USERNAME_NOT_FOUND/IDENTITY_MISMATCH/SOCIAL_ACCOUNT/MAIL_UNAVAILABLE)
// surface the server's own message; everything else (verify/complete, or any
// other request-step failure) gets one of three fixed messages by status.
type PasswordResetStep = 'request' | 'verify' | 'complete';
const PASSWORD_RESET_REQUEST_CODES = ['USERNAME_NOT_FOUND', 'IDENTITY_MISMATCH', 'SOCIAL_ACCOUNT', 'MAIL_UNAVAILABLE'];

async function passwordResetFetch<T>(step: PasswordResetStep, body: unknown): Promise<T> {
  const res = await fetch('/api/auth/password-reset/' + step, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && step === 'request' && PASSWORD_RESET_REQUEST_CODES.includes(data?.code)) throw new Error(data.message);
  if (!res.ok)
    throw new Error(
      res.status === 429
        ? '요청이 많습니다. 잠시 후 다시 시도해주세요.'
        : res.status === 503
          ? '메일 인증 설정을 확인 중입니다. 잠시 후 다시 시도해주세요.'
          : '인증 정보 또는 입력값을 확인해주세요. 만료된 경우 처음부터 다시 인증해주세요.',
    );
  return data as T;
}

export function requestPasswordReset(username: string, email: string): Promise<{code: string; message: string}> {
  return passwordResetFetch('request', {username, email});
}

export function verifyPasswordReset(email: string, code: string): Promise<{resetToken: string}> {
  return passwordResetFetch('verify', {email, code});
}

export function completePasswordReset(token: string, password: string, confirm: string): Promise<{message: string}> {
  return passwordResetFetch('complete', {token, password, confirm});
}
