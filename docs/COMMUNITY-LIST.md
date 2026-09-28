# Community desktop discovery layout

2026-09-22. Reference: `references/badges/커뮤니티레퍼런스2.png` (filename may use decomposed Korean). `references/ui` and `references/badgex` were not present. The active Vanilla frontend is the only implementation target.

## Existing flow and reuse

`app.js` owns category/query/vehicle/scope/sort/page state, `refreshPosts`, `showScope`, the existing composer, session restoration and post detail actions. `GET /api/board/posts` accepts latest/popular and mine/commented/bookmarks scopes. Popular order is likes, comments, then descending id. There is no independent comments sort or total-count response.

The listing now has a left category/quick-access column, main feed, and right popularity/personal-vehicle/recent-history column. Main rows use real title, category, author, timestamp, views, likes, comments and first attached image. All post links reuse `getPostUrl`.

`community-list.js` supplies only list presentation, supplementary lookups, query synchronization and browser history. `app.js` continues handling the feed and mutations. Existing category buttons and search/filter inputs bind to the same handlers. Query, category, sort, vehicle and scope persist in the URL for reload/back navigation. Pagination remains the existing 20-item “more” action; no fabricated page counts or client-only ranking.

## Data sources

- Feed and quick access: existing `/api/board/posts`, `scope=mine|commented|bookmarks`.
- Popular sidebar: `/api/board/posts?sort=popular&limit=5`, all-time existing ranking; no new “live” analytics.
- MY GARAGE: `/api/board/members/{sessionUser.id}`, selected `representativeVehicle` first, then own vehicle fallback. Session comes from existing `/api/board/me`.
- Guest, empty vehicle, actual vehicle, loading and failure states are separate. Failure is not treated as an empty garage. Stale responses are ignored when session identity changes.
- Recent posts: localStorage `revcc:recent-posts:v1`; only successfully opened detail pages are recorded. Store id/category/title/viewedAt, deduplicate by id, retain five. Bad/blocked storage does not break the page. A visited 404 is removed. Records belong to this browser, not an account, and are labelled accordingly.

No new API, DB table, dependency or framework. No ad art, dummy counts, users, cars or posts in application code. NAV/Footer and the post-detail three-column styles remain separate.

## Files

- Changed `assignment-frontend/community/index.html`, `assignment-frontend/js/app.js`.
- Added `assignment-frontend/js/community-list.js`, `assignment-frontend/css/community-list.css`.
- Added `scripts/community-list-browser.cjs`; extended `scripts/post-detail-live.cjs` for actual session/representative vehicle/scoped feed checks.
- Tightened `scripts/home-garage-browser.cjs` NAV selectors because the shared Footer also contains service links.

## Validation

- Listing browser fixtures: desktop columns, anonymous/USER/ADMIN, own/empty/error garage, categories, query/reset/sort/scopes/reload, loading more, recent history cap/dedup/corrupt storage, popular-to-detail-to-list, composer entry, Footer and 390px overflow.
- Real HTTP/browser accounts: selected representative vehicle, USER/ADMIN own mini garage, scoped own posts and guest state. Existing four-category detail, author/viewer, like/bookmark/comment/reply/permissions and canonical direct/reload/hash/mismatch/back/404 tests.
- Existing detail browser tests: edit/delete/report/copy and sidebars failure isolation.
- Existing home garage test: personal vehicle CRUD/registration/photos/records/profile/representative selection/guestbook, verification/admin navigation and logout/reload/session races.

Temporary account data is cleaned by the live test scripts. Desktop is primary; at narrower widths the right column moves below the feed, then all columns stack. No broad mobile redesign.

## Limits

No separate comments-only sorting, total/page-number pagination, account-synced recent history, or vehicle-model normalization was added. Existing APIs and “more” pagination remain authoritative. Browser recent titles may be stale after another user edits/deletes a post; opening a missing post retains the existing 404 UI and removes that history entry.
