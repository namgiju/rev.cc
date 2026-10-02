// Shared response shapes for the community migration. Field names mirror
// board-service's actual SQL column aliases (board-service/src/community.js,
// member-display.js, image-references.js, badges.js) — keep these in sync
// with that API, not with any UI wording. Do not add fields the API does not
// actually return.
import type {PostCategory} from './home-types';

// Withdrawn-author fields (authorId, vehicleId, etc.) are NULLed server-side
// by member-display.js's unlessWithdrawnSql/publicMemberId — never recompute
// "is this a withdrawn author" on the client from other fields.
export type PublicMemberId = number | null;

export type LinkedVehicle = {
  id: number;
  model: string;
  year: number;
  verified: boolean;
  imageId: number | null;
};

// GET /api/board/posts and GET /api/board/posts/:id share this shape.
// liked/bookmarked/commentCount/likeCount are computed per the requesting
// session (anonymous requests get liked: false, bookmarked: false).
export type CommunityPost = {
  id: number;
  title: string;
  content: string;
  category: PostCategory;
  authorId: PublicMemberId;
  username: string;
  authorWithdrawn: boolean;
  // Free-text vehicle label (always a string, '' when none). Independent of
  // vehicleId/linkedVehicle, which point at the author's actual garage entry.
  vehicle: string;
  vehicleId: number | null;
  linkedVehicle: LinkedVehicle | null;
  // First/only vehicle model text for the author, used as a fallback display
  // (e.g. "오너" when absent) — see assignment-frontend/js/app.js renderPost.
  ownerVehicle: string | null;
  imageIds: number[];
  views: number;
  commentCount: number;
  likeCount: number;
  liked: boolean;
  bookmarked: boolean;
  createdAt: string;
  updatedAt: string | null;
};

// GET /api/board/posts/:id/comments. Flat list: top-level comments have
// parentId === null; replies reference a top-level comment's id (board-service
// only allows one level of nesting — see community.js's INSERT ... WITH target).
// A deleted comment keeps its row (content cleared server-side) so replies
// underneath it are not orphaned.
export type CommunityComment = {
  id: number;
  content: string;
  deleted: boolean;
  parentId: number | null;
  authorId: PublicMemberId;
  username: string;
  authorWithdrawn: boolean;
  createdAt: string;
};

// GET /api/board/reports (the current user's own report history).
// status is set by board-service/an admin; only 'pending' is guaranteed by
// the API contract (board_posts.status has no DB CHECK constraint), the
// values the existing UI distinguishes are 'pending' | 'resolved' | 'dismissed'.
export type CommunityReport = {
  id: number;
  reason: string;
  status: string;
  createdAt: string;
  postId: number;
  title: string;
  category: PostCategory;
};

// Derived from owner_vehicles.verified — see board-service/src/badges.js.
// There is currently exactly one possible badge (imageUrl is always null).
export type CommunityBadge = {
  code: string;
  name: string;
  description: string;
  imageUrl: string | null;
};

// Public vehicle fields only (GET /api/board/members/:id). License plate,
// verification documents and other private fields are never included here —
// see community.js's members/:id vehicles query.
export type MemberVehicle = {
  id: number;
  manufacturer: string;
  model: string;
  year: number;
  trim: string;
  nickname: string;
  imageId: number | null;
  verified: boolean;
};

// GET /api/board/members/:id. Withdrawn members 404 (no public profile).
// bio/avatarImageId/coverImageId/representativeVehicleId are only present
// when the member has ever saved profile settings (member_profiles row) —
// treat them as optional, not just nullable.
export type CommunityMember = {
  id: number;
  username: string;
  joinedAt: string | null;
  postCount: number;
  commentCount: number;
  receivedLikes: number;
  bio?: string | null;
  avatarImageId?: number | null;
  coverImageId?: number | null;
  representativeVehicleId?: number | null;
  avatarUrl: string | null;
  vehicles: MemberVehicle[];
  representativeVehicle: MemberVehicle | null;
  verified: boolean;
  badges: CommunityBadge[];
  posts: CommunityPost[];
};
