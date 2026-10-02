// Server Component data fetching only. Next's rewrite in next.config.ts only
// rewrites requests that hit this app's own HTTP server — a server-side
// `fetch` during SSR never goes through it, so this calls the backend origin
// directly. All endpoints used here are public (no auth middleware in
// board-service), so no session cookie needs to be forwarded.
import type {GarageEntry, Listing, Post} from './home-types';

const API_ORIGIN = process.env.REVCC_API_ORIGIN || 'http://localhost:8090';

async function serverApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_ORIGIN}${path}`, {cache: 'no-store'});
  if (!res.ok) throw new Error(`요청을 처리하지 못했습니다. (${res.status})`);
  return res.json() as Promise<T>;
}

export async function fetchTodayPostsServer(
  params: {category?: string; period?: string; limit?: number} = {},
): Promise<Post[]> {
  const query = new URLSearchParams({sort: 'popular', limit: String(params.limit ?? 4)});
  if (params.category) query.set('category', params.category);
  if (params.period) query.set('period', params.period);
  return serverApi<Post[]>(`/api/board/posts?${query}`);
}

// "실시간 인기" 사이드바: assignment-frontend/js/community-list.js의 popular()와
// 동일한 호출(sort=popular, 기간 제한 없음)을 재사용한다. 새 API 없음.
export async function fetchPopularPostsServer(limit = 10): Promise<Post[]> {
  return serverApi<Post[]>(`/api/board/posts?sort=popular&limit=${limit}`);
}

export async function fetchPublicGarageServer(): Promise<GarageEntry[]> {
  return serverApi<GarageEntry[]>('/api/board/garage');
}

export async function fetchLatestListingsServer(limit = 2): Promise<{items: Listing[]; total: number}> {
  const query = new URLSearchParams({sort: 'latest', status: 'selling', limit: String(limit)});
  return serverApi<{items: Listing[]; total: number}>(`/api/parts/listings?${query}`);
}
