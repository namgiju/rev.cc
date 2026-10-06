// Shared response shapes for the parts marketplace (board-service/src/market.js).
// Field names mirror that API's SQL column aliases — keep in sync with the
// server, not with any UI wording. Parts compatibility (GET
// /api/parts/compatibility) is a separate, unrelated garage feature and is
// intentionally out of scope here (2026-10-06 decision, see REVCC_NEXT_TASKS.md).

export const LISTING_CATEGORIES = {
  wheels: '휠 / 타이어',
  suspension: '서스펜션',
  brakes: '브레이크',
  'intake-exhaust': '배기 / 흡배기',
  exterior: '외장 / 바디',
  interior: '내장',
  electronics: '전장 / ECU',
  engine: '엔진 / 구동계',
  other: '기타',
} as const;
export type ListingCategory = keyof typeof LISTING_CATEGORIES;

export const LISTING_STATUSES = {
  selling: '판매중',
  reserved: '예약중',
  sold: '판매완료',
} as const;
export type ListingStatus = keyof typeof LISTING_STATUSES;

export type ListingSort = 'latest' | 'popular' | 'price-low' | 'price-high';
export type ListingScope = '' | 'mine' | 'favorites';

// GET /api/parts/listings item, and GET /api/parts/listings/:id without
// `contact` (board-service only adds contact to the single-item response,
// and only when the viewer is logged in and the seller hasn't withdrawn).
export type Listing = {
  id: number;
  sellerId: number | null;
  username: string;
  sellerWithdrawn: boolean;
  title: string;
  description: string;
  price: number;
  category: ListingCategory;
  status: ListingStatus;
  imageIds: number[];
  vehicle: string;
  region: string;
  views: number;
  createdAt: string;
  updatedAt: string | null;
  favoriteCount: number;
  favorited: boolean;
};

// GET /api/parts/listings/:id. `contact` is present only under the
// conditions above — treat it as possibly absent, never assume it's there.
export type ListingDetail = Listing & {contact?: string};

export type ListingsPage = {
  items: Listing[];
  total: number;
  page: number;
  limit: number;
};

export type ListingFilters = {
  q?: string;
  category?: ListingCategory | '';
  status?: ListingStatus | '';
  region?: string;
  vehicle?: string;
  sort?: ListingSort;
  scope?: ListingScope;
  page?: number;
  limit?: number;
};

// Body of POST /api/parts/listings and PUT /api/parts/listings/:id, exactly
// what assignment-frontend/js/market.js sends (market-form's FormData plus
// price:Number and imageIds).
export type ListingInput = {
  title: string;
  description: string;
  price: number;
  category: ListingCategory | '';
  status: ListingStatus;
  vehicle: string;
  region: string;
  contact: string;
  imageIds: number[];
};
