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
