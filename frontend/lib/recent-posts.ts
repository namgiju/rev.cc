// Client-only "최근 본 글" storage. Same key/shape as the legacy
// assignment-frontend/js/community-list.js so a browser that visited both
// the old and new frontend during the migration keeps one shared history.
// Only reading is needed for the list screen; writing (remembering a post as
// viewed) belongs to the post detail page, added in a later STEP.
import {POST_CATEGORIES} from './home-types';

const STORAGE_KEY = 'revcc:recent-posts:v1';
const MAX_ITEMS = 5;

export type RecentPost = {id: number; category: string; title: string; viewedAt: number};

export function readRecentPosts(): RecentPost[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    const seen = new Set<number>();
    return (data as unknown[])
      .filter((p): p is RecentPost => {
        const candidate = p as Partial<RecentPost> | null;
        return (
          !!candidate &&
          Number.isSafeInteger(candidate.id) &&
          (candidate.id as number) > 0 &&
          (candidate.id as number) <= 2147483647 &&
          (POST_CATEGORIES as readonly string[]).includes(candidate.category || '') &&
          typeof candidate.title === 'string' &&
          candidate.title.length <= 150 &&
          Number.isFinite(candidate.viewedAt) &&
          !seen.has(candidate.id as number) &&
          seen.add(candidate.id as number) !== undefined
        );
      })
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export {STORAGE_KEY as RECENT_POSTS_STORAGE_KEY};
