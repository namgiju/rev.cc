// Shared response shapes for /admin. Field names mirror the actual API
// responses (Spring AdminController/AdminMemberController,
// board-service/src/admin.js) — keep in sync with those, not with any UI
// wording. No new backend API was added for this screen.

export type MemberStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'WITHDRAWN';
export type MemberRole = 'USER' | 'ADMIN';
export type MemberField = 'username' | 'nickname' | 'email';

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// GET /api/admin/overview
export type AdminOverview = {totalUsers: number; totalVehicles: number};
// GET /api/board/admin/overview
export type BoardOverview = {totalPosts: number; pendingReports: number};

// GET/PATCH /api/admin/members, /api/admin/members/:id
export type AdminMember = {
  id: number;
  username: string;
  nickname: string | null;
  email: string | null;
  joinedAt: string;
  status: MemberStatus;
  role: MemberRole;
  suspendedUntil: string | null;
  kakaoOnly: boolean;
};

export type MemberUpdateInput = {
  nickname: string;
  email: string;
  status: Exclude<MemberStatus, 'WITHDRAWN'>;
  role: MemberRole;
  suspendedUntil: string | null;
};

// GET /api/admin/members/:id/actions — adminId is null for a self-withdraw
// entry (SELF_WITHDRAW:<previous status>), which has no acting admin.
export type MemberAction = {
  adminId: number | null;
  action: string;
  createdAt: string;
};

// GET /api/board/admin/posts
export type AdminPost = {
  id: number;
  title: string;
  category: string;
  authorId: number | null;
  username: string;
  createdAt: string;
  reportCount: number;
};

// GET /api/board/admin/logs — raw moderation_logs row shape (snake_case),
// matching assignment-frontend/js/admin.js's usage exactly.
export type ModerationLog = {
  id: number;
  created_at: string;
  admin_username: string;
  category: string;
  post_title: string;
  post_id: number;
  action_type: 'POST_DELETE' | 'COMMENT_DELETE' | 'REPLY_DELETE' | 'LISTING_DELETE';
  target_id: number;
  target_author_username: string;
  reason: string;
  original_content: string | null;
};

export type ReportStatus = 'pending' | 'resolved' | 'dismissed';

// GET /api/board/admin/reports
export type AdminReport = {
  id: number;
  postId: number;
  title: string;
  category: string;
  reporter: string;
  reason: string;
  status: ReportStatus;
  postDeleted: boolean;
  deletedReason: 'AUTHOR' | 'ADMIN' | null;
  deletedContent: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewer: string | null;
  resolutionNote: string | null;
};

export type ReportReviewInput = {status: 'resolved' | 'dismissed'; note: string};

export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// GET /api/admin/vehicle-verifications
export type VehicleVerification = {
  id: number;
  vehicleId: number;
  username: string;
  licensePlate: string;
  manufacturer: string;
  model: string;
  modelYear: number;
  status: VerificationStatus;
  requestedAt: string;
};

// GET /api/board/admin/badges
export type AdminBadge = {name: string; description: string; holders: number};
