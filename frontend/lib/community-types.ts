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

// GET /api/board/garage/mine — the editor only needs these fields to offer
// "내 차량 연결" (the endpoint returns more; see community.js).
export type MyVehicle = {
  id: number;
  manufacturer: string | null;
  model: string;
  year: number;
};

// Body of POST /api/board/posts and PUT /api/board/posts/:id, exactly what
// assignment-frontend/js/post-editor.js sends. vehicleId is always present
// (null = not linked): on PUT, omitting it would keep the old link, an explicit
// null unlinks. `vehicle` is the legacy free-text label, kept unless the user
// changes the vehicle link.
export type PostInput = {
  category: PostCategory;
  title: string;
  content: string;
  vehicle: string;
  vehicleId: number | null;
  imageIds: number[];
};

// GET /api/board/notifications (latest 100, deleted posts excluded). kind is
// currently always 'comment' (a comment/reply on your post or comment).
export type CommunityNotification = {
  id: number;
  postId: number;
  isRead: boolean;
  createdAt: string;
  title: string;
  category: PostCategory;
  username: string;
  kind: string;
};

// GET /api/board/members/:id/guestbook — newest first, 20 per page; pass
// nextCursor back as ?before= for the next page. 404 for withdrawn owners.
export type GuestbookEntry = {
  id: number;
  ownerId: number;
  authorId: PublicMemberId;
  username: string;
  authorWithdrawn: boolean;
  content: string;
  createdAt: string;
};
export type GuestbookPage = {items: GuestbookEntry[]; total: number; nextCursor: number | null};

// GET /api/board/garage?owner=:id — public garage cards (max 100, newest first).
export type GarageCard = {
  id: number;
  ownerId: number;
  username: string;
  model: string;
  year: number;
  trim: string | null;
  bio: string | null;
  imageId: number | null;
  recordCount: number;
};

// GET /api/board/garage/:id — one public vehicle with its records.
export type VehicleRecord = {
  id: number;
  kind: string;
  title: string;
  content: string | null;
  mileage: number | null;
  cost: number | null;
  date: string;
};
export type PublicVehicle = Omit<GarageCard, 'recordCount'> & {records: VehicleRecord[]};

// Body of POST /api/board/garage and PUT /api/board/garage/:id (board-service's
// vehicleInput() in community.js) — the public-profile fields of a vehicle row
// (owner_vehicles table): model/year/trim/bio/photo. Distinct from
// OwnerVehicleInput below, which is the same table's core-owned fields
// (manufacturer/licensePlate/verification) via the Spring API.
export type VehicleProfileInput = {
  model: string;
  year: number;
  trim: string;
  bio: string;
  imageId: number | null;
};

export type VehicleRecordKind = 'maintenance' | 'tuning' | 'parts';

// Body of POST /api/board/garage/:id/records (community.js's records route).
export type VehicleRecordInput = {
  kind: VehicleRecordKind;
  title: string;
  content: string;
  date: string;
  mileage: number | null;
  cost: number | null;
};

// GET/POST/PUT /api/garage/vehicles (Spring core, GarageVehicleResponse) — the
// private, owner-only view of a vehicle row: the same owner_vehicles table as
// GarageCard/PublicVehicle/MyVehicle above, but core's columns (manufacturer,
// license plate, verification) instead of board's (model/trim/bio/imageId).
// licensePlate is null on the public-profile response variant
// (withoutLicensePlate()); the owner's own /api/garage/vehicles list always
// includes it.
export type OwnerVehicle = {
  id: number;
  userId: number;
  manufacturer: string;
  model: string;
  modelYear: number;
  trim: string | null;
  transmission: string | null;
  color: string | null;
  nickname: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  username: string;
  licensePlate: string | null;
  verified: boolean;
  verificationStatus: string | null;
  verifiedAt: string | null;
};

// Body of POST/PUT /api/garage/vehicles (GarageVehicleRequest). Only
// manufacturer/model/modelYear/licensePlate are required server-side; the
// rest accept an empty string.
export type OwnerVehicleInput = {
  manufacturer: string;
  model: string;
  modelYear: number;
  trim: string;
  transmission: string;
  color: string;
  nickname: string;
  description: string;
  licensePlate: string;
};

// Body of PUT /api/board/profile (community.js). avatarImageId/coverImageId
// null clears the existing image.
export type MemberProfileInput = {
  bio: string;
  avatarImageId: number | null;
  coverImageId: number | null;
};

// GET /api/auth/withdraw (Spring WithdrawalService.info()).
export type WithdrawInfo = {
  method: 'PASSWORD' | 'KAKAO';
  admin: boolean;
  reservedListings: number;
  available: boolean;
};

// Body of POST /api/auth/withdraw.
export type WithdrawInput = {
  password: string;
  confirm: boolean;
};
