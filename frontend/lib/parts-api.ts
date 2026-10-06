// Client-side (browser) calls only — relative paths, same-origin through the
// existing nginx proxy in production and through next.config.ts's rewrite in
// local `next dev`. Mirrors lib/community-api.ts's apiFetch pattern. Every
// call here wraps an existing board-service endpoint
// (board-service/src/market.js); no new API was added for this.
import {ApiError} from './community-api';
import type {Listing, ListingDetail, ListingFilters, ListingInput, ListingStatus, ListingsPage} from './parts-types';

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

// GET /api/parts/listings
export async function fetchListings(filters: ListingFilters = {}): Promise<ListingsPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return apiFetch<ListingsPage>('/api/parts/listings?' + params);
}

// GET /api/parts/listings/:id
export async function fetchListing(id: number): Promise<ListingDetail> {
  return apiFetch<ListingDetail>(`/api/parts/listings/${id}`);
}

// POST /api/parts/listings
export async function createListing(input: ListingInput): Promise<{id: number}> {
  return apiFetch<{id: number}>('/api/parts/listings', jsonInit('POST', input));
}

// PUT /api/parts/listings/:id
export async function updateListing(id: number, input: ListingInput): Promise<{id: number}> {
  return apiFetch<{id: number}>(`/api/parts/listings/${id}`, jsonInit('PUT', input));
}

// PATCH /api/parts/listings/:id/status
export async function setListingStatus(id: number, status: ListingStatus): Promise<{ok: true}> {
  return apiFetch<{ok: true}>(`/api/parts/listings/${id}/status`, jsonInit('PATCH', {status}));
}

// DELETE /api/parts/listings/:id — reason is required only for an admin
// deleting someone else's listing (board-service's deleteListing()).
export async function deleteListing(id: number, reason?: string): Promise<{ok: true}> {
  return apiFetch<{ok: true}>(`/api/parts/listings/${id}`, jsonInit('DELETE', {reason}));
}

// PUT /api/parts/listings/:id/favorite
export async function setListingFavorite(id: number, active: boolean): Promise<{ok: true}> {
  return apiFetch<{ok: true}>(`/api/parts/listings/${id}/favorite`, jsonInit('PUT', {active}));
}

// POST /api/parts/listings/:id/view
export async function recordListingView(id: number): Promise<{views: number}> {
  return apiFetch<{views: number}>(`/api/parts/listings/${id}/view`, jsonInit('POST', {}));
}
