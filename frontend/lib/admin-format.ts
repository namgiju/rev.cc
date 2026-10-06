// Small formatting/label helpers shared by the /admin panels. Matches
// assignment-frontend/js/admin.js's `date()`, `categories`, `reportStatuses`
// and the moderation action-type labels used in its logs table exactly.

export function adminDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('ko-KR') : '기록 없음';
}

export const ADMIN_CATEGORY_LABELS: Record<string, string> = {
  free: '자유 이야기',
  maintenance: '정비 / DIY',
  parts: '부품 이야기',
  drive: '드라이브',
};

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '정상',
  SUSPENDED: '이용 정지',
  DISABLED: '비활성',
  WITHDRAWN: '탈퇴',
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  pending: '검토 대기',
  resolved: '처리 완료',
  dismissed: '반려',
};

export const MODERATION_ACTION_LABELS: Record<string, string> = {
  POST_DELETE: '게시글',
  COMMENT_DELETE: '댓글',
  REPLY_DELETE: '답글',
  LISTING_DELETE: '부품 매물',
};

export const VERIFICATION_STATUS_LABELS: Record<string, [string, 'ok' | 'pending' | 'blocked']> = {
  PENDING: ['검토 중', 'pending'],
  APPROVED: ['승인됨', 'ok'],
  REJECTED: ['거절됨', 'blocked'],
};
