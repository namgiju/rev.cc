// Board categories / activity scopes shared by the community list and the
// post editor (assignment-frontend/community/index.html's left navigation).
export type Category = '' | 'free' | 'maintenance' | 'parts' | 'drive';
export type ActivityScope = 'mine' | 'bookmarks' | 'commented';
export type Scope = '' | ActivityScope;

export const HEADINGS: Record<Category, [string, string]> = {
  '': ['전체 게시글', '차를 좋아하는 사람들의 이야기, 궁금한 점과 경험을 함께 나눠보세요.'],
  free: ['자유게시판', '자동차와 관련된 모든 이야기를 자유롭게 나누는 공간입니다.'],
  maintenance: ['정비 / DIY', '정비 경험과 직접 관리하는 노하우를 나눠보세요.'],
  parts: ['부품 이야기', '부품 선택부터 장착 후기까지, 함께 이야기해요.'],
  drive: ['드라이브', '좋았던 길과 함께 달리고 싶은 순간을 공유해요.'],
};
export const CATEGORY_TABS: Category[] = ['', 'free', 'maintenance', 'parts', 'drive'];
export const SCOPE_LABELS: Record<ActivityScope, string> = {
  mine: '내가 쓴 글',
  bookmarks: '저장한 글',
  commented: '댓글 남긴 글',
};

export function isCategory(value: string | null): value is Exclude<Category, ''> {
  return value === 'free' || value === 'maintenance' || value === 'parts' || value === 'drive';
}
export function isScope(value: string | null): value is ActivityScope {
  return value === 'mine' || value === 'bookmarks' || value === 'commented';
}

// "＋ 글쓰기" target: the editor preselects the board the user is looking at.
export function newPostHref(category: Category | string = ''): string {
  return isCategory(category) ? `/community/new?category=${category}` : '/community/new';
}
