# REV.CC login and signup

`/login` and `/signup` share `assignment-frontend/auth/index.html`, `js/auth.js` and `css/auth.css`. Nginx maps both URLs (including trailing slash) to the same document. These are focused authentication screens with no service NAV/Footer. Both screens use a centered single-column form (maximum 420px content width) on a white background. `auth-side-visual.png` is no longer referenced by the authentication screens.

## Existing authentication, unchanged

- `POST /api/auth/signup`: username/password; BCrypt hashing; UTF-8 72-byte password limit; username max 100 characters; DB unique constraint and duplicate-race handling.
- `POST /api/auth/login`: generic invalid-credentials response, shared-session creation and previous-token revocation. Legacy plaintext accounts retain the existing successful-login hash migration.
- `GET /api/auth/me`, `POST /api/auth/logout`: existing session restoration/revocation.
- Redis `revcc:session:<token>` contains `{id, username, role}`, with the existing 30-minute TTL. `REVCC_SESSION` remains HttpOnly, SameSite=Lax, with Secure controlled by existing environment configuration. Browser code stores neither passwords nor tokens in local/session storage.
- `GET /api/auth/kakao/login` and callback are unchanged. The callback continues to `/home` and uses the same member/session service. No OAuth implementation was duplicated.

No production backend API or DB schema change was necessary. Users currently have no independent nickname/email column; the username is also the community display name. Those unsupported fields are not collected.

## UI behavior

Existing service login entry points now point to `/login`. `site-nav.js` adds the current service path/query/hash when clicked. Login/signup switching preserves `next`. The auth screen permits only same-origin known service routes; external addresses, API paths, auth loops and `/admin` are not accepted return targets. USER and ADMIN use the same redirect logic, defaulting to `/home`. Admin management remains an explicit service NAV destination.

Signup completes with a success message on `/login`; the user then logs in with the new account. The form has password show/hide, confirmation, inline errors, an in-flight request guard and password clearing on page exit/completion. Authentication errors do not distinguish unknown username from wrong password. Only signup duplicate detection identifies an unavailable username.

Agreement checkboxes are required UI confirmation only. The page explicitly says full terms/privacy text is still in preparation and agreements are not recorded. No fake policy links are supplied. Before a production launch, real terms/privacy content and any required consent record policy need to be implemented.

Remember-me, email, separate nickname, password recovery and verification are not claimed or implemented. The existing session duration and Kakao success destination remain unchanged; Kakao does not use the local login `next` return behavior.

## Files for this task

New: `assignment-frontend/auth/index.html`, `css/auth.css`, `js/auth.js`, `img/auth-side-visual.png`, `scripts/auth-browser.cjs`, this document.

Changed: frontend `Dockerfile`, `nginx.conf`; login links in `index.html`, `home/index.html`, `community/index.html`, `parts/index.html`, legacy `garage/index.html`, and `js/app.js`, `home.js`, `admin.js`, `market.js`, `my-garage-card.js`; shared return-link handling in `js/site-nav.js`; `backend/src/test/java/com/revcc/app/AuthControllerTest.java`; login-link expectation in `scripts/home-garage-browser.cjs`.

The existing community editor and its vehicle/image/session flows are preserved.

## Verification

- `docker compose build core`: 29 tests passed, including hash storage, generic failed login, session rotation and Kakao callback/default home behavior.
- `scripts/auth-browser.cjs`: real temporary USER/ADMIN signup and login, duplicate username, invalid credentials/validation, BCrypt storage, Spring/Node session parity, Redis TTL/rotation/revocation, cookie HttpOnly/SameSite, separate-session isolation, logout, safe return to the editor, navigation/reload/back, duplicate submissions and desktop/mobile layout. Temporary accounts and sessions are cleaned up.
- Existing `home-garage-browser.cjs`, `market-browser.cjs`, `post-editor-browser.cjs` passed after login-link integration.
- Actual Kakao authorization endpoint returns the expected redirect. The third-party consent/token exchange was not performed with a real Kakao account; callback behavior is covered using the existing service mocked in Spring tests.

Run browser suites with the existing external Playwright installation using `PLAYWRIGHT_MODULE` and optionally `CHROME_PATH`. No framework/dependency was added to the service.
