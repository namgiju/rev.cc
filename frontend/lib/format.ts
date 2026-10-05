import {POST_CATEGORIES} from './home-types';

export const CATEGORY_LABELS: Record<string, string> = {
  free: '자유',
  maintenance: '정비/DIY',
  parts: '부품',
  drive: '드라이브',
};

export function imageUrl(id: number): string {
  return `/api/board/images/${id}`;
}

// Matches assignment-frontend/js/post-url.js exactly: same categories, same
// fallback — a post page shared between the legacy static site and this app
// must resolve to the same URL either way.
export function postUrl(post: {id: number; category: string}): string {
  const category = (POST_CATEGORIES as readonly string[]).includes(post.category)
    ? post.category
    : 'free';
  return `/community/${category}/${post.id}`;
}

export function formatMoney(value: number): string {
  return `${value.toLocaleString('ko-KR')}원`;
}

export function timeAgo(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return '방금 전';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

// "오늘의 차고" 선정 기준: 새 추천 알고리즘/테이블을 만들지 않고, 이미 공개된
// /api/board/garage 목록(최근 등록 순, 최대 100대) 안에서 사진이 있는 차량을
// 우선으로 날짜 시드 난수로 하나를 고른다. 같은 날에는 누가 보든 같은 차량이
// 나오고(= "오늘의"), 날짜가 바뀌면 다른 차량으로 바뀐다. 사진 있는 차량이
// 하나도 없으면 전체 목록에서 고른다.
export function pickGarageSpotlight<T extends {imageId: number | null}>(vehicles: T[]): T | null {
  const withPhoto = vehicles.filter((v) => v.imageId != null);
  const pool = withPhoto.length ? withPhoto : vehicles;
  if (!pool.length) return null;
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return pool[dayIndex % pool.length];
}

// assignment-frontend/js/app.js's dateText(): "2026. 10. 5. 오후 3:12".
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {dateStyle: 'medium', timeStyle: 'short'});
}
