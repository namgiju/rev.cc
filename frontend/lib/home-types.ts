// Shared response shapes for the main page. Field names mirror board-service's
// actual SQL column aliases (board-service/src/community.js, market.js) —
// keep these in sync with that API, not with any UI wording.
export type SessionUser = {id: number; username: string; role?: string};

export const POST_CATEGORIES = ['free', 'maintenance', 'parts', 'drive'] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export type Post = {
  id: number;
  title: string;
  content: string;
  category: string;
  authorId: number | null;
  username: string;
  createdAt: string;
  updatedAt?: string | null;
  imageIds: number[];
  views: number;
  commentCount: number;
  likeCount: number;
  vehicle?: string;
};

export type GarageEntry = {
  id: number;
  ownerId: number;
  username: string;
  model: string;
  year: number;
  trim?: string;
  bio?: string;
  imageId: number | null;
  recordCount: number;
};

export type Listing = {
  id: number;
  sellerId: number | null;
  username: string;
  title: string;
  price: number;
  category: string;
  status: string;
  imageIds: number[];
  vehicle: string;
  region: string;
  createdAt: string;
  views: number;
};
