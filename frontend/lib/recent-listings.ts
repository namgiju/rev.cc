// Client-only "최근 본 매물" storage. Same key/shape as the legacy
// assignment-frontend/js/market.js so a browser that visited both the old
// and new frontend during the migration keeps one shared history. The list
// screen reads; the listing detail page writes (remember/forget).
const STORAGE_KEY = 'revcc:recent-listings:v1';
const MAX_ITEMS = 5;

export type RecentListing = {id: number; title: string; price: number; viewedAt: number};

export function readRecentListings(): RecentListing[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    const seen = new Set<number>();
    return (data as unknown[])
      .filter((p): p is RecentListing => {
        const candidate = p as Partial<RecentListing> | null;
        return (
          !!candidate &&
          Number.isSafeInteger(candidate.id) &&
          (candidate.id as number) > 0 &&
          typeof candidate.title === 'string' &&
          candidate.title.length <= 150 &&
          Number.isFinite(candidate.price) &&
          (candidate.price as number) >= 0 &&
          !seen.has(candidate.id as number) &&
          seen.add(candidate.id as number) !== undefined
        );
      })
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export {STORAGE_KEY as RECENT_LISTINGS_STORAGE_KEY};

// Same as market.js's remember(): newest first, de-duplicated, max 5.
export function rememberRecentListing(listing: {id: number; title: string; price: number}): void {
  try {
    const next = [
      {id: listing.id, title: listing.title, price: listing.price, viewedAt: Date.now()},
      ...readRecentListings().filter((p) => p.id !== listing.id),
    ].slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

// Same as market.js's forget(): drop a listing that turned out to be
// deleted/missing (the detail page got a 404).
export function forgetRecentListing(id: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readRecentListings().filter((p) => p.id !== id)));
  } catch {}
}
