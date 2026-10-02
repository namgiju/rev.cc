// Client-side (browser) calls only. Relative paths — same-origin through the
// existing nginx proxy in production, and through next.config.ts's rewrite
// in local `next dev`. Mirrors assignment-frontend/js/app.js's api() helper.
import type {Post, SessionUser} from './home-types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {credentials: 'same-origin', cache: 'no-store', ...init});
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.message || `요청을 처리하지 못했습니다. (${res.status})`, res.status);
  return data as T;
}

export async function fetchSession(): Promise<SessionUser | null> {
  try {
    return await apiFetch<SessionUser>('/api/board/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  });
}

export async function fetchUnreadCount(): Promise<number> {
  const notes = await apiFetch<{isRead: boolean}[]>('/api/board/notifications');
  return notes.filter((n) => !n.isRead).length;
}

export async function fetchTodayPosts(
  params: {category?: string; period?: string; limit?: number} = {},
): Promise<Post[]> {
  const query = new URLSearchParams({sort: 'popular', limit: String(params.limit ?? 4)});
  if (params.category) query.set('category', params.category);
  if (params.period) query.set('period', params.period);
  return apiFetch<Post[]>(`/api/board/posts?${query}`);
}
