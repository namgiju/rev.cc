# Actual admin operations

The `/admin` mock arrays and fixed statistics are removed. The existing layout, NAV and Spring vehicle-verification endpoints are retained.

## Connected features

- Overview combines existing Spring `/api/admin/overview` member/vehicle counts with `/api/board/admin/overview` post count and pending report count.
- Members: actual username, role, known signup timestamp, authored-post count and owned-vehicle count. Unknown legacy signup dates are shown as unknown. No invented activity/suspension status.
- Posts: actual title, author, category, report count and creation time. Links reuse `getPostUrl`; admins do not gain authorship edit/delete rights.
- Members/posts/reports support search and 20-row pagination; posts support category filtering and reports support status filtering. No client-side fake totals.
- Reports: actual submitted reports; pending -> resolved or dismissed with a required review note. The server records the authenticated reviewer and timestamp. Atomic pending-only updates reject duplicate/concurrent processing with 409. A reporter cannot overwrite an already processed report through resubmission.
- Badges: real distinct verified-vehicle owners, using the same `VERIFIED_OWNER_BADGE` definition as the public member API. The unimplemented example tags are removed.
- Vehicle verification: existing Spring list/document/approve/reject flow remains unchanged.

## API and schema

New operational routes, colocated with Node's existing board tables:

- GET `/api/board/admin/overview`
- GET `/api/board/admin/members?q=&page=`
- GET `/api/board/admin/posts?q=&category=&page=`
- GET `/api/board/admin/reports?q=&status=&page=`
- PATCH `/api/board/admin/reports/:id` with `{status:"resolved"|"dismissed",note:"..."}`
- GET `/api/board/admin/badges`

All these routes require the existing Redis cookie session and ADMIN role, then confirm that the same user still has ADMIN in PostgreSQL. SQL inputs are parameterized and results contain no password hashes. No session structure or Nginx proxy routing changed. Auth failures hide the operations screen; focus rechecks its access.

The existing `community_reports` table gains `reviewed_by`, `reviewed_at`, `resolution_note` and a `(status,id DESC)` index via idempotent startup SQL. No new member/post status or duplicate report table was added.

## Deliberate limits

Member suspension, post hiding/deletion by moderators, role assignment, manual badge/tag grants, marketplace moderation and report reopening are not implemented. Report processing records a review outcome and does not sanction a member or hide content; the dialog states this. Such policies require separate service-wide enforcement.

Existing post deletion still cascades to its reports. Review records are not a permanent independent audit archive. Persisting deleted-content evidence and longer-term moderation history needs a separate retention design.

## Files

New: `board-service/src/admin.js`, `board-service/src/badges.js`, `scripts/admin-system.mjs`, `scripts/admin-browser.cjs`, this document.

Changed: `board-service/src/app.js`, `community.js`, `schema.sql`; `assignment-frontend/admin/index.html`, `js/admin.js`, `js/app.js` (report state labels), `css/dashboard.css`; outdated explanatory comment in Spring `AdminController.java`.

## Tests

- Docker board build: existing unit tests pass.
- `scripts/admin-system.mjs`: isolated PostgreSQL schema, applied twice; actual counts, search/filters/pagination, permission checks including stale ADMIN sessions, private-field exclusion, report processing/audit/conflicts, derived badge counts and unchanged author-only post mutation.
- `scripts/admin-browser.cjs`: real temporary USER/ADMIN accounts, real report creation/review/reload, real tables/search/canonical links/badges, denial of USER operations and existing vehicle API. Test accounts, reports, posts and sessions are removed afterward.
- Existing `scripts/community-system.mjs` and `scripts/home-garage-browser.cjs`: passed, including actual vehicle verification approval and garage/community regressions.
