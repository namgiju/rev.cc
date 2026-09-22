# Community post editor

The Vanilla community page uses one editor for create and edit. `/community?category=maintenance#write-post` starts a new post; the existing detail Edit button opens `/community/{category}/{id}#write-post`. Reload restores the original saved post in edit mode. Unsaved edits are not persisted.

## Reused components and contracts

- `community/index.html` retains the same left navigation and popular-post container as the list. `community-list.js` remains the popular-post renderer.
- `post-editor.js` owns the form lifecycle, category/title/body counters, optional vehicle selector, uploads, dirty confirmation and submission. `app.js` retains shared Redis-session restoration, HTTP/image helpers and the existing detail/actions/comments renderer.
- `RevDropdown` is used for category and vehicle selection. Plain text remains escaped by the existing renderer; there are no unsupported rich-text or draft controls.
- The homepage's previous inline composer now links to the same community editor.
- `GET /api/board/me`, `GET /api/board/garage/mine`, `POST /api/board/images`, existing `GET/POST/PUT /api/board/posts` and `getPostUrl()` are reused. No new endpoint or authentication mechanism was added.

## Vehicle data

`board_posts.vehicle_id` is the only schema addition: an optional foreign key to `owner_vehicles.id`, with `ON DELETE SET NULL`. It is not inferred for legacy text-only posts. Schema startup remains idempotent.

Create/update accepts `vehicleId` (positive own vehicle ID or null). Ownership is checked against `owner_vehicles.owner_id` and the Redis session user. Linking uses the database model name for existing vehicle filters. GET returns `vehicleId` and `linkedVehicle` (id, model, year, verified, imageId only). License plates and verification documents are not exposed. Explicit null unlinks the vehicle. Legacy update clients omitting `vehicleId` retain an existing link and its vehicle label.

The detail's existing related-vehicle card prioritizes `linkedVehicle`; the author profile and badges still use `post.authorId`. Editing is owner-only for USER and ADMIN alike. The API's author predicate is unchanged.

## Images and limitations

Photos use the existing PostgreSQL `community_images` upload endpoint and image ownership checks. JPG/PNG/WebP, 3 MB per image, maximum three images. Existing images populate the same editable preview list. The UI provides upload status, remove, retryable errors, a submission lock and stale-response guards when identity changes.

Title limit remains 150 characters, body 5,000. No new rich-text format, server drafts, image storage service or OAuth return route was introduced. Kakao retains its existing login redirect. Uploaded images removed before submission can remain unreferenced in the existing image store; garbage collection is a separate existing storage concern.

## Validation

Real isolated PostgreSQL API checks: `docker compose exec -T board node --input-type=module < scripts/community-system.mjs`.

Real browser/session checks: `scripts/post-editor-browser.cjs` creates unique temporary USER and ADMIN accounts and cleans them and their data up. It covers all four categories, optional own vehicles, forged links, unauthorized edits, uploads/removal, existing images on edit, canonical navigation, reload, duplicate submission, dirty cancellation, vehicle-fetch retry, session revocation and shared NAV/Footer.

Regression suites: `post-detail-browser.cjs`, `post-detail-live.cjs`, `community-list-browser.cjs`, `home-garage-browser.cjs`, `market-browser.cjs`. Set `PLAYWRIGHT_MODULE` and `CHROME_PATH` for the local external Playwright/Chrome installation; no frontend framework or repository dependency was added.
