// Client-side (browser) calls only — relative paths, same-origin through the
// existing nginx proxy in production and through next.config.ts's rewrite in
// local `next dev`. Mirrors lib/community-api.ts's apiFetch pattern. Every
// call here wraps an existing API (Spring AdminController/AdminMemberController
// under /api/admin, board-service's /api/board/admin — see
// board-service/src/admin.js); no new backend API was added for this screen.
//
// board-service also exposes GET /api/board/admin/members, but
// assignment-frontend never calls it (member management uses only the Spring
// /api/admin/members endpoints below) — intentionally not wrapped here.
import {ApiError} from './community-api';
import type {
  AdminBadge,
  AdminMember,
  AdminOverview,
  AdminPost,
  AdminReport,
  BoardOverview,
  MemberAction,
  MemberField,
  MemberStatus,
  MemberUpdateInput,
  ModerationLog,
  Page,
  ReportReviewInput,
  ReportStatus,
  VehicleVerification,
} from './admin-types';

export {ApiError};

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

// GET /api/admin/overview (Spring core)
export async function fetchAdminOverview(): Promise<AdminOverview> {
  return apiFetch<AdminOverview>('/api/admin/overview');
}

// GET /api/board/admin/overview
export async function fetchBoardOverview(): Promise<BoardOverview> {
  return apiFetch<BoardOverview>('/api/board/admin/overview');
}

// GET /api/admin/members
export async function fetchMembers(params: {
  q?: string;
  field?: MemberField;
  status?: MemberStatus | '';
  page?: number;
}): Promise<Page<AdminMember>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.field) query.set('field', params.field);
  if (params.status) query.set('status', params.status);
  query.set('page', String(params.page ?? 1));
  return apiFetch<Page<AdminMember>>(`/api/admin/members?${query}`);
}

// GET /api/admin/members/:id
export async function fetchMember(id: number): Promise<AdminMember> {
  return apiFetch<AdminMember>(`/api/admin/members/${id}`);
}

// PATCH /api/admin/members/:id — the server enforces last-admin protection,
// self-edit restrictions and the optimistic lock; the client just forwards
// its message on failure.
export async function updateMember(id: number, input: MemberUpdateInput): Promise<AdminMember> {
  return apiFetch<AdminMember>(`/api/admin/members/${id}`, jsonInit('PATCH', input));
}

// POST /api/admin/members/:id/password-reset
export async function resetMemberPassword(id: number): Promise<{message: string}> {
  return apiFetch(`/api/admin/members/${id}/password-reset`, jsonInit('POST', {}));
}

// GET /api/admin/members/:id/actions — most recent 50.
export async function fetchMemberActions(id: number): Promise<MemberAction[]> {
  return apiFetch<MemberAction[]>(`/api/admin/members/${id}/actions`);
}

// GET /api/board/admin/posts
export async function fetchAdminPosts(params: {q?: string; category?: string; page?: number}): Promise<Page<AdminPost>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.category) query.set('category', params.category);
  query.set('page', String(params.page ?? 1));
  return apiFetch<Page<AdminPost>>(`/api/board/admin/posts?${query}`);
}

// GET /api/board/admin/logs
export async function fetchAdminLogs(params: {q?: string; page?: number}): Promise<Page<ModerationLog>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  query.set('page', String(params.page ?? 1));
  return apiFetch<Page<ModerationLog>>(`/api/board/admin/logs?${query}`);
}

// GET /api/board/admin/reports
export async function fetchAdminReports(params: {q?: string; status?: ReportStatus | ''; page?: number}): Promise<Page<AdminReport>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  query.set('page', String(params.page ?? 1));
  return apiFetch<Page<AdminReport>>(`/api/board/admin/reports?${query}`);
}

// PATCH /api/board/admin/reports/:id
export async function reviewReport(id: number, input: ReportReviewInput): Promise<{id: number; status: ReportStatus; reviewedAt: string}> {
  return apiFetch(`/api/board/admin/reports/${id}`, jsonInit('PATCH', input));
}

// GET /api/board/admin/badges
export async function fetchAdminBadges(): Promise<AdminBadge[]> {
  return apiFetch<AdminBadge[]>('/api/board/admin/badges');
}

// GET /api/admin/vehicle-verifications (Spring core)
export async function fetchVehicleVerifications(): Promise<VehicleVerification[]> {
  return apiFetch<VehicleVerification[]>('/api/admin/vehicle-verifications');
}

// POST /api/admin/vehicle-verifications/:id/approve|reject (Spring core)
export async function decideVehicleVerification(id: number, action: 'approve' | 'reject'): Promise<VehicleVerification> {
  return apiFetch<VehicleVerification>(`/api/admin/vehicle-verifications/${id}/${action}`, jsonInit('POST', {}));
}

// GET /api/garage/vehicle-verifications/:id/document — not fetched; the UI
// links to it directly (cookie auth, new tab), like assignment-frontend.
export function verificationDocumentUrl(id: number): string {
  return `/api/garage/vehicle-verifications/${id}/document`;
}
