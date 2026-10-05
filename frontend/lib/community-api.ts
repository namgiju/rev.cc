// Client-side (browser) calls only — relative paths, same-origin through the
// existing nginx proxy in production and through next.config.ts's rewrite in
// local `next dev`. Mirrors lib/home-api.ts's apiFetch pattern. Every call
// here wraps an existing board-service endpoint (board-service/src/community.js);
// no new API was added for this.
import type {
  CommunityComment,
  CommunityMember,
  CommunityNotification,
  GarageCard,
  GuestbookPage,
  PublicVehicle,
  CommunityPost,
  CommunityReport,
  MyVehicle,
  PostInput,
} from './community-types';
import type {PostCategory} from './home-types';

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

function jsonInit(method: string, body: unknown): RequestInit {
  return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
}

export type FetchPostsParams = {
  q?: string;
  category?: PostCategory | '';
  sort?: 'latest' | 'popular';
  // 'mine' | 'bookmarks' | 'commented' require a logged-in session —
  // board-service returns 401 otherwise (community.js: `if (scope && !req.user)`).
  scope?: '' | 'mine' | 'bookmarks' | 'commented';
  vehicle?: string;
  page?: number;
  limit?: number;
};

// GET /api/board/posts
export async function fetchPosts(params: FetchPostsParams = {}): Promise<CommunityPost[]> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.category) query.set('category', params.category);
  if (params.sort) query.set('sort', params.sort);
  if (params.scope) query.set('scope', params.scope);
  if (params.vehicle) query.set('vehicle', params.vehicle);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiFetch<CommunityPost[]>(`/api/board/posts${qs ? `?${qs}` : ''}`);
}

// GET /api/board/posts/:id — liked/bookmarked reflect the current session
// (false for anonymous requests, not omitted).
export async function fetchPost(id: number): Promise<CommunityPost> {
  return apiFetch<CommunityPost>(`/api/board/posts/${id}`);
}

// POST /api/board/posts/:id/view — anonymous, rate limited. Returns the new
// count. Called once per post per page load, like app.js's `viewed` Set.
export async function recordPostView(id: number): Promise<{views: number}> {
  return apiFetch(`/api/board/posts/${id}/view`, jsonInit('POST', {}));
}

// GET /api/board/members/:id — public author profile (joined date, activity
// counts, vehicles, verified-owner badge, their recent posts).
export async function fetchMember(id: number): Promise<CommunityMember> {
  return apiFetch<CommunityMember>(`/api/board/members/${id}`);
}

// PUT /api/board/posts/:id/like — idempotent toggle. Requires login.
export async function setPostLike(id: number, active: boolean): Promise<{active: boolean}> {
  return apiFetch(`/api/board/posts/${id}/like`, jsonInit('PUT', {active}));
}

// PUT /api/board/posts/:id/bookmark — idempotent toggle. Requires login.
export async function setPostBookmark(id: number, active: boolean): Promise<{active: boolean}> {
  return apiFetch(`/api/board/posts/${id}/bookmark`, jsonInit('PUT', {active}));
}

// DELETE /api/board/posts/:id — same body rules as deleteComment: the author
// sends no reason, an admin removing someone else's post must send one.
export async function deletePost(id: number, reason?: string): Promise<{ok: true}> {
  return apiFetch(`/api/board/posts/${id}`, jsonInit('DELETE', reason === undefined ? {} : {reason}));
}

// GET /api/board/posts/:id/comments
export async function fetchComments(postId: number): Promise<CommunityComment[]> {
  return apiFetch<CommunityComment[]>(`/api/board/posts/${postId}/comments`);
}

// POST /api/board/posts/:id/comments — omit parentId (or pass null) for a
// top-level comment; pass a top-level comment's id to reply to it.
export async function createComment(
  postId: number,
  content: string,
  parentId: number | null = null,
): Promise<{id: number}> {
  return apiFetch(`/api/board/posts/${postId}/comments`, jsonInit('POST', {content, parentId}));
}

// DELETE /api/board/comments/:commentId — deleting your own comment needs no
// reason; moderating another member's comment does (board-service enforces
// this — see moderation.js). Always sends a body, matching the existing
// assignment-frontend client (app.js's requestContentDeletion).
export async function deleteComment(commentId: number, reason?: string): Promise<{ok: true}> {
  return apiFetch(`/api/board/comments/${commentId}`, jsonInit('DELETE', reason === undefined ? {} : {reason}));
}

// POST /api/board/posts/:id/report — one active report per (user, post);
// resubmitting while still pending updates the reason instead of duplicating.
export async function reportPost(postId: number, reason: string): Promise<{id: number}> {
  return apiFetch(`/api/board/posts/${postId}/report`, jsonInit('POST', {reason}));
}

// GET /api/board/reports — the current user's own report history.
export async function fetchMyReports(): Promise<CommunityReport[]> {
  return apiFetch<CommunityReport[]>('/api/board/reports');
}

// POST /api/board/posts — returns the new post (id, category, ...).
export async function createPost(input: PostInput): Promise<{id: number; category: PostCategory}> {
  return apiFetch('/api/board/posts', jsonInit('POST', input));
}

// PUT /api/board/posts/:id — author only (403 otherwise, admins included).
export async function updatePost(id: number, input: PostInput): Promise<{id: number; category: PostCategory}> {
  return apiFetch(`/api/board/posts/${id}`, jsonInit('PUT', input));
}

// GET /api/board/garage/mine — the signed-in member's own vehicles.
export async function fetchMyVehicles(): Promise<MyVehicle[]> {
  return apiFetch<MyVehicle[]>('/api/board/garage/mine');
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// POST /api/board/images with a data: URL body, like app.js's uploadFile().
// The type/size check mirrors the server's limits so bad files fail fast.
export async function uploadImage(file: File): Promise<number> {
  if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES)
    throw new Error('JPG, PNG, WebP 사진을 장당 3MB 이하로 선택해주세요.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
    reader.readAsDataURL(file);
  });
  return (await apiFetch<{id: number}>('/api/board/images', jsonInit('POST', {data}))).id;
}

// GET /api/board/notifications
export async function fetchNotifications(): Promise<CommunityNotification[]> {
  return apiFetch<CommunityNotification[]>('/api/board/notifications');
}

// PUT /api/board/notifications/read — marks every notification read.
export async function markNotificationsRead(): Promise<{ok: true}> {
  return apiFetch('/api/board/notifications/read', jsonInit('PUT', {}));
}

// GET /api/board/garage?owner=:id
export async function fetchMemberGarage(ownerId: number): Promise<GarageCard[]> {
  return apiFetch<GarageCard[]>(`/api/board/garage?owner=${ownerId}`);
}

// GET /api/board/garage/:id
export async function fetchPublicVehicle(id: number): Promise<PublicVehicle> {
  return apiFetch<PublicVehicle>(`/api/board/garage/${id}`);
}

// GET /api/board/members/:id/guestbook[?before=cursor]
export async function fetchGuestbook(ownerId: number, before?: number | null): Promise<GuestbookPage> {
  return apiFetch<GuestbookPage>(`/api/board/members/${ownerId}/guestbook${before ? `?before=${before}` : ''}`);
}

// POST /api/board/members/:id/guestbook — login required, 1000 chars.
export async function createGuestbookEntry(ownerId: number, content: string): Promise<{id: number}> {
  return apiFetch(`/api/board/members/${ownerId}/guestbook`, jsonInit('POST', {content}));
}

// DELETE /api/board/members/:id/guestbook/:entryId — entry author or owner.
export async function deleteGuestbookEntry(ownerId: number, entryId: number): Promise<{ok: true}> {
  return apiFetch(`/api/board/members/${ownerId}/guestbook/${entryId}`, jsonInit('DELETE', {}));
}
