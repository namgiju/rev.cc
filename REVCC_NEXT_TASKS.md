# REV.CC 다음 구현 작업 (진행 관리 파일)

> **새 세션 규칙: 이 파일 하나만 읽고 작업을 시작할 것.**
> `REVCC_AUDIT.md`는 2026-09-29에 완료된 감사 원본이다 — **재분석하지 말고 수정하지도 말 것**.
> 이 파일은 그 감사 결과와 이후 완료된 P0 작업을 요약해, 다음 STEP을 바로 구현할 수 있게 만든 실행 파일이다.

---

## 1. 현재 브랜치와 프로젝트 상태

- 브랜치: `docker-assignment` (항상 이 브랜치에서만 작업, 다른 브랜치로 전환하지 말 것)
- **실제 개발 기준 경로(2026-10-02부터): `~/Projects/revcc-site`.** `~/Desktop/revcc-site`는 이전 위치의 백업본이며 더 이상 작업 기준으로 쓰지 않는다(이 머신은 `~/Desktop` 하위 파일에 처음 접근할 때마다 비정상적으로 느려져 `next dev`/`npm ci`/`mv` 같은 작업이 사실상 멈추는 문제가 있었다 — Projects로 옮긴 뒤 정상 속도 확인됨). 코드·설정·스크립트에 `~/Desktop/revcc-site`든 `~/Projects/revcc-site`든 절대경로를 하드코딩하지 않는다(항상 상대경로 또는 환경변수 사용).
- 이 파일 작성 시점 기준 `git status`: P0 변경사항 + `REVCC_AUDIT.md` + 이 파일이 커밋 대상으로 대기 중이었고, 이번 세션에서 **P0 변경사항 + REVCC_AUDIT.md + REVCC_NEXT_TASKS.md를 함께 커밋·push했다** (아래 "완료된 작업"의 commit hash 참고).
- 프로젝트 구조: `backend`(Spring Boot, `core`), `board-service`(Node/Express, `board`), `nginx`(proxy), `docker-compose*.yml` 5종 — Next.js 전환과 무관하게 그대로 유지한다. 전환을 이유로 이미 있는 API를 다시 만들지 않는다. 화면 작업 전에는 항상 기존 API와 기존 호출 코드(`assignment-frontend/js/*`, `board-service/src/*`, `backend/src/main/java/com/revcc/app/*`)부터 조사한다.
- 프론트엔드: `assignment-frontend`(레거시 정적 HTML/CSS/JS, 지금도 실제로 서비스 중 — 기존 기능·API 동작을 확인하는 참고자료로 유지하고 임의로 삭제하지 않는다), `frontend`(Next.js — REV.CC 프론트가 점진적으로 이전해 갈 대상). **새 UI/페이지는 특별한 이유가 없으면 `frontend`(Next.js)에 구현한다.** 전환은 기존 기능을 깨지 않는 방식으로 화면 단위로 하나씩 진행한다.
- 인증 구조: 커스텀 쿠키+Redis 세션(Spring Security 미사용). `SharedSessionService`가 세션을 만들고 `revcc:session:<token>` 키로 Redis에 저장, Node가 같은 키를 직접 읽음. Next.js 전환에서도 이 인증/세션/API 계약을 임의로 바꾸지 않는다.

## 2. 완료된 작업 (P0, 2026-09-29)

### P0-1. Kakao OAuth state/CSRF 대응 — 완료
- 신규: `backend/src/main/java/com/revcc/app/KakaoStateService.java` — state를 Redis(`revcc:oauth:state:<state>`, TTL 5분)에 저장하고 동일 값을 `REVCC_OAUTH_STATE` HttpOnly 쿠키(path=`/api/auth/kakao`, `app.session.secure` 연동 Secure, SameSite=Lax)로 브라우저에 바인딩. 검증은 `GETDEL`로 원자적 1회 소비.
- 변경: `KakaoOAuthService.authorizeUrl(String state)` — 인가 URL에 `&state=` 추가.
- 변경: `AuthController.kakaoLogin()`/`kakaoCallback()` — state 발급/쿠키 설정, 콜백에서 `code`+`state`+쿠키 3자 대조 검증. 실패(없음/불일치/만료/재사용) 시 원인 구분 없이 400, 검증 성공/실패 모두 state 쿠키 즉시 폐기.
- Kakao 콜백 URL 하드코딩 점검: 기존에 이미 `KAKAO_REDIRECT_URI` 환경변수로 되어 있었음(로컬 기본값만 `localhost:8090`). `docker-compose.prod.yml`에 `KAKAO_REDIRECT_URI:?...` 필수화를 추가해 운영에서 값 누락 시 `localhost` 기본값으로 조용히 넘어가지 못하고 기동 자체가 실패하도록 막음.

### P0-2. Cloudflare/TLS 운영 대응 — 완료 (코드 범위만)
- `nginx/default.conf`: `X-Forwarded-Proto`를 `/api/(board|parts)`, `/api/` 프록시 구간에 전달(map으로 로컬은 `$scheme` 대체, 앞단이 있으면 그 값 그대로). 앞단이 "원요청은 http였다"고 알려준 경우에만 301 `https://` 리다이렉트 — 로컬 개발(`http://localhost:8090`)은 헤더 자체가 없어 절대 영향받지 않음(컨테이너로 직접 검증 완료).
- Spring `forward-headers-strategy: framework`(기존), Node `trust proxy: 1`(기존) — 코드 변경 없이 이미 X-Forwarded-Proto를 올바르게 해석할 준비가 되어 있었음.
- `REVCC_SESSION` 쿠키 Secure는 기존에 이미 `application-prod.yml`에서 하드코딩(override 불가)되어 있어 추가 변경 불필요.
- **채택한 아키텍처**: Cloudflare(또는 Cloudflare Tunnel)가 TLS 종단을 맡고 Docker Nginx는 내부에서 평문 80만 리슨(A안). Let's Encrypt/certbot을 nginx에 직접 붙이는 B안은 대규모 구조 변경이라 채택하지 않음.
- **코드 밖에서 별도로 필요한 운영 작업(이번 범위 아님, 기록만)**: Cloudflare SSL/TLS 모드를 Full 또는 Full(strict)로 설정, Always Use HTTPS, Cloudflare Tunnel 또는 Origin Certificate 구성. 이건 인프라/대시보드 작업이라 코드 변경으로 처리할 수 없음.

### 관련 테스트 결과 (2026-09-29)
- Spring `mvn test` (backend/): **77개 실행, 실패 0, 오류 0** (통합테스트 2클래스 9개는 기존과 동일하게 실 DB/Redis 미설정으로 skip — 정상)
- Node `npm test` (board-service/, `node --test`): **9개 실행, 실패 0** (app/community/rate-limit/session-revocation 4개 파일, board-service 코드는 이번에 변경 없음)
- 신규 보안 테스트: `KakaoStateServiceTest`(정상/없음/불일치/만료/재사용/형식오류 + 쿠키 속성), `KakaoOAuthServiceTest`(state가 URL에 실제로 실리는지), `AuthControllerTest`에 state 없음/불일치 시 카카오 API·세션 생성이 전혀 호출되지 않는지 검증하는 테스트 2건 추가.

---

## 3. 남아 있는 P1/P2/P3 목록

### P1 (배포 전 수정)
- **P1-1**: 비밀번호 최소 길이 제한 없음 (`AuthController.java:155` `Credentials.password`, `PasswordResetController.java:16` `ResetRequest.password`)
- **P1-2**: 전역 요청 본문 크기 제한 없음 → 대용량 JSON 메모리 고갈 DoS (`backend/src/main/resources/application.yml`, `application-prod.yml`)
- **P1-3**: 스키마 소유권 3원화(Hibernate `ddl-auto:update` + `backend/migrations/*.sql` + board-service 매 부팅 `schema.sql`) — 마이그레이션 이력 관리 부재
- **P1-4**: 부품 장터(`board-service/src/market.js`)에 관리자 모더레이션 기능 전무 → 사기/어뷰징 매물 삭제 불가
- **P1-5**: `docker-compose.override.yml` 자동적용 때문에 `docs/DOCKER-SUBMISSION.md`가 안내하는 방식(`docker compose up -d --build --wait`)으로 실행하면 `docker-compose.prod.yml` 하드닝이 전혀 적용되지 않음
- **P1-6**: board-service `admin.js`/`admin-access.js`, `market.js` 인가 로직에 대한 자동 테스트 전무(회귀 보호 없음)
- **P1-7**: CI 파이프라인 부재(`.github/workflows` 디렉터리 자체가 없음, 확인됨) — 1000줄+ 기존 테스트가 전혀 자동 실행되지 않음

### P2 (빠른 시일 내 개선, P1 완료 후 착수)
- P2-1: 비밀번호 재설정 요청에서 계정 존재여부 열거 가능(의도된 트레이드오프로 보이나 재확인 필요)
- P2-2: Rate limit이 IP 기준만 존재 + Spring `RateLimitFilter` 메모리 누수(만료 버킷 미정리)
- P2-3: board-service 서버측 HTML sanitize 부재(현재 프론트 textContent로 완화)
- P2-4: 부품장터 글 작성(POST)·조회수 증가·신고 엔드포인트에 rate limit 없음
- P2-5: Redis 무인증 + Docker 네트워크 미분리(단일 flat bridge)
- P2-6: 로컬 postgres 컨테이너 약한 기본 크리덴셜(`POSTGRES_PASSWORD:-revcc`)
- P2-7: Hikari/pg 커넥션 풀 전혀 튜닝 안 됨
- P2-8: 전 서비스에 `restart:` 정책 없음
- P2-9: `.env.example`이 실제 사용되는 다수 환경변수를 누락
- P2-10: nginx에 요청 rate limit(`limit_req_zone`) 없음, HSTS 헤더 없음
- P2-11: 회원 삭제 시 게시글/댓글 FK가 RESTRICT라 사실상 탈퇴 불가능 + 방명록 CASCADE 부작용

### P3 (장기 개선, P1/P2 완료 후 착수)
- P3-1: 일부 admin 목록 페이지네이션 없음
- P3-2: `moderation_logs` 테이블 인덱스 없음
- P3-3: `garage/index.html` orphan 페이지, `app.js` 부품 호환성 데드코드
- P3-4: `/api/board/admin/logs` 고아 API
- P3-5: 문서-코드 불일치(ASSIGNMENT.md, DOCKER-SUBMISSION.md, AUTH-UI.md)
- P3-6: 카카오 닉네임 동기화 레이스(uncaught exception → 500)
- P3-7: `VehicleController`의 dev용 `@CrossOrigin` 죽은 코드
- P3-8: 모니터링/알림 스택 부재
- P3-9: XSS 회귀 방지용 자동 테스트 없음

각 항목의 상세 근거/코드 라인은 필요할 때만 `REVCC_AUDIT.md`의 해당 섹션(§2-B, §5, §6, §13, §15)을 찾아서 참고 — 미리 전체를 다시 읽지 말 것.

---

## 4. 다음 작업 순서

> **2026-10-01 전환**: "기능·보안 요구사항을 최대한 완벽하게 구현하는 단계"에서 "실제로 공개하고 사용자를 받아 보는 단계"로 바꾼다. 현재 규모는 회원 약 33명, 게시글 약 21개, 매물 0건이다. STEP 10-impl-C까지 완료했고 main에도 반영했다(`82de6b3`). 목표는 완벽한 인프라·보안·DB 설계가 아니라 **실제로 배포 가능한 서비스 → 사용자를 받음 → 실제 사용 데이터를 확인 → 필요한 부분을 개선**이다.

### 완료

```
[x] STEP 1: P1-1 비밀번호 최소 길이 + P1-2 요청 body 크기 제한 + P1-5 운영 배포 문서 수정
[x] STEP 2: P1-4 부품장터 관리자 모더레이션 + P1-6 admin/market 인가 테스트
[x] STEP 3: P1-7 GitHub Actions CI
[x] STEP 4: P1-3 Flyway/Liquibase 기반 DB migration 정리
[x] STEP 5-A: P2-2 외부 X-Forwarded-For 신뢰 문제 해결 + limiter 만료 버킷 정리
[x] STEP 5-B: P2-2 계정 단위 로그인 제한 + P2-4 board 누락 엔드포인트 rate limit (+ admin-system.mjs 정합화)
[x] STEP 6: P2-3 서버측 XSS 방어 (B안: 입력 시 HTML 태그 제거)
[x] STEP 7-A: P2-5 Redis 인증 + P2-6 DB credential 정리
[x] STEP 7-B: P2-5 Docker 네트워크 분리 (prod 오버레이에만 적용)
[x] STEP 8: P2-7 + P2-8 + P2-9 운영 안정성 (커넥션 풀, restart 정책, .env.example)
[x] STEP 9: P2-10 Nginx 하드닝 (Cloudflare Named Tunnel 실제 IP 복원 포함)
[x] STEP 10: P2-11 회원탈퇴/FK 정책 — 결정 완료(2026-09-30, soft withdrawal). 구현은 아래 STEP 10-impl
[x] STEP 10-impl-A: 탈퇴 상태 기반(스키마 V3) + 탈퇴 계정 차단·표시 + 관리자 복구 차단 + 마지막 관리자 보호
[x] STEP 10-impl-B: 본인 글 soft delete + 이미지 공개 범위 제한 + image_ids orphan 방지
[x] STEP 10-impl-C: 일반 계정 탈퇴(비밀번호 재확인) + 데이터 처리 + 매물·방명록·차고 처리 + 재가입 제한 + 탈퇴 UI
```

### 지금 할 것 (위에서부터 순서대로)

```
[ ] NOW-1: UI/UX 개선 및 Next.js 전환 — 현재 최우선 제품 작업
[ ] NOW-2: 실제 운영 배포 준비 (production secret/env, Compose 실행 조건, 오래된 인스턴스 정리)
[ ] NOW-3: 실제 배포 (Cloudflare Named Tunnel + 현재 production compose)
[ ] NOW-4: 최소 운영 안정성 (Kakao HttpClient timeout, 최소 health monitoring/알림)
[ ] LATER-1: 카카오 회원 탈퇴 최소 구현 (배포 이후 제품 완성도 작업, 구 STEP 10-impl-D 축소)
[ ] LATER-2: 비밀번호 재설정 응답 통일 (작은 보안 정리, 구 STEP 11 축소)
```

- **NOW-1 UI/UX 개선 및 Next.js 전환**
  - 실제 사용자가 커뮤니티, 내 차고, 장터를 편하게 쓰는 데 집중한다.
  - 기존 backend API(core·board)를 불필요하게 다시 만들지 않는다. 화면 계층만 바꾸고, API 변경은 화면에 꼭 필요한 만큼만 한다.
  - 저장소에 있던 Next.js "My Garage" 프로토타입(`frontend/`, `docker-compose.garage.yml`의 garage-ui)을 재사용하는 쪽으로 정했다(새로 시작하지 않음).
  - 전환 범위와 순서(어느 화면부터 바꿀지, 기존 `assignment-frontend`와 공존할지)는 착수 시 짧게 정하고 시작한다. 큰 설계 문서를 먼저 만들지 않는다.
  - **진행 상황(2026-10-02)**: 메인 대문(`frontend/app/page.tsx` + `frontend/components/home/*` + `frontend/lib/*`)을 Next.js로 구현하고 실제 API 연동까지 검증 완료. 더미 데이터 없음 — 확인된 실제 API: `GET /api/board/posts`(오늘의 인기글 + 실시간 인기 TOP10, 둘 다 같은 엔드포인트를 기간/limit만 다르게 호출), `GET /api/board/garage`(오늘의 차고), `GET /api/parts/listings`(장터 새 매물), `GET /api/board/me`(세션). 레이아웃은 제공받은 레퍼런스 이미지(`references/badges/대문ver3.png`)를 따라 1440px 데스크톱 기준으로 다시 맞췄다: 넓은 container(1600px), Header(로고/검색 확대, nav 한 줄 고정), Hero(차량이 오른쪽을 차지하도록 crop, 높이 축소), 메인 그리드는 왼쪽 "오늘의 인기글"(2열 이미지 카드) + 오른쪽 "실시간 인기" TOP10, "오늘의 차고"·"장터 새 매물"은 첫 화면을 차지하지 않도록 본문 아래 별도 2열 섹션으로 이동. CTA 텍스트가 안 보이던 색상 specificity 버그, header nav 줄바꿈, container 정렬 불일치도 함께 수정.
    실행 방법: 저장소 루트(`~/Projects/revcc-site`, Desktop 경로 아님)에서 `docker compose up`(기존 Docker/nginx/백엔드, `localhost:8090`) + `frontend/`에서 `npm run dev`(Next.js, `localhost:3000`)를 같이 띄운다 — `next.config.ts`의 rewrite가 `/api/*`를 8090으로 넘겨준다.
    확인 상태: 1440px은 실제 브라우저 스크린샷으로 확인(Chrome 확장 연결). 1024/768은 CSS 계산과 컴파일된 미디어쿼리 값으로만 확인했고 스크린샷 미확인(이 세션의 `resize_window` 도구가 실제 뷰포트를 바꾸지 못하는 결함이 있었음 — `window.innerWidth`가 요청값과 무관하게 고정됨, 재확인 필요). "오늘의 인기글"이 `period=today`에서 빈 상태로 보이는 건 버그가 아니라 DB에 오늘(KST) 작성된 글이 없어서다(정상 동작).
    나머지 화면(`/home`, `/community`, `/parts` 등)은 아직 `assignment-frontend` 그대로이며, 다음 STEP에서 화면 단위로 이어서 옮긴다.
  - **커뮤니티 Next.js 이전**: 착수 전 `assignment-frontend`의 커뮤니티 기능(목록/상세/작성자 정보/댓글·대댓글/신고/글쓰기·수정/이미지/작성자→차고 이동 등)을 파일·API 단위로 조사하고, STEP을 `2-0`(공통 타입/API 계층) → `2-1`(목록) → `2-2`(상세) → `2-3`(좋아요·북마크·댓글·신고) → `2-4`(글쓰기·수정) → `2-5`(작성자 프로필·차고 연결, 내 활동, 알림) → `2-6`(기존 커뮤니티와 기능 동등성 검증)으로 나눴다. 조사 결과 "기간 필터"는 커뮤니티 목록 기능이 아니라 홈 전용(`period=today|week`, 이미 위에서 이전 완료)이라 커뮤니티 STEP 범위에서 뺐다. `frontend/`는 아직 어떤 docker-compose에도 서비스로 등록돼 있지 않다(로컬 `npm run dev` 전용) — 커뮤니티 코드를 옮겨도 실제 운영 라우팅 연결은 NOW-3와 별도로 판단한다.
    - **[x] STEP 2-0 (2026-10-02)**: 이후 화면이 공통으로 쓸 타입/API 계층만 추가. 신규 `frontend/lib/community-types.ts`(`CommunityPost`/`CommunityComment`/`CommunityReport`/`CommunityMember`/`MemberVehicle`/`CommunityBadge`/`LinkedVehicle`/`PublicMemberId` — 전부 board-service의 실제 응답 필드만 반영, 없는 필드 추가 안 함), `frontend/lib/community-api.ts`(`fetchPosts`/`fetchPost`/`fetchMember`/`setPostLike`/`setPostBookmark`/`fetchComments`/`createComment`/`deleteComment`/`reportPost`/`fetchMyReports` — 전부 기존 `/api/board/*` 호출, 새 API 없음, `lib/home-api.ts`와 동일한 클라이언트 전용 `credentials:'same-origin'` 패턴). 화면/라우트는 아직 없음(미사용 코드, 다음 STEP에서 소비). `npx tsc --noEmit`과 `npm run build` 통과, 홈/차고 라우트 구성 변화 없음 확인.
    - **세션 개인화 이슈(STEP 2-1 착수 시 결정 필요)**: 커뮤니티 목록/상세는 홈과 달리 `liked`/`bookmarked`/수정·삭제 버튼 노출이 요청자 세션에 따라 달라진다. 현재 `lib/server-api.ts`(서버 컴포넌트, 쿠키 미전달)로는 이걸 정확히 못 그린다. 추천안은 My Garage처럼 목록/상세를 전체 클라이언트 컴포넌트로 만드는 것(이미 검증된 패턴). SSR이 꼭 필요하면 들어온 요청의 쿠키를 그대로 board-service에 전달하는 새 서버 fetch 패턴을 추가해야 하는데, 이번 STEP에서는 어느 쪽도 아직 정하지 않았다.
    - **[x] STEP 2-1 (2026-10-05 기록)**: 구현 `8ac87b2`, 사이드바 버튼·제목 크기 수정 `6168b57`, 레이아웃 폭(1800px)·열 간격 후속 수정은 이 기록과 같은 commit. 세션 개인화 이슈는 클라이언트 컴포넌트 방식으로 결정(`components/community/community-list.tsx` 전체 `'use client'`). 아래 범위 그대로 구현: `/community` 라우트, 카테고리·정렬·검색·차종·활동 범위(`scope`, 비로그인 시 호출 없이 안내) 필터를 URL과 동기화, "더 보기" 페이지네이션, 인기글 사이드바(`components/home/popular-list.tsx` 재사용), 미니 내 차고 카드(`my-garage-mini.tsx`), 최근 본 글(`lib/recent-posts.ts`, 기존 키 `revcc:recent-posts:v1` 공유, 읽기만), 공용 푸터 `components/footer/site-footer.tsx`.
    - **[x] STEP 2-2 (2026-10-05)**: 게시글 상세 화면. 리팩터 `8223d90`(목록의 헤더·세션 로직을 `community-header.tsx`·`use-community-session.ts`로 분리, 목록 동작 변화 없음), 구현 `2871513`. 라우트 `app/community/[category]/[id]/page.tsx`(카테고리·id 형식이 틀리면 Next 404, nginx의 기존 상세 정규식과 같은 패턴), 본체는 클라이언트 컴포넌트 `components/community/post-detail.tsx`. 기존 `app.js`의 `showPostDetailPage`/`renderPostDetail`과 `post-context.js`를 포팅했고 새 API는 없다(`lib/community-api.ts`에 기존 `POST /posts/:id/view` 래퍼 `recordPostView`만 추가). 구성: 글+댓글 병렬 조회 → 페이지 로드당 1회 조회수 증가 → URL category가 실제와 다르면 `history.replaceState`로 canonical 교정 → 최근 본 글 기록(`rememberRecentPost`, 404면 `forgetRecentPost`). 왼쪽 `author-card.tsx`(작성자 카드, 탈퇴 작성자는 이름만), 본문 `post-article.tsx`(제목·메타·본문·사진·액션·작성자의 인장), `comment-section.tsx`(댓글 수, 작성 폼, 답글 대상 UI, 1단계 답글), 오른쪽 `post-context.tsx`(관련 차종·차종 인기글·같은 카테고리 최신글, 현재 글 제외 5개), 공용 `member-link.tsx`·`badge-list.tsx`, 스타일 `post-detail.module.css`(대략적인 레이아웃만, 세부 CSS는 사용자가 직접 조정 예정). 버튼 노출 규칙은 기존과 같다: 수정=작성자, 삭제=작성자 또는 ADMIN, 신고=작성자가 아닌 사람, 댓글 삭제=댓글 작성자 또는 ADMIN, 답글=삭제되지 않은 최상위 댓글. **변경(mutation)은 아직 연결하지 않았다**: 비로그인은 기존과 같은 로그인 안내, 로그인 상태는 "준비 중" 안내만 한다(추천·북마크·댓글·답글·신고·삭제 = STEP 2-3, 수정 = STEP 2-4). 링크 복사는 동작한다. 검증(Playwright, live 스택 = Neon, 글 119/116/18): 실제 데이터 표시, 없는 글 404 화면과 최근 본 글 정리, 잘못된 경로 404, canonical 교정, 로딩·에러·다시 시도, 비로그인/작성자/타인/관리자별 버튼·추천/북마크 상태·댓글 삭제 버튼 수, 탈퇴 작성자, `/community` → 상세 → 뒤로가기(필터 유지) → "목록으로" 링크, 콘솔 에러 없음(작업 중 발견한 hydration 경고 수정 포함) 70/70 통과. 로그인 상태는 Neon에 계정을 만들지 않으려고 `/api/board/me` 응답을 가로챈 fixture로 확인했고, 조회수는 실제 1회만 올렸다. `npx tsc --noEmit`, `next build` 통과.
      - 기존 상세 대비 남은 차이(다음 STEP으로): ~~mutation과 관리자 삭제 사유 입력 창(2-3)~~ → STEP 2-3에서 완료, ~~수정 에디터(2-4)~~ → STEP 2-4에서 완료, ~~작성자 이름·보유 차량 링크 임시 주소, 헤더의 "내 활동"·알림 목록 버튼, `/community#post-{id}` 옛 링크 호환~~ → STEP 2-5에서 완료. 운영 nginx는 여전히 `/community/*`를 `assignment-frontend`로 보낸다(Next 배포 연결은 NOW-3에서 판단).
    - **[x] STEP 2-3 (2026-10-05)**: 상세 화면 인터랙션을 기존 board-service API에 연결. 구현 `8e3c1e5`. 새 API·백엔드 변경 없음(`lib/community-api.ts`에 기존 `DELETE /posts/:id` 래퍼 `deletePost`만 추가). 동작은 기존 `app.js`의 `renderPostDetail`/`requestContentDeletion`/`openReport`와 같다.
      - 추천·북마크: `PUT {active: 현재의 반대}`(서버가 멱등). 종류별로 한 번에 요청 하나만 보내고 버튼을 잠근다(ref로 막아 연속 클릭에도 요청 1회). 서버 응답의 `active`로만 화면을 바꾸고, 이어서 글을 다시 읽어 카운트를 맞춘다. 재조회는 마지막 것만 반영(ticket).
      - 댓글·답글: `POST /posts/:id/comments`(`parentId`). 저장 중에는 등록 버튼을 잠그고 입력창을 읽기 전용으로 둔다(검증 중 발견: 저장 중 새로 입력한 내용이 앞 요청 완료 시 지워지던 문제). 성공하면 댓글 목록과 글을 다시 읽고 입력창·답글 대상을 비운다. 실패하면 입력 내용을 유지한다.
      - 삭제: 본인 글·댓글은 확인 창만 띄우고 사유 없이 삭제. 남의 글·댓글은 관리자에게만 버튼이 보이고 "관리자 콘텐츠 삭제" 사유 입력 창(필수, 500자)을 띄운다(기존 기능 복원, 사유는 `moderation_logs`에 기록). 글 삭제 후에는 그 카테고리 목록으로 이동하고, 댓글 삭제 후에는 목록을 다시 읽는다.
      - 신고: "게시글 신고" 사유 입력 창. 처리 대기 중 재신고는 서버가 사유를 갱신하고, 이미 처리된 신고는 409 메시지를 보여준다.
      - 공통 `components/community/community-dialog.tsx`(native `<dialog>`, 확인형·사유형). 요청 중에는 닫기·재제출이 막히고, 실패하면 창을 연 채 서버 메시지를 보여준다. 실패 시 이전 상태를 그대로 두고 상단 알림에 서버 메시지를 표시하며, 401이면 "로그인이 만료되었어요" 안내.
      - 비로그인 사용자는 기존과 같이 요청 없이 "로그인 후 이용할 수 있어요" 안내. 수정 버튼은 STEP 2-4까지 "준비 중" 안내만 한다.
      - 댓글 신고는 포팅 범위에서 제외(신규 기능, 2026-10-05 사용자 결정) — "보류" 목록의 향후 개선사항 참고.
      - 검증: Neon을 건드리지 않으려고 임시 스택(postgres:16 빈 DB + Flyway, redis, 현재 이미지의 core·board·proxy, 컨테이너 안 소스 복사본으로 띄운 별도 Next dev)에서 임시 계정 3개(작성자, 일반 회원, DB에서 ADMIN 지정)로 Playwright 73/73 통과(같은 스크립트 2회 실행). 확인 항목: 비로그인 추천·북마크·댓글·답글·신고(요청 0건), 추천·북마크 ON/OFF와 새로고침 후 유지, 저장한 글 scope 반영, 더블클릭 시 PUT·POST 1회, API 500 시 상태 유지·오류 표시·버튼 복구, 세션 만료(401) 시 상태 유지, 댓글·답글 작성과 카운트·목록 반영, 답글 알림, 본인 댓글 삭제(확인·취소), 게시글 신고(빈 사유 차단, 실패 시 창 유지, 성공 후 내 신고 목록), 본인 글 삭제 후 목록 이동과 404, 관리자 댓글·글 삭제(사유 필수, Esc 취소), 일반 회원의 타인 글·댓글 삭제 API 403, STEP 2-2 회귀(canonical, 목록→상세→뒤로가기, "목록으로" 링크, 잘못된 경로 404, 콘솔 에러 없음). DB에서 `moderation_logs` 사유, `deleted_reason`(AUTHOR/ADMIN), `community_reports`도 확인했다. 임시 스택과 계정 정보는 검증 후 삭제했다. `npx tsc --noEmit`, `next build` 통과. 프론트 단위 테스트는 없고, 백엔드는 바뀌지 않아 board/core 테스트는 돌리지 않았다(경량화 원칙, CI가 전체 실행).
    - **[x] STEP 2-4 (2026-10-05)**: 글쓰기·수정. 리팩터 `c1512eb`(목록의 왼쪽 메뉴·오른쪽 사이드바·카테고리 상수를 `community-left-nav.tsx`·`community-sidebar.tsx`·`categories.ts`로 분리, 목록의 글쓰기 링크에 현재 게시판 전달, 옛 `/community?category=…#write-post` 링크를 새 경로로 이동), 구현 `78cbe1f`. 라우트 `/community/new`(`?category=` 미리 선택)와 `/community/{category}/{id}/edit`가 같은 클라이언트 컴포넌트 `components/community/post-editor.tsx`를 쓴다(수정 여부는 `postId` 유무로만 구분). 기존 `post-editor.js`를 포팅했고 API 계약 변경은 없다(`lib/community-api.ts`에 기존 `POST/PUT /api/board/posts`, `GET /api/board/garage/mine`, `POST /api/board/images` 래퍼만 추가).
      - 필드와 제한은 기존과 같다: 게시판, 제목 150자, 내 차량 연결(선택, 목록을 불러오기 전에는 등록 버튼 잠금, 실패 시 "다시 확인"), 본문 5000자, 사진 JPG/PNG/WebP 장당 3MB·최대 3장(업로드 상태, 미리보기 제거, 수정 시 기존 사진 표시). `vehicleId`는 항상 보낸다(null이면 연결 해제). 텍스트로만 저장된 옛 차종은 차량 연결을 바꾸지 않으면 그대로 둔다.
      - 권한: 비로그인은 "글을 작성하려면 로그인이 필요합니다" + 돌아올 경로를 붙인 로그인 링크. 수정은 USER·ADMIN 모두 작성자 본인만 가능(서버 PUT 조건과 같음). 남의 글 수정 주소로 들어오면 폼 없이 "본인이 작성한 글만 수정할 수 있어요" + 글로 돌아가기 링크를 보여준다(기존은 글로 바로 이동, 안내가 보이도록 바꿈). 수정 주소의 category가 실제와 다르면 canonical로 교정한다. 상세의 수정 버튼과 옛 `/community/{category}/{id}#write-post` 링크는 `/edit`로 이동한다.
      - 상태 처리: 제출 중에는 폼 전체를 잠그고 ref로 중복 제출을 막는다. 공백만 있는 제목·본문은 안내하고 요청을 보내지 않는다. 실패하면 서버 메시지를 보여주고 입력을 유지한다(401은 로그인 만료 안내). 성공하면 저장된 글의 canonical 주소로 이동한다. 변경 사항이 있거나 처리 중이면 취소·페이지 안 링크·헤더 검색·왼쪽 메뉴 이동 시 확인 창을 띄우고, 새로고침·탭 닫기에는 브라우저 기본 경고를 띄운다. 로그인 계정이 바뀌면 에디터를 다시 불러온다.
      - 검증: Neon을 건드리지 않는 compose 프로젝트 `revcc-s24`(postgres:16 tmpfs + Flyway, redis, 현재 이미지의 core·board·proxy, 소스 복사본으로 띄운 Next dev)에서 임시 계정 3개(작성자 차량 1대, 일반 회원 차량 없음, ADMIN)로 Playwright 실행. 에디터 67/67: 비로그인 접근(작성·수정), 게시판 미리 선택, 차량 목록, 필수값(빈 제목은 요청 없음, 공백 제목 안내), 글자 수, 사진 업로드·제거·최대 3장·형식 오류, API 실패 시 입력 유지, 더블클릭+Enter 시 POST 1회, 작성 후 상세 이동과 저장값, 상세에서 수정 진입, 초기값(제목·본문·게시판·차량·사진), 새로고침 시 저장값 복원, 변경 후 취소·헤더 링크 확인 창, 수정 저장 후 바뀐 게시판 주소로 이동·반영(차량 해제·사진 제거 포함), 변경 없는 취소, canonical 교정, 옛 `#write-post` 링크 2종, 일반 회원·관리자의 타인 글 수정 차단(화면·API 403·수정 버튼 없음, 관리자 삭제 버튼은 유지), 옛 텍스트 차종 보존, 차량 없는 회원 안내, 없는 글·잘못된 주소, 목록(필터·글쓰기 링크·사이드바)·상세(추천·북마크·댓글·신고·뒤로가기·본인 삭제) 회귀. STEP 2-3 검증 스크립트 전체도 같은 스택에서 73/73(수정 버튼 기대값만 에디터 이동으로 바꿈). `npx tsc --noEmit`, `next build` 통과. 정리는 `docker compose -p revcc-s24 down`과 이 스택의 Redis 익명 볼륨 1개만 지정 삭제했다(전역 prune 사용 안 함).
      - 세부 CSS로 남긴 것: 오른쪽 사이드바 카드 사이 간격이 넓다(`app/globals.css`의 전역 `section` margin 영향으로 보임). 모바일 폭에서 공용 헤더가 가로로 넘친다(기존 헤더).
    - **[x] STEP 2-5 (2026-10-05)**: 작성자 프로필·차고 연결, 내 활동, 알림. 구현 `d0490f8`. API 계약 변경 없음(`lib/community-api.ts`에 기존 알림·방명록·공개 차고 API 래퍼만 추가).
      - 회원 차고 `/community/members/{id}`(`member-profile.tsx`, 기존 `#member-{id}` 모달 = `app.js openMember`): "{이름} 님의 차고" 차량 카드(`GET /api/board/garage?owner=`, 사진·연식·트림·기록 수, 카드 → 차량 화면), 방명록(`guestbook.tsx` = `guestbook-ui.js`, 20개씩 "더 보기", 로그인 시 작성, 삭제는 작성자·방명록 주인만), 최근 작성한 이야기(`PostRow` 재사용). 탈퇴·없는 회원은 서버 404 메시지를 보여준다.
      - 공개 차량 `/community/cars/{id}`(`vehicle-public.tsx`, 기존 `#car-{id}` 모달 = `vehicle-ui.js openCar`): 소유자 링크, 연식·트림, 사진, 소개, 정비·튜닝·부품 기록(주행거리·비용).
      - **내 차고 본체는 포팅하지 않았다**: 기존 모달의 차량 등록·수정·삭제, 기록 추가·삭제(`vehicleForm`/`recordForm`)는 개인 차고(`/home`) 기능이라 이번 범위에서 뺐다. 본인 차고·차량에서는 대신 "내 차고에서 … 관리 →"(`/home`) 링크를 보여준다.
      - 공용 헤더(`community-header.tsx`): 로그인 시 "내 활동" 패널(내가 쓴 글·댓글 남긴 글·저장한 글 → `/community?scope=…`, 내 차고, 내 신고 내역 = `GET /api/board/reports`, 상태 접수됨/처리 완료/반려)과 알림 패널(목록을 보여준 뒤 `PUT /notifications/read`로 모두 읽음, 배지 0으로). 비로그인 시 두 버튼은 기존처럼 숨긴다. 공용 모달 `community-panel.tsx`, 단일 칼럼 페이지 틀 `community-page.tsx`(+`useNotice`).
      - 링크 연결: 작성자 이름(`member-link.tsx`)·목록 작성자(`post-row.tsx`)·작성자 카드 보유 차량·홈 "오늘의 차고"가 새 화면으로 이동한다(`lib/format.ts`의 `memberUrl`/`carUrl`). 옛 `/community#member-{id}`·`#car-{id}`·`#post-{id}` 링크는 목록 화면이 새 주소로 넘긴다(같은 페이지 안 hash 변경도 처리, 없는 글은 서버 메시지 표시) — STEP 2-2 기록의 `#post-{id}` 호환 항목도 이걸로 처리됐다.
      - 검증: compose 프로젝트 `revcc-s25`(postgres·redis 모두 tmpfs, 볼륨 없음)에서 임시 계정 3개. STEP 2-5 Playwright 54/54(회원 차고 카드·최근 글·방명록 21개와 더 보기, 차량 화면 사진·기록·빈 상태, 본인만 보이는 관리 링크, 없는 회원·차량, 잘못된 주소 404, 방명록 작성·더블클릭 1회·실패 시 입력 유지·본인 글만 삭제·주인은 모두 삭제·타인 삭제 API 403, 상세·작성자 카드·목록에서 새 화면 이동, 비로그인 헤더, 알림 배지·목록·읽음 처리(서버 확인)·Esc 닫기, 내 활동 링크·내 신고 내역·활동 범위 이동, 옛 hash 링크 4종). 검증 중 같은 페이지 안 hash 변경이 처리되지 않던 문제를 찾아 `hashchange` 처리로 고쳤고, 깨끗한 DB로 다시 띄워 재검증했다. 회귀: STEP 2-3 스크립트 73/73, STEP 2-4 스크립트 67/67(목록·상세·추천·북마크·댓글·삭제·신고·글쓰기·수정 포함). `npx tsc --noEmit`, `next build` 통과. 정리는 `docker compose -p revcc-s25 down`만 했고 볼륨 변화는 없었다.
    - **내 차고(`/home`) Next.js 포팅**: 차량 등록·수정·삭제, 정비·튜닝·부품 기록 관리, 차량 인증, 프로필 설정 등 개인 차고 본체. 커뮤니티 STEP 2-x 범위가 아니다. 조사 결과 범위를 STEP 3-0(공통 타입/API)~3-6(검증)으로 나눴다.
      - **조사 결과(2026-10-05)**: `/home`은 두 개의 별도 API를 함께 쓴다 — Spring core `/api/garage/vehicles`(`GarageVehicleController`, 같은 `owner_vehicles` 테이블의 manufacturer/licensePlate/verification 컬럼, 등록·수정·삭제·오너 인증 신청)와 board-service `/api/board/garage`(`community.js`, 같은 테이블의 model/trim/bio/imageId/records 컬럼, 공개 프로필·기록). 두 서비스가 같은 테이블에 직접 쓰는 구조(JPA `@Table(name="owner_vehicles")`)이고 id가 같다 — 새 동기화 코드 불필요, 기존 계약 그대로 각각 호출. 저장소의 오래된 "My Garage" 프로토타입(`frontend/app/(owners)/*`, `components/garage/*`, `lib/garage-api.ts`)은 core API만 다루고 licensePlate·인증·board 필드·방명록·알림·탈퇴가 전혀 없어(현재 core API가 필수로 요구하는 licensePlate조차 폼에 없음) 그대로 재사용할 수 없고 세션/레이아웃 패턴만 참고했다. STEP 2-x에서 만든 `use-community-session.ts`/`community-header.tsx`+`header-panels.tsx`/`guestbook.tsx`/`badge-list.tsx`/`member-link.tsx`/`community-dialog.tsx`/`lib/format.ts`는 그대로 재사용한다(단 `community-page.tsx`는 "커뮤니티 목록으로" 백링크+단일 칼럼 전제라 `/home`의 대시보드형 그리드에는 안 맞아 재사용하지 않고 전용 페이지 틀을 새로 만든다). home.js의 "내 커뮤니티 활동"(쓴 글/댓글 단 글/최근 활동 탭+더보기)은 STEP 2-1/2-5에서 이미 구현된 헤더의 "내 활동" 패널(`/community?scope=mine|commented|bookmarks`)과 완전히 동일 기능이라 재구현하지 않고 링크로 대체하기로 결정(2026-10-05, 중복 구현 생략).
      - `[x]` **STEP 3-0 (2026-10-05)**: 공통 타입/API 계층만 추가, 화면·라우트 없음(미사용 코드, STEP 3-1부터 소비). `frontend/lib/community-types.ts`에 `OwnerVehicle`/`OwnerVehicleInput`(core `/api/garage/vehicles`, `GarageVehicleResponse`/`Request` 그대로), `VehicleProfileInput`/`VehicleRecordInput`/`VehicleRecordKind`(board `/api/board/garage` 그대로), `MemberProfileInput`(`PUT /api/board/profile`), `WithdrawInfo`/`WithdrawInput`(core `/api/auth/withdraw`, `WithdrawalService.info()` 반환값 그대로) 추가. `frontend/lib/community-api.ts`에 `fetchMyGarageVehicles`/`createOwnerVehicle`/`updateOwnerVehicle`/`deleteOwnerVehicle`/`submitVehicleVerification`(core 5종), `createVehicleProfile`/`updateVehicleProfile`/`deleteVehicleProfile`/`createVehicleRecord`/`deleteVehicleRecord`(board 5종), `updateMemberProfile`/`setRepresentativeVehicle`, `fetchWithdrawInfo`/`withdrawAccount` 추가 — 전부 기존 엔드포인트 그대로, 새 API 없음. 검증: `npx tsc --noEmit`, `next build` 통과(라우트 변화 없음, 기존 6개 라우트 그대로).
      - `[x]` **STEP 3-1 (2026-10-05)**: `/home` 라우트, `frontend/components/my-garage/my-garage.tsx`(+전용 `my-garage.module.css`). `CommunityHeader`/`SiteFooter`/`useCommunitySession`/`useNotice`(`community-page.tsx`에서 import)를 그대로 재사용하고, `community-page.tsx` 자체(단일 칼럼+백링크 전제)는 재사용하지 않고 대시보드 2열 그리드 전용 셸을 새로 작성했다. 비로그인 안내("내 차고를 이용하려면 로그인이 필요합니다" + 로그인 링크), 대표 차량 카드(사진 또는 placeholder, 제조사/모델/연식·트림, 인증 상태 chip verified/PENDING/REJECTED/전, 소개, STEP 2-5 공개 차량 페이지로 연결되는 "차량 상세 보기" 링크 — `carUrl` 재사용), 보유 차량 목록(각 행도 공개 차량 페이지로 연결), "대표 차량 설정"(`setRepresentativeVehicle` 호출 후 재조회, 대표 차량은 버튼 비활성화) 구현. 차량 없음 상태는 두 패널 모두 안내 텍스트만(등록은 STEP 3-2라 버튼 없음) — 수정·인증신청·기록관리 등 이후 STEP 기능은 넣지 않았다(스텁 버튼 없음). 데이터는 `fetchMyGarageVehicles`(core, STEP 3-0에서 추가)와 `fetchMember`(board, 기존)를 함께 조회해 대표 차량은 core 데이터로, 사진은 board의 `member.vehicles[].imageId`로 표시한다.
        검증: Neon을 건드리지 않으려고 로컬 전용 compose 프로젝트 `revcc-s31`(컨테이너명·네트워크를 메인 `revcc-site` 스택과 분리해 기존 로컬 개발 스택은 전혀 건드리지 않음, postgres 16 빈 DB에 `V1__baseline.sql`을 수동 적용 후 Flyway가 V2~V5 적용 — 이 레포의 Flyway가 `baseline-on-migrate`로 V1 SQL 자체를 건너뛰어 완전히 빈 DB에서는 스스로 부트스트랩이 안 되는 기존 이슈를 검증 과정에서 발견, 코드는 건드리지 않고 검증 환경에서만 수동으로 우회함 — 별도 보고 가치가 있으면 추후 P1-3에 참고)와 소스 복사본(`node_modules` 포함, 메인 `next dev` 프로세스와 분리)으로 띄운 Next dev에서 임시 계정 2개(차량 0대, 차량 2대)로 Chrome 확장을 통해 직접 확인: 로그인 필요 상태, 차량 없음 상태(양쪽 패널), 대표 차량 카드와 보유 차량 목록(사진 없음 placeholder 포함), "대표 차량 설정" 클릭 → 즉시 대표 차량 카드·버튼 비활성화 상태 반영, "차량 상세 보기" → `/community/cars/:id`(STEP 2-5) 정상 연결. 전체 커뮤니티 회귀는 범위 밖이라 실행하지 않음. `npx tsc --noEmit`, `next build` 통과(`/home`이 정적 라우트로 추가됨). 테스트 스택·볼륨·소스 복사본은 작업 후 전부 삭제했다.
        세부 CSS로 남긴 것: 반응형(모바일 1열) 외 세부 디자인은 최소화된 상태.
      - `[x]` **STEP 3-2 (2026-10-05)**: 차량 등록 2단계만 구현(사용자 지시로 범위를 명시적으로 좁힘 — 원래 계획에 있던 "오너 인증 재신청(반려 시)"은 이번 STEP에서 빠졌고 아직 미구현). `frontend/components/my-garage/vehicle-registration-dialog.tsx`(신규, native `<dialog>`, `community-dialog.tsx`의 confirm/reason 스펙에 안 맞는 2단계 커스텀 폼이라 별도 컴포넌트로 작성) + `my-garage.module.css`에 다이얼로그 스타일 추가(`post-detail.module.css`의 `.dialog` 패턴을 기존 컨벤션대로 이 모듈에 최소 복제). "보유 차량" 패널 헤더에 "차량 등록" 버튼(`my-garage.tsx`) 하나만 진입점으로 둠 — legacy `home.js`처럼 대표 차량 빈 상태에 별도 버튼을 중복으로 두지 않음.
        1단계(`createOwnerVehicle`, STEP 3-0 API): 제조사·모델명·연식·차량번호 입력 → 성공 시 즉시 `onVehicleCreated` 콜백으로 부모의 `reloadKey`를 올려 목록을 다시 불러온다(다이얼로그가 2단계에 머물러 있어도 뒤의 "보유 차량"/"대표 차량" 패널이 바로 갱신됨 — 사용자가 2단계를 완료하지 않고 이탈해도 차량은 이미 반영됨). 2단계: 등록증 이미지 업로드 후 "인증 요청 제출"(`submitVehicleVerification`) 또는 "나중에 하기"(건너뛰기, 안내 문구만 표시). 제출 성공 시 한 번 더 `onVehicleCreated`로 재조회해 인증 상태 chip을 갱신한다.
        검증: STEP 3-1과 같은 방식(Neon 미접촉, 로컬 전용 compose 프로젝트 `revcc-s31` + 소스 복사본 Next dev, 이번에도 작업 후 전부 삭제)으로 임시 계정 1개를 만들어 Chrome으로 직접 확인: 1단계 제출 즉시 두 패널에 차량 반영(다이얼로그가 열려 있는 상태에서도), "나중에 하기" → 다이얼로그 닫힘 + 안내문구 + "인증 전" chip 유지, 두 번째 차량으로 실제 JPEG 파일(`file_upload` 도구로 업로드) 첨부 후 "인증 요청 제출" → 안내문구 + 대표 차량으로 전환해 확인하니 "인증 검토 중"(PENDING) chip으로 정상 반영. 전체 커뮤니티 회귀는 범위 밖이라 실행하지 않음. `npx tsc --noEmit`, `next build` 통과(라우트 변화 없음, `/home`은 이미 3-1에서 추가됨). Flyway 빈 DB 부트스트랩 문제(STEP 3-1에서 발견)는 이번 STEP에서도 수정하지 않고 검증 환경에서만 동일하게 수동 우회했다.
        남은 범위(다음 STEP으로): 차량 수정·삭제, 정비·튜닝·부품 기록 관리(STEP 3-3), 인증 반려 후 재신청 버튼(아직 미정 — 3-3 또는 별도 STEP에서 판단).
      - `[x]` **STEP 3-3 (2026-10-05)**: 차량 수정·삭제 + 정비·튜닝·부품 기록 추가·삭제. `frontend/components/my-garage/vehicle-manage-dialog.tsx`(신규) — 대표 차량 카드와 보유 차량 목록 각 행에 "수정" 버튼(`my-garage.tsx`)을 추가해 같은 다이얼로그로 연결. 새 공개 페이지나 새 백엔드 API 없이 STEP 3-0 API만 사용: `fetchPublicVehicle`로 초기 로드(모델/연식/트림/소개/사진/기록, legacy `editVehicle`/`openCar`와 동일한 소스), `updateVehicleProfile`(모델/연식/트림/소개/사진 — core 전용 필드인 제조사·차량번호·인증은 legacy `vehicleForm()`과 동일하게 이 폼에서 다루지 않음), `deleteVehicleProfile`(board 엔드포인트 하나로 충분 — core/board가 같은 `owner_vehicles` 행을 공유해 core `/api/garage/vehicles` 목록에서도 함께 사라짐, API 레벨 검증으로 확인), `createVehicleRecord`/`deleteVehicleRecord`. 차량 삭제·기록 삭제 확인은 새 모달을 만들지 않고 기존 `community-dialog.tsx`(`CommunityDialog`, kind:'confirm')를 그대로 재사용(중첩 `<dialog>`). 사진 교체는 기존 `uploadImage`(STEP 2-x) 재사용. 모든 변경 후 부모의 `onChanged`(`reloadKey` 증가)로 `/home`의 대표/보유 차량 패널을 즉시 재조회한다(차량 삭제 시 다이얼로그도 함께 닫힘, 기록 변경 시 다이얼로그는 열어둔 채 내부 목록만 재조회).
        검증: 이번엔 세션 중 Chrome 확장이 연결되지 않아 UI 클릭 검증은 못 했고, STEP 3-1/3-2와 같은 격리 로컬 스택(Neon 미접촉, 작업 후 전부 삭제)에서 다이얼로그가 호출하는 것과 동일한 API를 직접 호출해 확인했다: `PUT /api/board/garage/:id`(모델·연식·트림·소개 변경 → `GET`으로 반영 확인), `POST .../records` + `GET`으로 기록 반영 확인 + `DELETE .../records/:id` + `GET`으로 제거 확인, `DELETE /api/board/garage/:id` 후 core `GET /api/garage/vehicles`와 board `GET /api/board/members/:id`에서 모두 사라짐을 확인(같은 행이라는 가정을 API 레벨에서 직접 재확인). 전체 커뮤니티 회귀는 범위 밖이라 실행하지 않음. `npx tsc --noEmit`, `next build` 통과(라우트 변화 없음). **다음 세션에서 UI 클릭 검증(Chrome 확장)을 한 번 더 하는 게 좋다** — 특히 사진 교체 미리보기와 중첩 다이얼로그(기록 삭제 확인 중 차량 다이얼로그가 같이 안 닫히는지)는 코드 리뷰로만 확인했다.
      - `[ ]` **STEP 3-4**: 프로필 수정(한 줄 소개·아바타·커버, 이미지 제거 체크박스) + 내 인장 목록(`badge-list.tsx` 재사용).
      - `[ ]` **STEP 3-5**: 방명록 연결(`guestbook.tsx`는 이미 구현됨, `/home`에 연결만) + 회원 탈퇴(안내문 + 비밀번호 확인, 카카오/관리자/예약매물 차단 메시지).
      - `[ ]` **STEP 3-6**: 기존 `/home`과 기능 동등성 검증(로그인/비로그인, 본인/타인, 인증 상태별, 탈퇴 플로우) + 레거시 `assignment-frontend/home` 처리 방향 판단(실제 nginx 라우팅 전환은 NOW-3와 별도).
    - **STEP 2-1 범위(원래 계획)**: 커뮤니티 목록 화면 — 카테고리 탭, 최신/인기 정렬, 검색(`q`), 차종 필터(`vehicle`), "더 보기" 페이지네이션(`page`/`limit=20`), 인기글 사이드바(`sort=popular&limit=5`), 최근 본 글(`localStorage`, 계정과 무관), 미니 내 차고 카드. 라우트는 `/community`(또는 동등한 경로) 하나만 만들고, 위 세션 개인화 이슈를 먼저 정한 뒤 `fetchPosts`를 호출하는 리스트 컴포넌트를 작성한다. 상세/글쓰기/댓글/신고/작성자 프로필은 이번 STEP 범위 아님(2-2 이후). 참고 파일: `assignment-frontend/js/community-list.js`, `assignment-frontend/js/app.js`(`refreshPosts`/`renderPost`/`search`), `assignment-frontend/community/index.html`.
- **NOW-2 실제 운영 배포 준비**
  - 운영 `.env`: `WITHDRAWAL_HMAC_SECRET`(32자 이상, 없으면 core 기동 거부), `REDIS_PASSWORD`(영문·숫자), `CLOUDFLARE_TUNNEL_TOKEN`, `KAKAO_REDIRECT_URI`(https), DB 값 등 prod 오버레이가 `:?`로 요구하는 값. `.env.example`을 기준으로 채운다.
  - 운영 서버의 Docker Compose 버전이 2.24 이상인지 확인한다(prod 오버레이의 `!reset`/`!override`).
  - Mac 등 같은 Neon에 붙는 오래된 로컬 인스턴스를 멈춘다. 옛 board는 본인 글을 실제로 지우고 모든 사진을 공개한다(STEP 10-impl-B 혼합 배포 주의).
  - Neon에는 새 core가 처음 기동할 때 V3~V5가 한 번에 적용된다. 기동 직전 읽기 전용으로 `SELECT DISTINCT account_status FROM users`만 다시 확인한다(2026-10-01 기준 전부 NULL).
  - 필요 없는 Neon `board_test_posts_archive`는 배포 때 함께 정리할 수 있다(선택).
- **NOW-3 실제 배포**
  - Cloudflare Named Tunnel + `docker-compose.yml` + `docker-compose.prod.yml` 기준으로 배포한다.
  - 배포 후 확인은 두 가지만 한다. ① proxy 로그의 첫 칸이 실제 사용자 IP인지, cloudflared가 172.16.238.2를 쓰는지. ② 로그인·게시글·이미지 등 핵심 proxy 동작. 배포를 또 하나의 대형 테스트 프로젝트로 만들지 않는다.
- **NOW-4 최소 운영 안정성**
  - `KakaoOAuthService`의 `HttpClient`에 연결·요청 timeout을 넣는다. 작고 독립적인 작업이며 카카오 탈퇴와 분리한다.
  - 서비스 다운을 알 수 있는 최소 health monitoring·알림(예: 외부 uptime 체크 하나)을 둔다. 장애 대응에 실제로 필요한 최소 수준만 한다.
- **LATER-1 카카오 회원 탈퇴** (NOW 작업과 배포 이후)
  - 지금은 카카오 계정의 탈퇴 요청을 400 `KAKAO_REAUTH_REQUIRED`로 안전하게 거부하는 상태를 유지한다.
  - 공개 서비스에서는 카카오 회원도 탈퇴할 수 있어야 하므로 제품 완성도 작업으로 남긴다.
  - 구현할 때 기존 STEP 10-impl-D 계획을 기계적으로 따르지 않는다. 카카오 재인증 + unlink + 탈퇴에 필요한 최소 구현만 다시 설계한다(참고: 추가 이슈의 "STEP 10-impl-C → D 전에 알아야 할 것").
- **LATER-2 비밀번호 재설정 계정 열거**
  - 응답 통일 같은 작은 수정으로 끝나면 작은 보안 정리로 처리한다. 별도의 큰 설계·테스트가 필요하면 보류한다.

### 보류 (현재 규모에서는 오버헤드 — 실제 필요가 생기면 재개)

기록과 계획은 지우지 않는다. 기존 system/browser/E2E 테스트 자산도 지우지 않고, 큰 릴리스·배포 경계에서만 쓴다.

- STEP 10-impl-D 원래 계획 전체(→ LATER-1로 축소)
- STEP 10-impl-E: 운영 기록 보존기간, 자동 정리, FK 없는 참조 정리, 만료된 `withdrawal_blocks` 정리
- STEP 11 원래 계획 전체(→ LATER-2로 축소)
- 제재(정지·비활성화) 회원 전용 탈퇴 경로
- 무기한 withdrawal block을 해제하는 관리자 UI/API
- 드문 withdrawal race condition 보강(탈퇴 중 새 매물 등록 등)
- 이메일 없는 legacy 계정의 완전한 재가입 방지(이메일 필수화 등)
- 현재 트래픽에 필요 없는 DB·인덱스 최적화(프로필·차량 사진 참조 인덱스, `users.email` 중복 인덱스 정리 등)
- `post_images` 연결 테이블 같은 구조 리팩터링
- DB 역할 세분화(앱용·마이그레이션용 분리)
- HSTS 확대·preload
- `scripts/nginx-forwarded-check.sh`의 CI 편입
- 여러 환경·DB 버전(PG16/PG18 등) 호환성 반복 검증
- 현재 사용량에서 의미 없는 pagination·성능 최적화
- unhealthy 컨테이너 자동 재시작, Neon 유휴 연결·자동 일시정지 영향 확인
- 차고 쓰기·장터 수정 rate limit 추가, Spring 자유 텍스트 서버측 sanitize, 로그인 응답 시간 차이·잠금 직전 동시 요청 보강
- 실제 문제가 발생하지 않은 구조적 cleanup
- 향후 개선사항 — 댓글 신고(2026-10-05 결정): Next.js 포팅 범위가 아닌 신규 기능으로 분리. board-service에 댓글 신고 API가 없고 `community_reports`는 `post_id`만 가지며, 기존 상세 페이지에도 없던 기능이다. 진행 시 API·테이블·관리자 처리 화면 설계부터 결정한다.
- **P3 전체**(P3-1~P3-9): 개발 로드맵의 선행조건이 아니다. 실제 사용자·트래픽·장애·데이터 증가로 필요성이 확인되거나, 관련 코드를 고칠 일이 생겼을 때 같이 처리하는 backlog다. 단, P3-8(모니터링)의 최소 형태는 NOW-4에 포함했다.

### 새 작업을 판단하는 기준

새 작업을 발견해도 바로 STEP으로 만들지 않는다. 먼저 판단한다.

1. 지금 실제 사용자에게 문제가 되는가?
2. 실제 운영·배포를 막는가?
3. 데이터 손실이나 명확한 보안 취약점인가?
4. 지금 처리하지 않으면 나중에 수정 비용이 크게 늘어나는가?

대부분 "아니요"면 backlog(위 "보류")로 보낸다. 회원 33명 규모에서 수십만 사용자 규모를 가정한 최적화·자동화·희귀 경쟁조건 방어를 먼저 구현하지 않는다. "가능한 문제"와 "지금 해결해야 하는 문제"를 구분한다. 검증 범위는 §5의 "작업 및 검증 경량화 원칙"을 따른다.

새 세션은 "지금 할 것"에서 **처음 `[ ]`인 작업 하나만** 진행한다. 여러 작업을 한 번에 진행하지 않는다.

---

### STEP 1: 비밀번호 최소 길이 + 요청 body 크기 제한 + 배포 문서 수정 (P1-1, P1-2, P1-5)

**작업 목적**: 1글자 비밀번호로 가입/재설정이 통과되는 문제와, 크기 제한 없는 JSON 역직렬화로 인한 메모리 고갈 DoS 가능성을 막는다. 또한 문서대로 실행하면 운영 하드닝(`docker-compose.prod.yml`)이 적용되지 않는 문제를 문서 수정으로 바로잡는다.

**관련 파일**
- `backend/src/main/java/com/revcc/app/AuthController.java` (`Credentials` record, 현재 155행 부근)
- `backend/src/main/java/com/revcc/app/PasswordResetController.java` (`ResetRequest` record, 16행)
- `backend/src/main/resources/application.yml`, `application-prod.yml`
- `docs/DOCKER-SUBMISSION.md`

**구현 요구사항**
1. `Credentials.password`, `ResetRequest.password`에 `@Size(min=..., max=255)` 추가. 최소 길이는 합리적인 값(예: 8) — 기존 계정(레거시 평문 비밀번호 포함)에는 영향 없어야 하므로 **로그인 검증이 아니라 signup/reset 입력 검증에만** 적용할 것. 레거시 평문 비밀번호 자동 마이그레이션 로직(`AuthController.login()`의 `isHash`/`upgradePassword`)은 건드리지 않는다.
2. `application.yml`/`application-prod.yml`에 body 크기 제한 추가 (`server.tomcat.max-http-form-post-size`, `spring.servlet.multipart.max-request-size` 등 필요한 항목만, 기존 `VehicleVerificationController`의 4.2MB 체크와 충돌하지 않는 값으로). 기존 이미지 업로드(base64, garage vehicle verification)가 깨지지 않는지 반드시 확인.
3. `docs/DOCKER-SUBMISSION.md`에 `docker-compose.prod.yml` 사용법 안내 추가(어떤 섹션에 넣을지는 기존 문서 구조를 참고해서 자연스럽게). 운영 배포 시 override가 자동 병합되지 않도록 `-f docker-compose.yml -f docker-compose.prod.yml` 형태를 명시.

**건드리지 말아야 할 영역**
- 로그인(`AuthController.login()`)의 레거시 비밀번호 허용 로직, BCrypt 마이그레이션 흐름
- `VehicleVerificationController`의 기존 4.2MB 매직바이트 체크 로직 자체
- P1-3/P1-4/P1-6/P1-7과 P2/P3 전 항목
- `docker-compose.override.yml`/`docker-compose.dev.yml`/`docker-compose.garage.yml`

**완료 조건**
- 1글자 비밀번호로 signup/reset 요청 시 400
- 기존 계정으로 로그인은 여전히 정상 동작(레거시 평문 비밀번호 계정 포함)
- 매우 큰 JSON body 요청이 적절한 크기에서 즉시 거부됨(메모리 전체 역직렬화 전에)
- 기존 차량 인증서류 업로드(4.2MB 이하) 정상 동작
- `docs/DOCKER-SUBMISSION.md`에 prod 배포 명령이 안내됨

**실행해야 할 테스트**
- `cd backend && mvn test` — 전체 통과, 특히 `AuthControllerTest`, `PasswordResetRequestTest`, `VehicleVerificationControllerTest`, `MemberFlowIntegrationTest`(스킵되면 스킵인 채로 통과) 확인
- 비밀번호 최소 길이 검증용 신규 테스트 추가(짧은 비밀번호 거부 케이스)
- body 크기 제한 신규 테스트 추가(가능한 형태로 — MockMvc 레벨에서 대용량 payload가 컨트롤러 로직 진입 전에 거부되는지)
- `cd board-service && npm test` — board-service는 이 STEP에서 변경하지 않으므로 회귀 없이 통과해야 함

---

### STEP 2: 부품장터 관리자 모더레이션 + admin/market 인가 테스트 (P1-4, P1-6)

**작업 목적**: 커뮤니티 게시글/댓글에는 있는 관리자 삭제 기능이 부품 장터(`market.js`)에는 없어 사기/어뷰징 매물을 관리자가 내릴 방법이 없다. 동시에, 실제로는 잘 구현되어 있다고 감사에서 확인된 `admin.js`/`admin-access.js`/`market.js`의 인가 로직이 자동 테스트로 전혀 보호되지 않고 있다.

**관련 파일**
- `board-service/src/market.js`
- `board-service/src/moderation.js` (커뮤니티 게시글 관리자 삭제가 이미 구현된 참고 패턴 — 트랜잭션 + `FOR UPDATE` 행 잠금 + `reason` 필수)
- `board-service/src/admin.js`, `board-service/src/admin-access.js`
- `board-service/test/` (신규 테스트 파일 추가)

**구현 요구사항**
1. `market.js`에 관리자 전용 매물 삭제(또는 숨김) 엔드포인트 추가. `moderation.js`의 기존 패턴(트랜잭션, 사유 필수, `moderation_logs` 기록)을 그대로 재사용 — 새 방식을 발명하지 말 것.
2. `admin.js`/`admin-access.js`에 대한 인가 테스트 추가: 비관리자 403, 강등된 관리자(role이 바뀐 세션) 거부, 실제 관리자의 정상 성공 경로.
3. `market.js`에 대한 IDOR 테스트 추가: 다른 판매자의 매물을 수정/삭제 시도하면 403 (커뮤니티 게시글에 이미 있는 `author_id` 서버검증 패턴과 동일하게, `market.js`가 이미 `seller_id` 검증을 하고 있다면 그 동작을 테스트로 고정하는 것이고, 없다면 구현부터 해야 함 — 코드를 먼저 확인).

**건드리지 말아야 할 영역**
- `community.js`/`moderation.js`의 기존 커뮤니티 모더레이션 로직(이미 잘 구현됨, 패턴만 참고하고 수정하지 말 것)
- `owned-images.js`, `rate-limit.js` 등 이 STEP과 무관한 파일
- P2-4(부품장터 rate limit 부재)는 이 STEP 범위 아님 — 발견해도 기록만

**완료 조건**
- 관리자가 사유를 남기고 타인의 부품 매물을 삭제할 수 있음
- 비관리자/강등된 관리자는 거부됨
- 판매자 본인이 아닌 사용자가 매물을 수정/삭제할 수 없음(이미 되어 있다면 테스트로 고정)
- 삭제 시 `moderation_logs`에 기록 남음

**실행해야 할 테스트**
- `cd board-service && npm test` — 신규 테스트 포함 전체 통과
- `cd backend && mvn test` — board-service만 건드리므로 회귀 없이 통과해야 함

---

### STEP 3: GitHub Actions CI 구성 (P1-7)

**작업 목적**: 현재 1000줄 넘는 Spring 테스트와 Node 테스트가 전부 로컬/수동 실행에만 의존한다. PR/push 시 자동으로 돌아가는 CI가 없다.

**관련 파일**
- 신규: `.github/workflows/ci.yml` (또는 backend/board-service 분리 시 2개 파일)

**구현 요구사항**
1. `docker-assignment` 브랜치(및 필요시 main)에 push/PR 시 트리거.
2. Spring: `mvn test` 실행. 기존처럼 실 DB/Redis 없이 도는 유닛테스트 위주로 충분(통합테스트 2클래스는 `REVCC_TEST_DB_PORT`/`REVCC_TEST_REDIS_PORT` 환경변수가 없으면 자동 skip되므로 CI에서 서비스 컨테이너를 반드시 띄울 필요는 없음 — 최소 구성으로 시작, 필요하면 이후 확장).
3. Node: `npm test`(board-service) 실행.
4. 시크릿을 워크플로에 하드코딩하지 말 것 — 필요한 값은 GitHub Actions secrets 참조로.

**건드리지 말아야 할 영역**
- 기존 테스트 코드 자체(실행 방식만 자동화, 테스트 내용 수정 금지)
- Dockerfile, docker-compose*.yml (이 STEP은 CI 워크플로만 추가)

**완료 조건**
- `.github/workflows/`에 워크플로 파일 존재
- 로컬에서 `act` 등으로 검증이 어려우면 최소한 YAML 문법 오류가 없고, 로컬 `mvn test`/`npm test` 커맨드와 동일한 명령을 그대로 사용했는지 확인

**실행해야 할 테스트**
- `cd backend && mvn test`, `cd board-service && npm test` — 워크플로에 넣을 명령이 로컬에서 그대로 통과하는지 먼저 확인
- YAML 유효성: `yamllint` 또는 유사 도구가 있으면 사용, 없으면 육안 검토

---

### STEP 4: Flyway/Liquibase 기반 DB 마이그레이션 정리 (P1-3)

**작업 목적**: `users` 테이블을 Hibernate `ddl-auto:update` + `backend/migrations/*.sql`(수동) + board-service 매 부팅 `schema.sql` 3곳이 조정 없이 건드리고 있다. 가장 구조적으로 위험한 항목이라 P1 중 가장 마지막(가장 신중하게) 진행한다.

**관련 파일**
- `backend/src/main/resources/application.yml` (`spring.jpa.hibernate.ddl-auto`)
- `backend/migrations/20260929_member_management.sql`
- `board-service/src/schema.sql`, `board-service/src/server.js`(schema.sql 실행 부분)
- `backend/pom.xml` (Flyway 의존성 추가 필요)

**구현 요구사항 — 반드시 신중하게, 단계적으로**
1. Flyway(권장, Spring Boot와 통합이 쉬움) 도입: 기존 스키마 상태를 그대로 baseline으로 잡는 마이그레이션 파일부터 작성(`V1__baseline.sql` 등) — **기존 운영 데이터가 있는 DB에 적용될 수 있으므로 `baselineOnMigrate` 옵션 등으로 기존 테이블을 파괴하지 않게 할 것**.
2. `ddl-auto`를 `update`에서 `validate`로 전환하는 것은 Flyway 마이그레이션이 실제 스키마와 완전히 일치함을 확인한 뒤 마지막에 진행.
3. board-service의 `schema.sql` 매 부팅 실행 로직은, Spring이 스키마 소유권을 가져간 이후 board-service 쪽 `ALTER TABLE`(예: `created_at` 추가)도 Flyway 마이그레이션으로 옮길지, 아니면 board-service 전용 스키마 요소만 남길지 결정 필요 — **이 판단은 작업 시작 전에 코드를 다시 확인하고 정하되, 두 서비스가 같은 `users` 테이블을 건드리는 순서 의존성을 반드시 명시적으로 해결할 것**.

**건드리지 말아야 할 영역**
- 기존 컬럼/제약조건의 의미를 바꾸는 스키마 변경(이 STEP은 마이그레이션 "관리 체계"를 만드는 것이지 스키마 자체를 바꾸는 것이 아니다)
- P2-11(FK RESTRICT 문제)은 이 STEP 범위 아님 — 발견해도 기록만

**완료 조건**
- Flyway 마이그레이션이 기존 로컬/테스트 DB에 적용되어도 데이터 손실 없이 통과
- `mvn test`의 통합테스트(REVCC_TEST_DB_PORT 설정 시)가 정상 동작
- board-service 재기동 시 스키마 충돌 없음

**실행해야 할 테스트**
- `cd backend && mvn test` (가능하면 `REVCC_TEST_DB_PORT`/`REVCC_TEST_REDIS_PORT`를 실제로 설정해 통합테스트까지 포함해서 실행 — 이 STEP은 스키마를 건드리므로 스킵 없이 검증하는 것을 강력히 권장)
- `cd board-service && npm test`
- 로컬 docker compose로 처음부터 기동(`docker compose down -v` 후 `docker compose up -d --build --wait`)해서 컨테이너가 정상 기동하는지 수동 확인 — **`-v`는 로컬 테스트 볼륨에서만, 운영 볼륨에는 절대 사용하지 말 것**

---

### STEP 5: Rate Limit 보강 (P2-2, P2-4)

> **분리안 채택(2026-09-30 사용자 승인)**: **5-A**(외부 X-Forwarded-For 신뢰 문제 해결 + limiter 메모리 정리)와 **5-B**(계정 단위 로그인 제한 + board 누락 엔드포인트 + `admin-system.mjs` 정합화)를 각각 별도 STEP·별도 커밋으로 진행한다. 5-A를 먼저 끝내야 5-B의 IP 기반 제한이 의미를 가진다.

**작업 목적**: 로그인 시도 제한이 IP 기준만 있어 IP를 바꿔 가며 한 계정을 계속 시도할 수 있고, 그 IP 자체도 위조될 수 있다. 두 limiter 모두 만료된 버킷을 지우지 않아 메모리가 계속 늘어난다. board에는 제한 없는 쓰기·조회수 엔드포인트가 남아 있다.

**현재 구현 상태 (2026-09-30 코드 확인)**
- Spring `RateLimitFilter.java`: 인메모리 고정 윈도, 키는 `URI|request.getRemoteAddr()`, 분당 10회. `RateLimitConfig.java`가 `/api/auth/login`, `/api/auth/signup`, `/api/auth/check-username`에만 적용한다. `hits`(ConcurrentHashMap)의 만료 항목을 지우는 코드가 없다.
- **IP 위조 가능성(재현 테스트로 먼저 확인할 것)**: nginx(`nginx/default.conf`)는 `X-Forwarded-For $proxy_add_x_forwarded_for`로 **클라이언트가 보낸 값 뒤에 덧붙인다**. Spring `forward-headers-strategy: framework`(ForwardedHeaderFilter)는 X-Forwarded-For의 **첫 번째 값**을 remoteAddr로 쓴다. 그러면 클라이언트가 `X-Forwarded-For: 1.2.3.4`를 보내 로그인 limit과 비밀번호 재설정 IP limit(`PasswordResetController`가 `getRemoteAddr()`를 넘김)을 우회할 수 있다. Express는 `trust proxy: 1`(`app.js:37`)이라 마지막 홉만 믿으므로 안전하다.
- **Cloudflare 뒤 운영 시**: nginx의 `$remote_addr`가 Cloudflare 엣지(또는 Tunnel의 cloudflared) IP가 되어 IP 기반 제한이 전부 몇 개의 버킷으로 뭉친다. P0-2에서 A안(Cloudflare가 TLS 종단)을 채택했지만 **프록시 DNS인지 Tunnel인지는 아직 정해지지 않았다**.
- board `rate-limit.js`: 인메모리 고정 윈도, 키는 `u:<userId>` 또는 `ip:<req.ip>`. 역시 만료 항목을 지우지 않는다. `community.js`의 글(10/분), 댓글(20/분), 방명록(10/분), 이미지(20/분) 작성에만 적용돼 있다.
- board에서 제한이 없는 곳(P2-4): `POST /api/parts/listings`(`market.js:154`), `POST /api/parts/listings/:id/view`(`market.js:217`, 비인증), `POST /api/board/posts/:id/view`(`community.js:212`, 비인증), `POST /api/board/posts/:id/report`(`community.js:293`).
- 비밀번호 재설정은 이미 Redis 기반 제한이 있다(`PasswordResetService.limit()`, Lua 카운터). 계정 단위 로그인 제한을 만들 때 재사용할 수 있는 패턴이다.

**관련 파일**
- 5-A: `nginx/default.conf`, `backend/src/main/resources/application.yml`(`forward-headers-strategy`), `backend/src/main/java/com/revcc/app/RateLimitFilter.java`, `board-service/src/rate-limit.js`, 테스트 `RateLimitFilterTest.java`, `board-service/test/rate-limit.test.js`
- 5-B: `AuthController.java`(`login()`), 신규 계정 단위 제한 클래스(또는 `RateLimitConfig.java` 확장), `board-service/src/market.js`, `board-service/src/community.js`, 테스트 `AuthControllerTest.java`, `board-service/test/admin-market.test.js`, `board-service/test/app.test.js`

**결정 사항 (2026-09-30)**
- Cloudflare 운영 방식(프록시 DNS / Tunnel)은 **아직 미확정**이다. 그래서 5-A는 **외부 X-Forwarded-For 신뢰 문제 해결까지만** 한다. Cloudflare 뒤에서 실제 client IP를 복원하는 작업(`real_ip_header`, `set_real_ip_from`)은 필요해지면 **STEP 9**에서 처리한다.

**작업 시작 전 사용자 확인**
- 계정 단위 제한 수치(권장: 같은 아이디로 15분에 로그인 실패 5회 → 15분 동안 429)와 board 신규 제한 수치(권장: 매물 등록 10/분, 조회수 IP당 60/분, 신고 10/분).

**구현 요구사항**
- 5-A
  1. 재현 테스트부터 작성한다. 위조한 `X-Forwarded-For`가 Spring의 remoteAddr를 바꾸는지 확인한다(MockMvc + ForwardedHeaderFilter, 또는 임시 nginx+core 스택에 curl). 재현되지 않으면 그 결과를 기록하고 이 항목은 테스트로 고정만 한다.
  2. nginx 두 `/api` location에서 `X-Forwarded-For`를 `$remote_addr`로 **덮어쓴다**(덧붙이지 않는다). 그러면 클라이언트가 보낸 X-Forwarded-For는 core/board에 전달되지 않는다. Cloudflare 실제 IP 복원은 이 STEP에서 하지 않는다(STEP 9).
  3. 로컬 직접 접속(`http://localhost:8090`, 앞단 헤더 없음) 동작은 지금과 같아야 한다.
  4. 두 limiter 모두 만료된 버킷을 정리한다(주기적 sweep 또는 접근 시 정리 + 상한). 고정 윈도 동작과 응답(429, `Retry-After`)은 그대로 유지한다.
- 5-B
  1. 계정 단위 로그인 실패 제한: Redis 카운터로 구현하고, 키는 정규화한 username의 digest로 한다. **존재하지 않는 아이디도 똑같이 카운트하고 똑같이 응답한다**(로그인의 계정 열거 방지를 유지). 영구 잠금은 하지 않고 시간 창만 두어 피해자 계정 DoS를 막는다. IP 제한(기존 필터)은 그대로 둔다.
  2. board 누락 엔드포인트 4곳에 기존 `rateLimiter`를 적용한다. 조회수 엔드포인트는 비인증이라 `ip:` 키를 쓴다(5-A 이후라야 의미가 있다).
  3. `scripts/admin-system.mjs` 정합화: 같은 사용자로 게시글 23개를 API로 연속 작성하다 글 작성 제한(10/분)에 걸려 실패하는 기존 충돌을 해소한다(STEP 4 follow-up에서 발견, "발견된 추가 이슈" 참고). 페이지네이션 검증 의미(게시글 23개, 20/3 분할, 카테고리 11개)는 그대로 유지한다. 방식(작성자 분산, 대기, SQL로 fixture 삽입)은 5-B 작업 때 정하되, rate limit 자체를 우회하는 테스트 전용 설정은 만들지 않는다. `scripts/run-board-system.sh`로 5개 수동 테스트가 모두 PASS해야 한다.

**건드리지 말아야 할 영역**
- 로그인 응답 형태(존재하지 않는 아이디와 틀린 비밀번호가 같은 401), 레거시 비밀번호 마이그레이션, 세션 발급 로직
- `PasswordResetService`의 제한 수치와 응답 코드(STEP 11 범위)
- nginx `limit_req`, HSTS, 타임아웃(STEP 9 범위). 5-A는 IP 전달 헤더만 수정한다
- Redis 인증(STEP 7), 카카오 로그인 흐름

**완료 조건**
- 위조한 `X-Forwarded-For`로 Spring의 IP 버킷을 바꿀 수 없다(테스트로 고정)
- 같은 아이디에 대해 IP를 바꿔도 실패가 N회를 넘으면 429, 존재하지 않는 아이디도 같은 동작이다
- 두 limiter의 버킷 수가 만료 후 줄어든다(가짜 시계를 쓴 테스트)
- board 4개 엔드포인트가 한도 초과 시 429 + `Retry-After`를 반환한다
- 로컬 `http://localhost:8090` 로그인·글쓰기가 정상이다

**실행해야 할 테스트**
- `cd backend && mvn test`(`REVCC_TEST_DB_PORT`/`REVCC_TEST_REDIS_PORT`를 설정해 통합테스트 포함). 신규: XFF 위조 테스트, 버킷 정리 테스트, 계정 단위 제한 테스트(존재하지 않는 아이디 포함)
- `cd board-service && npm test`. 신규: 버킷 정리 테스트, 4개 엔드포인트 429 테스트
- nginx: 임시 네트워크에서 `nginx -t`, 위조 XFF 헤더를 넣은 curl로 core에 전달되는 값 확인

---

### STEP 6: 서버측 XSS 방어 (P2-3)

**작업 목적**: board-service는 게시글·댓글·장터글·방명록·프로필을 원문 그대로 저장하고 반환한다. 지금은 프론트가 안전하게 렌더링해서 실제 XSS는 없지만, 나중에 `innerHTML`을 쓰는 소비자(관리자 도구, 다른 클라이언트)가 생기면 바로 저장형 XSS가 된다. 서버에도 방어선을 둔다.

**현재 구현 상태 (2026-09-30 코드 확인)**
- `board-service/src/validation.js`의 `text()`는 타입·길이·trim만 검사한다. sanitize 의존성이 없다. `community.js`에서 14곳, `market.js`에서 9곳이 `text()`를 거친다.
- `assignment-frontend`는 `textContent` 기반으로 렌더링한다. `innerHTML`은 `js/admin.js:76`(빈 문자열로 초기화)과 `js/footer.js:5`(정적 마크업)뿐이다. Next.js 프로토타입(`frontend/`)에는 `dangerouslySetInnerHTML`이 없다.
- nginx CSP가 `script-src 'self'`(인라인 스크립트 불허)라서 이미 강한 완화책이 하나 있다.

**결정 사항 (2026-09-30)**: **B안(입력 시 HTML 태그 제거)을 기본 구현안으로 채택한다.** 아래 A/C는 비교를 위해 남겨 둔 기록이다.

**방식 비교 (기록)**
- **A. 원문 보존 + 위험 문자만 정리**: 제어 문자, zero-width 문자, bidi override 문자를 제거한다. `<`, `>`는 그대로 둔다. 데이터 변형이 가장 적지만 "HTML 태그 제거"는 하지 않는다.
- **B. 입력 시 HTML 태그 제거(채택)**: `sanitize-html`을 `allowedTags: []`, `allowedAttributes: {}`로 적용하고 A의 문자 정리도 함께 한다. 구조적 방어가 되지만 `a<b`, `<3` 같은 정상 텍스트가 변형될 수 있으니 테스트로 동작을 고정한다.
- **C. 저장 시 HTML 이스케이프(비권장)**: 프론트가 `textContent`로 그리므로 `&lt;`가 화면에 그대로 보이는 이중 인코딩이 생긴다.

**관련 파일**
- `board-service/src/validation.js`(`text()`에 중앙 적용), `board-service/package.json`/`package-lock.json`(B안 의존성), `board-service/test/`(신규 `sanitize.test.js` 또는 기존 `community.test.js`/`admin-market.test.js` 확장)

**구현 요구사항**
1. 선택한 방식을 `text()` 한 곳에 적용해 모든 자유 텍스트 필드에 똑같이 적용되게 한다. 카테고리·상태 같은 enum 값은 기존 allow-list 검증을 그대로 쓴다.
2. 정리한 뒤 빈 문자열이 되면 필수 필드는 기존과 같은 400을 반환한다(예: 태그만 있는 게시글).
3. 길이 검사는 정리 **후** 값 기준으로 할지 정리 **전** 기준으로 할지 정하고 테스트로 고정한다(권장: 정리 전 원문 기준으로 거부해 과대 입력 처리 비용을 막는다).
4. 기존에 저장된 데이터는 변경하지 않는다(백필 없음). 백필이 필요하면 별도 STEP으로 제안한다.

**건드리지 말아야 할 영역**
- 프론트 렌더링 코드, nginx CSP(STEP 9)
- Spring이 저장하는 텍스트(차고 차량 필드, `users.nickname`) — "발견된 추가 이슈"에 기록만 한다
- 이미지 업로드 검증(`owned-images.js`)

**완료 조건**
- `<script>alert(1)</script>`, `<img src=x onerror=...>`, `javascript:` 링크 등이 게시글·댓글·장터글·방명록·프로필 어디에도 태그로 저장되지 않는다(B안 기준)
- 한글·이모지·줄바꿈·일반 부등호 텍스트의 동작이 테스트로 고정되어 있다
- 기존 테스트가 회귀 없이 통과한다

**실행해야 할 테스트**
- `cd board-service && npm test`(신규 sanitize 테스트 포함)
- `cd backend && mvn test`(board만 바뀌므로 회귀 확인용)
- 가능하면 임시 스택에서 게시글 작성 → 조회 왕복 확인(`scripts/community-system.mjs`는 현재 깨져 있어 사용 불가 — "발견된 추가 이슈" 참고)

---

### STEP 7: Redis 인증 / 네트워크 분리 / DB credential (P2-5, P2-6)

> **분리안 채택(2026-09-30 사용자 승인)**: **7-A** Redis 인증 + DB credential 정리(환경변수와 코드 변경), **7-B** Docker 네트워크 분리(compose 구조 변경)를 각각 별도 STEP·별도 커밋으로 진행한다.

**작업 목적**: Redis에 인증이 없어서 같은 네트워크의 컨테이너 하나만 뚫려도 세션 전체를 읽고 쓸 수 있다. 모든 컨테이너가 평면 브리지 하나(`revcc-network`)에 있다. 그리고 운영 오버레이의 DB 비밀번호 배선이 실제 운영 DB(Neon)와 맞지 않는다.

**현재 구현 상태 (2026-09-30 코드 확인)**
- `docker-compose.yml` redis: `requirepass` 없음. core는 `REDIS_HOST`만, board는 `REDIS_URL=redis://redis:6379`만 받는다. Spring `application.yml`에 `spring.data.redis.password`가 없다.
- `scripts/assignment-run.sh`(docker run 방식 제출 스크립트)도 무인증 redis를 띄우고 로컬 postgres(`POSTGRES_PASSWORD:-revcc`)에 연결한다.
- `docker-compose.dev.yml`: redis를 `127.0.0.1:6379`로 노출한다(컨테이너 밖 로컬 개발용).
- **DB credential 불일치**: 기본 compose의 core/board는 `.env`의 `DB_HOST/DB_USER/DB_PASSWORD`(Neon)로 접속한다. 그런데 `docker-compose.prod.yml`은 core의 `POSTGRES_PASSWORD`와 board의 `PGPASSWORD`를 **로컬 postgres용 변수인 `${POSTGRES_PASSWORD}`로 덮어쓴다**. 두 값이 다르면 prod 오버레이로 기동할 때 Neon 인증에 실패한다. STEP 1에서 문서화한 prod 배포 명령이 그대로는 동작하지 않을 수 있다.
- 로컬 postgres 서비스는 core가 Neon을 쓰는데도 `depends_on`으로 항상 함께 뜬다(과제 제출용 "6개 컨테이너" 구성의 일부).
- **네트워크**: `networks.default.name: revcc-network` 하나뿐이다. `ASSIGNMENT.md:175`와 `docs/DOCKER-SUBMISSION.md:24,81,92`가 "`revcc-network`에 6개 컨테이너 연결"을 제출 확인 항목으로 쓴다.

**결정 사항 (2026-09-30)**
- 네트워크 분리(7-B)는 **기본 과제 compose(`revcc-network` 6개 구성)를 유지하고 prod 오버레이에서만 적용하는 것을 기본안으로 한다.**

**작업 시작 전 사용자 결정 (7-A)**
- 운영 DB는 Neon으로 확정인가? 확정이면 prod 오버레이에서 로컬 postgres 서비스를 빼는 것(compose `!reset`, 현재 Docker Compose v5.5.1에서 지원)을 권장한다.

**관련 파일**
- 7-A: `docker-compose.yml`(redis command/healthcheck, core/board 환경변수), `docker-compose.prod.yml`, `backend/src/main/resources/application.yml`(`spring.data.redis.password`), `board-service/src/server.js`(`createClient`에 password 전달), `scripts/assignment-run.sh`, `docs/DOCKER-SUBMISSION.md`
- 7-B: `docker-compose.prod.yml`(적용 위치), `docker-compose.garage.yml`(garage-ui가 proxy에 도달해야 함), `docs/DOCKER-SUBMISSION.md`

**구현 요구사항**
- 7-A
  1. Redis: `redis-server --requirepass "$REDIS_PASSWORD"`를 쓰고, healthcheck는 `REDISCLI_AUTH` 환경변수를 사용한다(비밀번호를 명령줄 인자로 노출하지 않는다). 기본 compose는 로컬 편의 기본값을 둔다(`POSTGRES_PASSWORD:-revcc`와 같은 패턴). prod 오버레이는 `${REDIS_PASSWORD:?...}`로 강제한다.
  2. Spring: `spring.data.redis.password: ${REDIS_PASSWORD:}`. board: URL에 비밀번호를 넣지 말고 `createClient({ url, password: process.env.REDIS_PASSWORD || undefined })`로 넘긴다(특수문자 URL 인코딩 문제 회피).
  3. 비밀번호가 비어 있으면 지금처럼 무인증으로 접속되어야 한다. CI의 redis 서비스와 통합테스트는 변경 없이 통과해야 한다.
  4. prod 오버레이의 DB 배선을 바로잡는다. core/board는 `DB_HOST/DB_NAME/DB_USER/DB_PASSWORD`를 `:?`로 강제하고, `POSTGRES_PASSWORD` 덮어쓰기는 로컬 postgres 서비스에만 남긴다(또는 결정에 따라 prod에서 postgres 서비스 제거).
  5. `scripts/assignment-run.sh`에도 Redis 비밀번호를 똑같이 적용한다.
- 7-B (prod 오버레이에만 적용)
  1. 권장 구성: `edge`(proxy, frontend), `app`(proxy, core, board), `data`(core, board, redis[, postgres], `internal: true`). core와 board는 Neon·Kakao·SMTP로 나가야 하므로 외부 통신이 되는 `app` 네트워크에도 붙어 있어야 한다.
  2. frontend 컨테이너에서 redis/postgres에 도달할 수 없음을 확인한다.

**건드리지 말아야 할 영역**
- 세션 키 형식(`revcc:session:<token>`)과 Spring/Node 공유 계약
- 기본 compose의 `revcc-network` 6개 컨테이너 구성(변경 금지 — 7-B는 prod 오버레이에만 적용), `docker-compose.override.yml`
- 커넥션 풀·restart 정책·`.env.example` 전체 정리(STEP 8). 단 이 STEP에서 새로 추가하는 `REDIS_PASSWORD`는 `.env.example`에 추가해도 된다
- Neon DB 역할/권한 구조 변경

**완료 조건**
- 비밀번호 없이 `redis-cli ping`하면 `NOAUTH`로 거부되고, core/board는 정상적으로 세션을 공유한다(로그인 → board 글쓰기)
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml config`에서 core/board의 DB 비밀번호가 `DB_PASSWORD` 값을 가리킨다
- (7-B) prod 구성에서 frontend → redis 연결이 실패하고, proxy → core/board와 core/board → Neon은 성공한다
- 기본 compose와 `scripts/assignment-run.sh` 과제 시연이 그대로 동작한다

**실행해야 할 테스트**
- `cd backend && mvn test`(통합 포함), `cd board-service && npm test`
- 임시 스택(임시 postgres + 인증 redis)으로 core+board 기동, 로그인 → board 세션 인식 확인. **Neon에는 연결하지 않는다**
- `docker compose ... config`로 prod 오버레이 렌더링 결과 확인(실제 기동 없이)

---

### STEP 8: 운영 안정성 — 커넥션 풀 / restart 정책 / .env.example (P2-7, P2-8, P2-9)

> **분리안**: 커넥션 풀(코드·설정)과 compose/문서(restart, `.env.example`)는 서로 독립적이다. 한 세션에 넘치면 8-A(풀) / 8-B(restart + env)로 나눈다.

**작업 목적**: DB 풀이 전혀 튜닝되지 않아서 풀이 고갈되면 board 요청이 무한 대기한다. 컨테이너가 죽어도 자동으로 재시작되지 않는다. `.env.example`만 보고서는 실행에 필요한 변수를 알 수 없다.

**현재 구현 상태 (2026-09-30 코드 확인)**
- Spring: `application.yml`/`application-prod.yml`에 `spring.datasource.hikari.*`가 없다(Hikari 기본값, 최대 10).
- board: `server.js`의 `new pg.Pool({ ssl })`에 `max`/`idleTimeoutMillis`/`connectionTimeoutMillis`가 없다(`connectionTimeoutMillis` 기본 0 = 무한 대기). 모든 인증 요청이 `app.js:49-58`에서 DB를 한 번 더 조회하므로 풀 영향이 크다.
- 운영 DB는 Neon **직접 연결**(`-pooler` 호스트 아님, 2026-09-30 `.env` 확인), PostgreSQL 18.6. core + board 합계 최대 20개 연결이 Neon 한도 안에 드는지 확인된 적이 없다.
- 5개 compose 파일 어디에도 `restart:`가 없다. 참고로 Docker는 healthcheck가 unhealthy여도 컨테이너를 재시작하지 않는다(프로세스가 종료될 때만 restart 정책이 동작).
- `.env.example`에는 SMTP/비밀번호 재설정 변수만 있다. compose가 쓰는 `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`, `POSTGRES_PASSWORD`, `KAKAO_CLIENT_ID/KAKAO_CLIENT_SECRET/KAKAO_REDIRECT_URI`, `SESSION_COOKIE_SECURE`, `REVCC_PORT`, `GARAGE_PORT`(+ STEP 7의 `REDIS_PASSWORD`)가 빠져 있다.

**작업 시작 전 확인**
- Neon의 `SHOW max_connections`(읽기 전용 쿼리)와 플랜의 연결 한도를 확인한 뒤 풀 크기를 정한다.
- restart 정책을 prod 오버레이에만 둘지(권장: 로컬 PC가 부팅될 때 Neon에 붙는 스택이 자동으로 뜨지 않도록) 기본 compose에도 둘지.

**관련 파일**
- `backend/src/main/resources/application.yml` 또는 `application-prod.yml`(hikari), `board-service/src/server.js`(pg.Pool 옵션), `docker-compose.prod.yml`(또는 `docker-compose.yml`)의 `restart:`, `.env.example`, `docs/DOCKER-SUBMISSION.md`(변수 안내)

**구현 요구사항**
1. Hikari: `maximum-pool-size`, `minimum-idle`, `connection-timeout`(권장 5초), `max-lifetime`(Neon/네트워크 idle 끊김보다 짧게)을 명시한다. 값은 환경변수로 덮어쓸 수 있게 하고 로컬 기본값을 둔다.
2. board pg.Pool: `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`(권장 5000)를 설정하고 환경변수로 덮어쓸 수 있게 한다. 기존 에러 핸들러(`app.js:84`)는 알 수 없는 오류를 이미 503으로 응답하므로, 풀 대기 타임아웃 오류가 이 경로로 503이 되는지 테스트로 고정한다.
3. 모든 서비스에 `restart: unless-stopped`(결정한 위치에).
4. `.env.example`: compose와 코드가 실제로 쓰는 변수를 전부 나열하고, 각 변수에 필수/선택, 로컬 기본값, 운영 필수 여부를 주석으로 단다. **실제 값은 절대 넣지 않는다.**

**건드리지 말아야 할 영역**
- 연결 대상(Neon 호스트, sslmode), 스키마(Flyway)
- 네트워크/Redis 인증(STEP 7), nginx(STEP 9)
- healthcheck 명령 자체(필요하면 타임아웃 조정 제안만 기록)

**완료 조건**
- board 풀 고갈 상황에서 요청이 설정한 타임아웃 안에 503으로 끝난다(테스트 또는 임시 스택에서 `max=1`로 재현)
- Spring 풀 설정이 기동 로그/설정에 반영된다
- `docker compose ... config`에서 모든 서비스에 restart 정책이 있다
- `.env.example`의 변수 목록 ⊇ compose가 참조하는 `${...}` 변수 목록(스크립트로 대조)

**실행해야 할 테스트**
- `cd backend && mvn test`(통합 포함), `cd board-service && npm test`(신규: 풀 타임아웃 → 503 매핑 테스트)
- `grep -oh '\${[A-Z_]*' docker-compose*.yml`과 `.env.example` 변수 대조
- 임시 스택에서 core/board 기동 확인. `docker kill` 후 자동 재시작 확인(restart 정책)

---

### STEP 9: Nginx 하드닝 (P2-10)

**작업 목적**: rate limit이 애플리케이션 계층에만 있어서, 앱 로직에 버그가 있으면 엣지에서 막아 줄 장치가 없다. HTTPS 운영인데 HSTS 헤더가 없다. 프록시 타임아웃도 명시돼 있지 않다.

**현재 구현 상태 (2026-09-30 코드 확인)**
- `nginx/default.conf`: `limit_req_zone`/`limit_conn_zone`이 없다. HSTS가 없다. `proxy_*_timeout`이 명시되지 않았다(기본 60초). `server_tokens`가 설정되지 않았다(버전 노출).
- 이미 있는 것: CSP(`script-src 'self'`), `X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control: no-store`, `client_max_body_size 5m`, JSON이 아닌 POST/PUT/PATCH 거부(415), `X-Forwarded-Proto`가 `http`일 때 301 https.
- 헤더는 모두 server 블록의 `add_header ... always`다. location 블록에 `add_header`를 하나라도 추가하면 nginx 상속 규칙 때문에 server 블록 헤더가 전부 사라진다.
- `limit_req`의 키(`$binary_remote_addr`)는 STEP 5-A의 실제 IP 복원이 끝나야 의미가 있다. Cloudflare 뒤에서는 엣지 IP로 뭉친다.

**관련 파일**
- `nginx/default.conf`(주 대상), `nginx/Dockerfile`(변경 없을 것으로 예상), `docs/DOCKER-SUBMISSION.md`(확인 명령 안내)

**구현 요구사항**
1. `limit_req_zone`: 인증 엔드포인트(`/api/auth/`: 로그인, 가입, 아이디 확인, 비밀번호 재설정, 카카오)용 엄격한 zone과 `/api/` 전체용 느슨한 zone을 둔다. `limit_req_status 429`. 앱 계층 제한보다 **느슨하게** 잡아 정상 사용자가 nginx에서 먼저 막히지 않게 한다(앱 제한이 1차, nginx는 안전망).
2. HSTS: 원요청이 https일 때만 보낸다(`$proxy_x_forwarded_proto`가 `https`면 헤더 값, 아니면 빈 값 → nginx가 헤더를 생략). 초기 `max-age`는 짧게 시작하고, `includeSubDomains`/`preload`는 사용자 결정 전에는 넣지 않는다.
3. `proxy_connect_timeout`/`proxy_read_timeout`/`proxy_send_timeout`을 명시한다(인증서류 업로드 5MB를 고려한다).
4. `server_tokens off`.
5. Cloudflare 실제 client IP 복원(5-A에서 제외됨): 이 시점까지 Cloudflare 운영 방식(프록시 DNS / Tunnel)이 정해졌으면 `real_ip_header CF-Connecting-IP` + `set_real_ip_from <신뢰 대역>`으로 `$remote_addr`를 실제 클라이언트로 복원한다. Cloudflare IP 목록을 하드코딩한다면 출처 URL과 확인 날짜를 주석으로 남긴다. 아직 정해지지 않았으면 미룬다고 기록한다(이 경우 `limit_req`는 Cloudflare 엣지 IP 단위로 동작한다는 한계를 문서화한다).

**건드리지 말아야 할 영역**
- CSP 값, 415 폼 차단, `X-Forwarded-Proto` 리다이렉트 로직(P0-2)
- `assignment-frontend/nginx.conf`(frontend 컨테이너 내부 설정)
- 앱 계층 rate limit(STEP 5)

**완료 조건**
- 인증 엔드포인트에 짧은 시간 버스트를 보내면 nginx가 429를 반환한다(앱 제한보다 느슨한 수준에서)
- `X-Forwarded-Proto: https`로 요청하면 HSTS 헤더가 있고, 로컬 http 직접 접속에는 없다
- 로컬 `http://localhost:8090`의 기존 기능(로그인, 글쓰기, 이미지·인증서류 업로드)이 정상이다
- 응답 헤더에 nginx 버전이 노출되지 않는다

**실행해야 할 테스트**
- 임시 네트워크에서 proxy 이미지로 `nginx -t`, curl로 버스트 → 429, HSTS 조건부 동작, 기존 보안 헤더 유지 확인
- `cd backend && mvn test`, `cd board-service && npm test`(회귀 확인용)

**결정·결과 (2026-09-30, `c9a4490`)**
- 운영 방식 확정: **Cloudflare Named Tunnel**. 사용자 → rev.cc(Cloudflare DNS·HTTPS 종단) → Named Tunnel → `cloudflared` 컨테이너 → proxy(nginx) → frontend/core/board. prod 오버레이에 `cloudflared`(2026.9.3 고정, `CLOUDFLARE_TUNNEL_TOKEN` 필수, `tunnel ready` healthcheck)를 추가했다. proxy는 호스트 포트를 게시하지 않는다(`ports: !reset []`).
- 신뢰 경계: `cloudflared`는 proxy와 둘만 있는 `tunnel` 네트워크(172.16.238.0/28, 동적 할당은 .8/29)의 고정 주소 172.16.238.2를 쓴다. nginx는 `set_real_ip_from 172.16.238.2` + `real_ip_header CF-Connecting-IP`로 이 주소에서 온 요청만 실제 IP를 복원한다. X-Forwarded-For는 신뢰하지 않는다(재귀 해석 없음). 기존 5-A 덮어쓰기(`X-Forwarded-For $remote_addr`)는 그대로다.
- Quick Tunnel(TryCloudflare, 사용자 허용)로 Cloudflare 엣지를 실측한 근거: CF-Connecting-IP는 엣지가 만들고 클라이언트가 보내면 엣지가 거부(error 1000, HTTP 403), X-Forwarded-For는 클라이언트 값 뒤에 덧붙임, `Forwarded`·`True-Client-IP`·`X-Forwarded-Host/Port/Ssl`은 그대로 통과, X-Forwarded-Proto·CF-Visitor는 엣지가 덮어씀, X-Real-IP는 제거됨.
- **발견·수정한 5-A 우회**: Spring ForwardedHeaderFilter는 `Forwarded: for=`를 X-Forwarded-For보다 먼저 쓰고, nginx는 이 헤더를 지우지 않았다. 그래서 `Forwarded`를 요청마다 바꾸면 core 로그인 IP 제한을 끝없이 우회할 수 있었다(실제 core에서 12회 모두 401, 429 없음). nginx가 `Forwarded`, `True-Client-IP`, `X-Forwarded-Host/Port/Prefix/Ssl`, `CF-Connecting-IP`를 core/board로 넘기지 않게 했다(수정 후 11번째 429). `ForwardedClientIpTest`에 재현 테스트를 추가했다.
- rate limit(2차 안전망, 앱 수치는 변경 없음): `revcc_api` `/api` 전체 IP당 20r/s·burst 200 nodelay, `revcc_auth` 로그인·가입·아이디 확인·비밀번호 재설정·카카오 IP당 30r/m·burst 30 nodelay(`/api/auth/me`·`logout` 제외). 429는 앱과 같은 JSON 본문이다.
- HSTS `max-age=300`: 연결이 172.16.238.2에서 왔고 X-Forwarded-Proto가 https일 때만 보낸다(`includeSubDomains`/`preload` 없음). 로컬 http나 위조한 X-Forwarded-Proto에는 붙지 않는다.
- timeout: `proxy_connect 5s`, `proxy_send 30s`, `proxy_read 30s`(앱 최악 약 20초보다 길고 Cloudflare 100초보다 짧다), `client_header 15s`, `client_body 30s`, `send 30s`, `keepalive 100s`(cloudflared 유휴 연결 재사용 90초보다 길게). `server_tokens off`.

---

### STEP 10: 회원탈퇴 / FK 정책 결정 (P2-11) — ⚠ 결정 STEP, 구현하지 않음

> 이 STEP은 **선택지와 영향만 정리**한다. 사용자가 데이터 보존 정책을 결정하면 그 결정을 이 파일에 기록하고, 별도의 구현 STEP(예: STEP 10-impl)을 새로 정의한 뒤 진행한다.

**현재 상태 (2026-09-30, `V1__baseline.sql` 기준)**
- 회원을 삭제하는 코드 경로가 없다. `AdminMemberController`는 정지/비활성화(`account_status`)만 한다.
- `users(id)`를 참조하는 FK:
  - **RESTRICT(기본 NO ACTION)** → 이 행이 하나라도 있으면 `DELETE FROM users` 실패: `board_posts.author_id`, `board_comments.author_id`, `vehicle_verifications.reviewed_by`(인증을 검토한 관리자는 삭제 불가)
  - **CASCADE** → 회원과 함께 삭제: `community_images.owner_id`, `owner_vehicles.owner_id`(→ `vehicle_records`, `vehicle_verifications` 연쇄 삭제, `board_posts.vehicle_id`와 `member_profiles.representative_vehicle_id`는 SET NULL), `board_likes`, `board_bookmarks`, `community_notifications.user_id/actor_id`, `community_reports.user_id`, `garage_guestbook.owner_id/author_id`, `parts_listings.seller_id`(→ `parts_favorites` 연쇄), `parts_favorites.user_id`, `member_profiles.user_id`
  - **SET NULL**: `community_reports.reviewed_by`
  - **FK 없음(느슨한 참조)**: `moderation_logs`(admin/target id + username·원문 스냅샷), `admin_member_actions.admin_id/user_id`, `board_posts.image_ids`/`parts_listings.image_ids`(배열이라 이미지가 CASCADE로 지워지면 남은 id가 깨진 참조가 됨), Redis 세션·비밀번호 재설정 키
- 관련 동작: 본인 게시글 삭제는 하드 DELETE(`moderation.js:30`)라서 그 글에 대한 처리 대기 신고(`community_reports.post_id` CASCADE)가 함께 사라진다(신고 회피 가능).

**선택지**
- **A. 소프트 탈퇴 + 개인정보 익명화(권장 후보)**
  - 방식: `users` 행을 유지하고 `account_status='WITHDRAWN'`(새 값)으로 바꾼다. username → `deleted_<id>`, 비밀번호 → 무작위 해시, `email`/`kakao_id`/`nickname`은 NULL, `auth_version` 증가(모든 세션 즉시 무효화). 게시글·댓글은 남기고 작성자를 "탈퇴한 회원"으로 표시한다.
  - FK 변경: 필요 없음(RESTRICT 문제가 생기지 않음).
  - 별도로 결정할 것: 개인 데이터 파기 범위(자동차등록증 원본 `vehicle_verifications`는 즉시 파기 권장, 차량·차고 기록·이미지·프로필·방명록·장터 매물·좋아요/북마크), 카카오 연결 끊기(unlink API) 호출.
  - 영향: 재가입 시 같은 아이디/이메일/카카오 계정 재사용 가능 여부 결정 필요. `moderation_logs`의 username·원문 스냅샷 보존 기간 결정 필요.
- **B. 하드 삭제 + 콘텐츠 보존(작성자 익명화)**
  - 방식: `board_posts.author_id`/`board_comments.author_id`를 nullable + `ON DELETE SET NULL`(또는 센티넬 "탈퇴회원" 계정으로 이전)로 바꾼다. `vehicle_verifications.reviewed_by`도 SET NULL.
  - FK 변경: 필요함(Flyway V3 + 이 컬럼들을 읽는 board/Spring 코드의 NULL 처리).
  - 영향: 스키마 의미가 바뀌므로 테스트 범위가 크다. 표시 이름 처리는 A와 같다.
- **C. 하드 삭제 + 콘텐츠 전부 삭제(CASCADE 확대)**
  - 방식: 게시글·댓글 FK도 CASCADE로 바꾼다.
  - 영향: 구현은 가장 단순하다. 대신 내 글에 달린 **타인의 댓글**, 내 차고에 **타인이 남긴 방명록**, 내 글에 대한 신고 기록이 함께 사라진다. 스레드가 끊긴다.

**모든 선택지에 공통으로 필요한 결정**
- 방명록: 내 차고에 타인이 남긴 글 / 내가 타인 차고에 남긴 글을 각각 삭제할지 익명화할지
- 거래 중(`reserved`) 장터 매물 처리
- 처리 대기 중인 신고(내가 한 신고 / 내 글에 대한 신고) 보존 여부
- 관리자 계정 탈퇴 허용 여부(관리자 로그의 `admin_id` 참조)
- 본인 게시글 삭제를 하드 DELETE에서 소프트 삭제로 바꿀지(신고 회피 문제) — 관리자 삭제는 이미 소프트 삭제
- 법적 보존 의무 검토(개인정보 보호법상 지체 없는 파기 원칙). 법률 판단은 이 파일의 범위 밖이며 사용자가 확인한다

**결정 후 구현 STEP에 들어갈 예상 파일**: Flyway `V3__...sql`(B/C 또는 신규 status 값), `AdminMemberController.java`/`AuthController.java`(탈퇴 API), `SharedSessionService.java`(세션 폐기), `board-service/src/community.js`·`market.js`·`admin.js`(탈퇴 회원 표시), `assignment-frontend`(탈퇴 UI), 관련 테스트

**이 STEP에서 하는 일**: 없음(문서 결정만). 사용자 결정을 이 섹션 아래에 "결정: ..."으로 기록한다.

> 위 "선택지" A/B/C는 초안의 번호다. 아래 결정은 2026-09-30 조사 보고의 [결정 1~12] 번호를 따른다(초안 A ≈ 확정안).

**조사 결과 요약 (2026-09-30, 코드·임시 PostgreSQL 실측·Neon 읽기 전용 확인)**
- 운영 Neon의 FK 30개는 V1과 같다. `users` 참조 15개 중 `board_posts.author_id`, `board_comments.author_id`, `vehicle_verifications.reviewed_by`는 NO ACTION이라, 이미 삭제 표시된 글·댓글이 하나라도 있으면 `DELETE FROM users`가 실패한다. 나머지는 CASCADE(방명록 양쪽, 예약중 매물, 본인이 한 신고 포함)이고 `community_reports.reviewed_by`만 SET NULL이다.
- FK 없는 참조: `moderation_logs`(username·원문 스냅샷), `admin_member_actions`, `image_ids` 배열(실측: 이미지가 지워지면 id가 남아 깨진 링크), Neon 전용 `board_test_posts_archive`(`author_id`, `test_username`, 9행).
- 본인 게시글 삭제는 하드 DELETE라서 처리 대기 신고, **타인의 댓글**, 알림이 함께 사라진다(실측). 탈퇴와 관계없이 신고를 회피할 수 있다.
- `/api/board/images/:id`는 로그인 없이 연번 id로 조회된다. 관리자가 삭제한 글의 사진도 행이 남아 계속 보인다.
- 세션: Spring(`SharedSessionService.require`)과 board(`app.js`)가 매 요청마다 DB의 `auth_version`과 상태를 확인한다. `auth_version`을 올리면 모든 기기의 세션이 즉시 무효가 된다.
- 카카오: access token을 저장하지 않고, unlink 호출과 Admin 키도 없다. 화면의 작성자 이름은 `users.username`이다(카카오 가입자는 카카오 닉네임).
- Neon 집계(2026-09-30): 회원 33(관리자 1), `account_status`는 모두 NULL(ACTIVE), 카카오 1, 일반 32 중 **이메일 없음 31**. orphan 참조 0, 삭제 표시 글 0, 매물 0, 이미지 3(모두 참조됨).

**결정 (2026-09-30, 사용자 확정)**
1. 게시글·댓글: 유지한다. 작성자는 "탈퇴한 회원"으로 표시하고, 타인의 댓글과 게시판 문맥을 보존한다.
2. 탈퇴 방식: soft withdrawal. `users` 행은 유지하고 영구 탈퇴 상태(로그인 불가)로 만든다. 개인정보·인증정보는 익명화하거나 제거한다. 관리자가 ACTIVE로 되돌릴 수 없다.
3. 재가입: 일반 탈퇴자는 30일 뒤 같은 이메일·카카오 계정으로 재가입할 수 있다. 정지·제재 상태에서 탈퇴한 사용자는 재가입으로 제재를 우회할 수 없게 별도 처리한다. 원본 이메일·kakao_id는 보관하지 않고, 필요하면 HMAC 등 역산이 어려운 값만 최소한으로 보관한다.
4. 정지 중이거나 처리 대기 신고가 있는 회원도 탈퇴할 수 있다. 신고·제재·운영 기록은 탈퇴와 관계없이 보존한다.
5. 본인 게시글 삭제는 하드 DELETE하지 않는다. 화면에는 "삭제된 글"로 처리하고 댓글·신고·운영 기록은 유지한다(신고 회피 차단).
6. 부품 매물: 판매완료는 유지한다(판매자 "탈퇴한 회원", 연락처 등 개인정보 제거). 판매중은 판매 종료·비공개로 바꾼다. **예약중 매물이 있으면 탈퇴를 막는다**(구매자 모델이 없어 거래 보호 불가, 향후 거래 상대 모델이 생기면 개선).
7. 방명록: 탈퇴자의 차고와 그 차고의 방명록은 삭제한다. 탈퇴자가 다른 회원 차고에 쓴 방명록은 "탈퇴한 회원"으로 유지한다.
8. 차량·번호판·자동차등록증·정비기록·프로필/커버 이미지·차고 전용 이미지는 삭제한다. 공개 게시글에서 실제 사용 중인 이미지는 유지한다. 게시글에 쓰이지 않는 탈퇴 회원 이미지는 삭제하고, `image_ids` orphan 문제를 정리한다.
9. 운영 기록(`moderation_logs` 등)은 탈퇴 즉시 지우지 않고 일정 기간 보존한다. 원문과 기존 username을 영구 보존하지 않는다. 보존기간은 이 STEP에서 정하지 않고 설정값으로 관리한다. 탈퇴 회원의 username과 운영에 꼭 필요하지 않은 직접 식별정보는 가능한 범위에서 익명화한다.
10. 관리자는 관리자 권한을 가진 상태로 탈퇴할 수 없다(먼저 일반 회원으로 강등). 마지막 관리자를 강등해 관리자가 0명이 되는 것도 막는다.
11. 카카오 가입자: kakao_id를 제거·익명화하고, 가능하면 카카오 "연결된 앱" 연결도 해제한다. 실제 secret은 저장소에 넣지 않는다.
12. 즉시 탈퇴(유예 없음). 실행 직전 본인 확인은 필수다. 일반 계정은 현재 비밀번호를 다시 입력하고, 카카오 계정은 카카오 재인증을 거친다. 로그인 세션만으로는 탈퇴할 수 없다.

---

### STEP 10-impl: 회원탈퇴 구현 계획 (A~E, 각각 별도 커밋)

> 위 결정 1~12의 구현이다. **"구현 전 결정 필요" 항목(아래 맨 끝) 중 해당 하위 STEP에 표시된 것은 착수 전에 사용자에게 확인한다.** 각 하위 STEP은 공통 작업 규칙(§5)을 따른다. Neon에는 Flyway 적용(새 core 기동) 외에 쓰지 않는다. Flyway를 적용하기 전에 아래 "Neon 사전 점검"을 읽기 전용으로 다시 확인한다.

**공통 용어·설계**
- 탈퇴 상태: `users.account_status = 'WITHDRAWN'`(최종 상태, 되돌리기 없음) + `users.withdrawn_at`.
- 익명화 결과: `username` → `withdrawn:<id>`(표시용이 아니다. 가입·카카오 닉네임 갱신에서 `withdrawn:` 접두어를 금지해 선점·사칭을 막는다), `password` → 무작위 BCrypt, `email`/`nickname`/`kakao_id` → NULL, `suspended_until`은 유지(내부 기록), `auth_version` + 1.
- 표시: 공개 API는 탈퇴 작성자를 `username: "탈퇴한 회원"`, `authorId: null`, `authorWithdrawn: true`로 내려준다. 같은 탈퇴자의 글끼리 공개 화면에서 연결되지 않게 한다. 관리자 API는 내부 id를 유지한다. 가입 시 username "탈퇴한 회원"도 예약어로 막는다.
- 탈퇴 처리의 소유자는 core(Spring)다. `users`와 본인 확인이 core에 있고, board 테이블은 같은 DB에서 `JdbcTemplate`로 한 트랜잭션 안에서 처리한다.
- 트랜잭션 순서: ① 본인 확인 → ② `users` 행 `FOR UPDATE` + 사전 조건 검사(ADMIN 아님, 이미 탈퇴 아님, 예약중 매물 0) → ③ (카카오) unlink → ④ DB 처리(아래 C-2 순서) → ⑤ 커밋 → ⑥ 현재 세션 Redis 삭제 + 쿠키 제거. ③은 외부 호출이라 ②의 잠금 전에 할지 뒤에 할지는 D에서 확정한다(결정 필요 D-1).

**STEP 10-impl-A: 탈퇴 상태 기반 + 차단 + 관리자 보호** (탈퇴 API 없음, 기존 동작 무변화가 목표)
- Flyway `V3__member_withdrawal_base.sql`
  - `users ADD withdrawn_at TIMESTAMPTZ`. `account_status`에 `CHECK (account_status IS NULL OR account_status IN ('ACTIVE','SUSPENDED','DISABLED','WITHDRAWN'))`. Neon은 모두 NULL이라 안전하지만 적용 전에 다시 확인한다.
  - `board_posts ADD deleted_at TIMESTAMPTZ, ADD deleted_by BIGINT REFERENCES users(id), ADD deleted_reason VARCHAR(10) CHECK (deleted_reason IN ('AUTHOR','ADMIN'))`. 기존 `deleted=true` 행은 `deleted_reason='ADMIN'`으로 백필한다(지금까지 soft delete는 관리자 삭제뿐, Neon 0행).
- Spring
  - `User.isBlocked()`에 WITHDRAWN 포함, `isWithdrawn()` 추가, `withdrawn_at` 매핑(`ddl-auto: validate` 통과).
  - 로그인·카카오 로그인·`SharedSessionService.require`는 `isBlocked` 경유로 자동 차단된다. 카카오는 kakao_id가 NULL이 되므로 기존 계정으로 들어갈 수 없다(새 가입 경로는 C의 재가입 제한이 막는다).
  - `AdminMemberController.update`: 대상이 WITHDRAWN이면 모든 변경 409(복구 불가). `Update.status` 허용 값에 WITHDRAWN을 넣지 않는다. 목록 필터에 WITHDRAWN을 추가한다. `detail`/`list`는 탈퇴 계정의 email 등이 이미 NULL이므로 그대로 둔다.
  - 마지막 관리자 보호: ADMIN 대상을 USER로 바꾸거나 ACTIVE가 아니게 만드는 변경은, 변경 후 "ACTIVE인 ADMIN" 수가 0이면 409. 동시 강등 경쟁을 막으려고 `SELECT ... FROM users WHERE role='ADMIN' FOR UPDATE`로 관리자 행 전체를 잠근 뒤 센다. 기존 "자기 자신 강등 금지"는 유지한다.
  - `/api/auth/signup`, 카카오 신규 가입·닉네임 갱신: `withdrawn:` 접두어와 "탈퇴한 회원" 금지.
- board-service
  - `app.js` 인증: status WITHDRAWN이면 `req.user=null`(auth_version 비교와 이중 방어).
  - 표시: 작성자 JOIN(`community.js` postSelect·댓글·알림·방명록·회원 프로필, `market.js` select, `admin.js` 목록)에 공통 SQL 식 `CASE WHEN u.account_status='WITHDRAWN' THEN '탈퇴한 회원' ELSE u.username END` + `authorId` 숨김을 적용한다(한 곳에 상수로 두고 재사용).
  - 탈퇴 회원 프로필(`/api/board/members/:id`)은 404, 통계 `memberCount`와 관리자 회원 목록 집계는 WITHDRAWN을 제외(관리자 목록은 필터로 조회 가능), 검색(`u.username ILIKE`)은 탈퇴자를 제외한다.
- frontend: 관리자 회원 관리(`assignment-frontend/js/admin.js`)에 WITHDRAWN 표시·필터를 추가하고 탈퇴 계정 편집 폼을 비활성화한다. 게시판·장터는 서버 표시값을 그대로 쓴다(`authorId` null이면 프로필 링크 없음).
- 테스트: `User` 상태 단위 테스트, `AdminMemberController` PATCH(WITHDRAWN 409, 마지막 관리자 409, 동시 강등은 통합 테스트로 한 명만 성공), `AuthControllerTest`(WITHDRAWN 로그인 401과 같은 응답, 카카오 403), 예약어 가입 400, board `session-revocation`·`app.test`(WITHDRAWN 세션 거부), 표시 이름 테스트(목록·상세·댓글·방명록·장터·알림), Flyway V3를 빈 PG16/PG18과 V1+V2 적용 DB 양쪽에 적용.

**STEP 10-impl-B: 본인 글 soft delete + 이미지 공개 범위 + image_ids orphan 방지** (탈퇴와 독립, 결정 5·8)
- 본인 글 삭제(`moderation.js` `deleteContent`): `DELETE` 대신 `UPDATE board_posts SET deleted=true, deleted_at=NOW(), deleted_by=<본인>, deleted_reason='AUTHOR'`. 원문은 DB에 남기되 공개 API에서는 이미 `NOT deleted`로 숨는다. 댓글·신고·좋아요·알림은 그대로 남는다(알림 목록은 이미 `NOT p.deleted`로 거른다).
  - 관리자 신고 목록(`admin.js /reports`)은 삭제된 글의 신고도 계속 보여 주고 삭제 사유(AUTHOR/ADMIN)를 표시한다. 신고 처리 화면에서 관리자가 원문을 볼 수 있게 한다.
  - 본인이 삭제한 글의 원문 보존기간은 E의 보존기간 설정을 따른다(결정 필요 E-1).
  - 본인 댓글 삭제는 이미 soft(내용을 "삭제된 댓글입니다."로 덮어씀)라 바꾸지 않는다. 댓글은 신고 대상이 아니다.
  - 관리자 게시글 수·게시글 목록 집계는 삭제 표시 글을 제외한다(`admin.js` postCount).
- 이미지 공개 범위(`GET /api/board/images/:id`): 아래 중 하나일 때만 200, 아니면 404.
  - 삭제되지 않은 게시글의 `image_ids`에 있음
  - 비공개(closed)가 아닌 매물의 `image_ids`에 있음
  - 탈퇴하지 않은 회원의 프로필 avatar/cover 또는 차량 `image_id`임
  - 요청자가 이미지 소유자(작성 중 미리보기)
  - 관리자(신고 처리)
  - 배열 검색 성능을 위해 Flyway `V4__image_reference_indexes.sql`로 `board_posts.image_ids`, `parts_listings.image_ids`에 GIN 인덱스를 만든다. 응답에 `Cache-Control: no-store`를 유지한다.
- orphan 방지: 이미지 행을 지우는 경로를 공통 함수 하나(`purgeUnreferencedImages(ownerId)`: 위 참조 어디에도 없는 그 회원의 이미지만 삭제)로 모은다. 게시글·매물 조회 시 `image_ids`는 실제 존재하는 이미지와 교집합으로 응답한다(과거 데이터 방어). 관리자 삭제가 `image_ids='{}'`로 비운 사진은 참조가 없어져 공개되지 않는다. 물리 삭제는 E의 정리 작업이나 탈퇴 때 한다. 배열을 연결 테이블(`post_images` + FK)로 바꾸는 것은 이번 범위 밖이다(추가 이슈로 기록).
- 테스트: 본인 글 삭제 후 신고·타인 댓글·알림 행 유지 + 공개 404(`moderation-system.mjs`의 "owner deletes" 기대값 수정), 신고 목록에 AUTHOR 삭제 표시, 이미지 공개 규칙 행렬(게시글 삭제 전후, 관리자 삭제, 비로그인/소유자/관리자, 탈퇴자 프로필), `image_ids` 교집합 응답, V4 적용 테스트.

**STEP 10-impl-C: 일반 계정 탈퇴 + 데이터 처리 + 재가입 제한 + UI**
- Flyway `V5__member_withdrawal_data.sql`
  - `parts_listings`: status CHECK에 `'closed'` 추가, `ADD closed_at TIMESTAMPTZ`. 공개 목록·상세·검색·찜 목록은 `closed`를 제외한다(판매자 본인과 관리자만 조회).
  - `withdrawal_blocks(id BIGSERIAL PK, identifier_type VARCHAR(10) CHECK IN ('EMAIL','KAKAO'), identifier_hmac CHAR(64) NOT NULL, reason VARCHAR(10) CHECK IN ('COOLDOWN','SANCTION'), user_id BIGINT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NULL)`, 인덱스 `(identifier_type, identifier_hmac)`. `expires_at IS NULL`이면 관리자가 해제할 때까지 유지한다.
- 재가입 제한(결정 3·13): HMAC-SHA256(키 = 새 환경변수 `WITHDRAWAL_HMAC_SECRET`, prod 오버레이 `:?` 필수, 32자 이상). 입력은 `email:<정규화 이메일>`(기존 `PasswordResetService.email()` 정규화), `kakao:<kakao id>`. 원문은 저장하지 않는다.
  - COOLDOWN: 모든 탈퇴에 `expires_at = 탈퇴 + 30일`.
  - SANCTION: 탈퇴 시점에 SUSPENDED(미래 종료일)나 DISABLED였으면 추가로 기록한다. 기간은 결정 필요 C-2.
  - 확인 위치: 가입(이메일이 있을 때), 카카오 신규 가입(`createKakaoUser`), 관리자의 이메일 등록·변경. 제한 중이면 409 "탈퇴 후 30일 동안은 같은 정보로 가입할 수 없습니다"(제재 사유는 노출하지 않는다).
  - 만료 행은 E의 정리 작업이 지운다. 키를 교체하면 기존 제한이 무효가 되므로 교체 절차를 문서화한다.
  - **한계**: 이메일 없이 가입한 일반 계정은 식별값이 없어 재가입 제한을 걸 수 없다(Neon 일반 계정 32개 중 31개). → 결정 필요 C-1.
- API: `POST /api/auth/withdraw` `{password, confirm: true}`(JSON, 로그인 필수). 카카오 계정(kakao_id 있음)은 400 "카카오 재인증으로 탈퇴해 주세요"(D에서 구현).
  - 비밀번호 확인은 로그인과 같은 `matches()`(레거시 평문 포함)를 쓴다. 실패는 사용자당 5회/15분 제한(`LoginAttemptLimiter` 패턴, 별도 키 `withdraw-fail:`)과 IP 제한(`RateLimitConfig`에 `/api/auth/withdraw` 추가)으로 막는다. nginx `revcc_auth` 정규식에도 `withdraw`를 추가한다.
  - 사전 조건: ADMIN이면 409 "관리자 권한을 먼저 해제해야 합니다", 예약중 매물이 있으면 409 + 개수, 이미 탈퇴면 401.
- DB 처리 순서(한 트랜잭션, `WithdrawalService`):
  1. `users FOR UPDATE`, 사전 조건 재검사.
  2. `withdrawal_blocks`를 기록한다(원문이 지워지기 전에 HMAC 계산).
  3. 차고: `owner_vehicles` 삭제(CASCADE로 정비기록·자동차등록증·인증 삭제, 게시글 `vehicle_id`는 SET NULL). 탈퇴자 차고의 방명록(`garage_guestbook.owner_id=탈퇴자`) 삭제. `member_profiles` 삭제. 타인 차고에 쓴 방명록은 유지.
  4. 매물: `selling` → `closed` + `closed_at` + `contact=''` + 찜 삭제. `sold` → `contact=''`만 비우고 유지(`region`은 결정 필요 C-3). `reserved`는 1에서 이미 막았다.
  5. 개인 활동: 본인의 좋아요·북마크·찜·받은 알림을 삭제한다(결정 필요 C-4). 본인이 유발한 타인의 알림은 유지(표시만 "탈퇴한 회원"). 본인이 한 신고(`community_reports.user_id`)는 유지(결정 4).
  6. 이미지: 차량이 먼저 지워진 뒤 `purgeUnreferencedImages(탈퇴자)` → 남은 공개 게시글·유지 매물에 쓰인 이미지만 남는다(결정 8, 판매완료 매물 사진 유지 여부는 결정 필요 C-3).
  7. `moderation_logs.target_author_username`(탈퇴자 대상 행) → `탈퇴한 회원#<id>` 익명화(결정 9, id로 내부 추적은 유지).
  8. `users` 익명화(공통 설계) + `withdrawn_at` + `account_status='WITHDRAWN'` + `auth_version+1`.
  9. `admin_member_actions(admin_id=NULL, user_id=탈퇴자, action='SELF_WITHDRAW:<직전상태>')`.
  - 커밋 후 현재 세션 키 삭제와 쿠키 제거. 다른 기기 세션은 `auth_version` 비교로 즉시 무효가 된다. 비밀번호 재설정 토큰은 이메일 NULL·`auth_version` 불일치로 실패하고, Redis 키는 TTL로 사라진다.
- frontend: 내 정보 영역(`assignment-frontend/js/home.js` 또는 해당 설정 화면)에 "회원 탈퇴"를 추가한다. 처리 내용 안내(글·댓글 유지, 차고·등록증 삭제, 30일 재가입 제한), 예약중 매물 안내, 비밀번호 입력과 확인 체크 후 호출, 성공 시 로그아웃 상태로 홈 이동. 카카오 계정에는 "카카오로 다시 인증하고 탈퇴" 버튼(D).
- 테스트: `WithdrawalService` 통합 테스트(실 PostgreSQL, 테이블별 결과를 결정표대로 검증), 비밀번호 오류·제한, ADMIN 409, 예약중 409, 재가입 30일(가입·카카오·관리자 이메일 등록) + 제재 탈퇴, HMAC 원문 미저장(DB에 이메일 문자열 없음), 세션 즉시 무효(Spring·board), 이미지 유지/삭제 행렬, 매물 closed 비공개, 방명록 양방향, 신고·moderation_logs 유지와 익명화, 브라우저 스크립트(탈퇴 흐름).

**STEP 10-impl-D: 카카오 계정 탈퇴 + unlink** (결정 11·12) — ⏸ 2026-10-01 보류: §4 LATER-1에서 최소 구현으로 다시 설계한다. timeout은 NOW-4로 분리했다.
- 카카오 API 조사(2026-09-30, developers.kakao.com):
  - 연결 끊기: `POST https://kapi.kakao.com/v1/user/unlink`. 인증은 두 가지다. 사용자 토큰(`Authorization: Bearer <사용자 access token>`) 또는 Admin 키(`Authorization: KakaoAK <서비스 앱 Admin 키>` + `target_id_type=user_id&target_id=<회원번호>`). 성공 시 200 `{"id": 회원번호}`. 동의를 철회하고 발급된 토큰을 폐기한다.
  - 재인증: 인가 요청에 `prompt=login`을 붙이면 사용자가 카카오 로그인(인증)을 다시 수행해야 한다.
- 설계(**Admin 키 불필요**):
  1. 탈퇴 화면 → `GET /api/auth/kakao/withdraw`(로그인 필수, 카카오 계정만) → 인가 URL에 `prompt=login`을 붙이고, state를 Redis에 `withdraw:<userId>`로 저장(기존 `KakaoStateService` 확장, 5분, 1회 소비).
  2. 같은 콜백(`/api/auth/kakao/callback`, 등록된 Redirect URI를 그대로 사용)에서 state 목적이 withdraw이면 분기한다. 코드 교환으로 **사용자 access token**을 받고 사용자 정보의 id가 세션 사용자 kakao_id와 같은지 확인한다. 세션도 유효해야 하고, 둘 중 하나라도 어긋나면 400.
  3. 사전 조건(ADMIN·예약중 매물) 재검사 → 그 토큰으로 unlink(Bearer) 호출 → C의 탈퇴 트랜잭션 → 쿠키 제거 후 `/?withdrawn=1`로 이동.
  - `KakaoOAuthService.exchange`는 access token을 밖으로 내지 않게 유지하고, 탈퇴 전용 메서드(교환 + 사용자 조회 + unlink)를 추가한다. 토큰은 저장·로그하지 않는다.
- Admin 키를 쓰지 않는 이유와 보안 영향: Admin 키는 임의의 `target_id`로 이 앱의 어떤 사용자든 연결을 끊을 수 있고 다른 관리자 API도 호출할 수 있다. 유출 시 피해 범위가 앱 전체다. 사용자 토큰 방식은 재인증한 본인에게만 동작한다. Admin 키가 필요한 경우는 unlink 실패 재시도, 관리자 주도 정리, 이미 탈퇴한 과거 계정 처리뿐이다. 이번 STEP에서는 도입하지 않는다. 도입한다면 운영 `.env`에만 `KAKAO_ADMIN_KEY`로 두고(저장소·로그·클라이언트 금지), 서버 내부 호출에만 쓰며, 유출 시 카카오 개발자 콘솔에서 재발급한다.
- 카카오 HttpClient timeout(STEP 9 추가 이슈 해결): 연결 5초, 요청 10초. 탈퇴 흐름이 카카오 응답을 기다리므로 이 STEP에 포함한다.
- 테스트: 인가 URL에 `prompt=login`과 state 목적이 포함되는지, state 목적 불일치·재사용·만료, 카카오 id 불일치 400, 세션 없음 401, unlink 요청 헤더(Bearer, Admin 키 미사용), unlink 실패 처리(결정 필요 D-1), timeout 설정, 카카오 로그인 흐름 회귀(prompt 없음).

**STEP 10-impl-E: 운영 기록 보존기간 + FK 없는 참조 + 운영 정리 절차** (결정 9, 요구 14·15) — ⏸ 2026-10-01 보류(현재 규모에서는 오버헤드, §4 "보류")
- 보존기간 설정(값은 사용자 결정, 결정 필요 E-1):
  - `REVCC_MODERATION_RETENTION_DAYS`: `moderation_logs.original_content`와 `target_author_username`/`admin_username` 비우기. 보존 대상은 행과 종류·일시·대상 id·처리 관리자 id·사유다.
  - `REVCC_DELETED_POST_RETENTION_DAYS`: 본인 삭제 글 원문 비우기. 처리 대기 신고가 있는 글은 처리 전까지 보류한다.
  - `REVCC_WITHDRAWAL_BLOCK` 만료 정리.
  - 값이 없으면 prod 오버레이가 기동을 거부한다(`:?`). 영구 보존으로 조용히 흘러가지 않게 하려는 것이다. 로컬 기본값은 테스트용으로 짧게 둔다.
- Flyway `V6__retention_and_references.sql`: `moderation_logs ADD content_purged_at TIMESTAMPTZ`(NOT NULL 컬럼은 빈 문자열로 비움). FK 없는 참조에 FK를 `NOT VALID`로 추가한다: `admin_member_actions.user_id/admin_id`, `moderation_logs.target_author_id/admin_id` → `users(id)`(NO ACTION). 같은 파일에서 `VALIDATE CONSTRAINT`를 한다(Neon orphan 0 확인, 적용 직전 재확인). `users`는 더 이상 하드 삭제하지 않으므로 이 FK가 앞으로의 하드 삭제를 막는 안전장치가 된다. `moderation_logs.target_id`/`post_id`는 게시글·댓글·매물을 가리키는 다형 참조라 FK를 두지 않는다.
- 정리 작업: core의 `@Scheduled`(하루 1회, 한 번에 N행씩, 여러 인스턴스 대비 `pg_try_advisory_lock`)로 위 보존기간을 적용한다. 참조 없는 이미지 중 업로드 후 24시간이 지난 것도 삭제한다(작성 중 업로드 보호).
- Neon `board_test_posts_archive`(요구 14): **Flyway로 건드리지 않는다.** 운영 절차를 `docs/`에 적는다: ① 읽기 전용으로 행 수·기간 확인 → ② 필요하면 사용자가 보관 여부 결정(보관 시 암호화된 곳으로 `pg_dump -t`) → ③ 사용자가 Neon 콘솔에서 직접 `DROP TABLE` → ④ `flyway validate` 영향 없음 확인(Flyway가 모르는 테이블).
- 테스트: 가짜 시계로 보존기간 경계(직전·직후), 처리 대기 신고 글 보류, 설정 누락 시 prod 기동 거부(`docker compose config`), FK NOT VALID→VALIDATE 적용(orphan 있는 DB에서는 실패함을 확인해 사전 점검 필요성 고정), advisory lock 중복 실행 방지.

**migration 순서와 배포 (V3~V6)**
- 하위 STEP마다 Flyway 파일 하나씩. 순서는 V3(A) → V4(B) → V5(C) → V6(E)이고, D는 스키마 변경이 없다. 각 파일은 이전 코드와 호환되게 만든다(컬럼 추가·CHECK 값 추가만, 기존 값 거부 없음). 구 코드가 잠시 함께 돌아도(Mac 등) 깨지지 않게 한다. 구 board는 WITHDRAWN을 모르지만 `auth_version` 불일치로 세션을 거부한다.
- 각 파일 검증: 빈 PG16·PG18에 V1→Vn 적용, V1+V2 상태(현재 Neon 형태)에 Vn만 적용, `ddl-auto: validate` 기동, 재기동 멱등.
- Neon 사전 점검(각 배포 직전, 읽기 전용): `account_status` 값 분포, orphan 참조 0, `board_posts.deleted` 수, 매물 status 분포, `image_ids` 깨진 참조 0. 결과를 작업 이력에 남긴다.

**예상 변경 파일**
- Flyway: `V3__member_withdrawal_base.sql`, `V4__image_reference_indexes.sql`, `V5__member_withdrawal_data.sql`, `V6__retention_and_references.sql`
- Spring: `User.java`, `AuthController.java`, `AdminMemberController.java`, `SharedSessionService.java`(필요 시), `KakaoOAuthService.java`, `KakaoStateService.java`, `RateLimitConfig.java`, 신규 `WithdrawalService.java`·`WithdrawalController.java`(또는 AuthController에 추가)·`WithdrawalBlockService.java`·`RetentionJob.java`, `application.yml`/`application-prod.yml`(HMAC secret, 보존기간, 스케줄링)
- board: `app.js`, `community.js`, `market.js`, `admin.js`, `moderation.js`, `owned-images.js`(또는 신규 `images.js`), 신규 표시 이름 공통 모듈
- frontend: `assignment-frontend/js/admin.js`, `home.js`(또는 내 정보 화면), `auth.js`(예약어 안내), `market.js`/`community-list.js`(`authorId` null 처리)
- 인프라·문서: `nginx/default.conf`(auth zone에 withdraw), `docker-compose.yml`/`docker-compose.prod.yml`(`WITHDRAWAL_HMAC_SECRET`, 보존기간 변수), `.env.example`, `docs/DOCKER-SUBMISSION.md`, 신규 운영 절차 문서
- 테스트: `AuthControllerTest`, `AdminControllerTest`(또는 신규 `AdminMemberControllerTest`), `KakaoOAuthServiceTest`, `KakaoStateServiceTest`, 신규 `WithdrawalServiceTest`/`WithdrawalIntegrationTest`/`RetentionJobTest`, board `app.test.js`·`community.test.js`·`admin-market.test.js`·`session-revocation.test.js` + 신규 `withdrawal-display.test.js`·`images.test.js`, `scripts/moderation-system.mjs`(본인 삭제 기대값), `scripts/community-system.mjs`·`market-system.mjs`(표시·closed), 브라우저 스크립트(`auth-browser.cjs`, `member-browser.cjs`)

**전체 테스트 계획(하위 STEP 공통)**
- `mvn test`(통합 포함, 실 PostgreSQL·Redis), `npm test`, `scripts/run-board-system.sh` 4개, `garage-schema-check.py`(V3~ 적용 확인), `scripts/nginx-forwarded-check.sh`(nginx 변경 시)
- 임시 prod 스택(STEP 9 방식, SSL PostgreSQL로 Neon 대역)에서 e2e: 가입 → 글·댓글·방명록·차량·등록증·매물(판매중/판매완료/예약중) 생성 → 탈퇴 시도(예약중 409) → 예약 해제 후 탈퇴 → 테이블별 결과·공개 화면 표시·이미지 공개 여부·세션 무효·30일 재가입 제한·제재 탈퇴 제한 확인
- Neon에는 Flyway 적용 외에 쓰지 않는다. 사전 점검은 읽기 전용이다.

**구현 전 결정 필요 (해당 하위 STEP 착수 전에 사용자 확인)**
- ~~C-1 (C 전)~~ **결정(2026-10-01): 한계 인정.** 이메일 필수화 없이 있는 식별값(아이디·이메일·카카오 id)만 차단한다. 이메일 없이 가입한 일반 계정(현재 31/32)은 재가입 제한을 걸 식별값이 없다. 제재 중 탈퇴해도 새 아이디로 다시 가입할 수 있다. 선택: 가입 시 이메일 필수화 / 한계 인정(제재 우회 방지는 이메일·카카오 계정에만 적용) / 다른 식별 수단 도입.
- ~~C-2 (C 전)~~ **결정(2026-10-01): 기본안.** 제재 중 탈퇴자의 재가입 제한 기간. 정지(SUSPENDED)는 "정지 종료일과 30일 중 늦은 날까지", 비활성화(DISABLED)는 "관리자가 해제할 때까지"를 기본안으로 제안한다.
- ~~C-3 (C 전)~~ **결정(2026-10-01): 기본안(지역·사진 유지).** 판매완료 매물의 지역(`region`)과 사진을 유지할지. 기본안: 지역은 유지(시·구 수준), 사진은 유지(게시글 사진과 같은 원칙).
- ~~C-4 (C 전)~~ **결정(2026-10-01): 삭제.** 탈퇴자가 남긴 좋아요(다른 사람 글의 좋아요 수가 줄어듦)를 삭제할지 유지할지. 기본안: 삭제(개인 활동 기록).
- ~~C-5 (C 전)~~ **결정(2026-10-01): 기본안(아이디 HMAC 30일, 가입과 같은 원문 비교).** 탈퇴자의 기존 아이디(username)를 다른 사람이 곧바로 쓸 수 있게 할지. 기본안: 30일 동안 같은 아이디 가입 금지(아이디 HMAC을 COOLDOWN에 함께 기록). 사칭 방지 목적이다.
- D-1 (D 전): 카카오 unlink가 실패(카카오 장애·timeout)하면 탈퇴를 중단할지(나중에 다시 시도), 탈퇴는 진행하고 연결만 남길지. 기본안: 중단하고 안내(Admin 키 없이 재시도할 방법이 없으므로).
- E-1 (E 전): 운영 기록 원문·아이디 보존기간, 본인 삭제 글 원문 보존기간(일 수). 법적 판단은 사용자가 확인한다.

---

### STEP 11: 비밀번호 재설정 계정 열거 (P2-1) — ⏸ 2026-10-01 보류: 작은 응답 통일은 §4 LATER-2

**작업 목적**: 비밀번호 재설정 요청이 "없는 아이디 / 이메일 불일치 / 카카오 계정"을 서로 다른 코드로 알려 준다. 그래서 특정 아이디에 어떤 이메일이 연결돼 있는지 확인할 수 있다.

**현재 구현 상태 (2026-09-30 코드 확인)**
- `PasswordResetService.request()`가 `USERNAME_NOT_FOUND`/`IDENTITY_MISMATCH`/`SOCIAL_ACCOUNT`(모두 400)를 구분해서 반환한다. `PasswordResetRequestTest.java`가 이 동작을 의도된 것으로 고정하고 있다. `assignment-frontend/js/password-reset.js:8`이 이 코드들로 안내 문구를 분기한다.
- 메일 발송은 요청 스레드에서 동기로 실행되고(SMTP 타임아웃 5초), 실패하면 `MAIL_UNAVAILABLE`(503)을 반환한다. **아이디와 이메일이 맞을 때만 발생하므로** 이것도 계정 확인 신호가 되고, 응답 시간 차이도 신호가 된다.
- 제한: IP당 20회/시간(`getRemoteAddr()` 기반이라 STEP 5-A 전에는 위조 가능), 이메일당 5회/시간(**입력한 이메일 기준**이라 이메일을 바꿔 가며 같은 아이디를 시험하는 것은 막지 못함).
- **아이디 존재 여부 자체는 이미 공개 정보다**: `/api/auth/check-username`(가입 화면의 아이디 확인)이 존재 여부를 알려 주고, 게시글 작성자 이름도 공개된다. 따라서 이 STEP에서 실질적으로 보호할 대상은 "아이디 ↔ 이메일 연결(개인정보)"이다.

**작업 시작 전 사용자 결정**
- **A. 현행 유지**: UX 우선. 위험을 수용했다고 문서에 기록하고, STEP 5의 제한 강화로 완화한다. 코드 변경 없음.
- **B. 요청 응답 통일(권장)**: 없는 아이디, 불일치, 카카오 계정, 정상 모두 같은 `CODE_SENT` 응답("입력한 정보가 맞으면 인증번호를 보냈습니다")을 반환한다. 메일은 정상인 경우에만 보낸다(카카오 계정이면 "카카오 로그인을 이용하세요" 안내 메일로 대체할 수 있음). 메일 발송을 비동기로 바꾸거나 응답 시간을 맞춰 타이밍 차이를 줄인다. `MAIL_UNAVAILABLE`은 사용자에게 드러내지 않고 서버 로그/지표로만 남긴다.
- **C. B + 아이디 확인 API 강화**: `check-username`에 추가 방어(CAPTCHA 등)까지 넣는다. 범위가 크고 효과가 작아서 비권장.

**관련 파일 (B안 기준)**
- `backend/src/main/java/com/revcc/app/PasswordResetService.java`, `PasswordResetController.java`, `ResetMailService.java`(비동기 발송 시), `backend/src/test/java/com/revcc/app/PasswordResetRequestTest.java`, `PasswordResetServiceTest.java`(통합), `assignment-frontend/js/password-reset.js`, `assignment-frontend/auth/reset.html`(안내 문구), `docs/member-management-password-reset.md`, `docs/smtp-e2e-checklist.md`

**구현 요구사항 (B안 기준)**
1. `request()`의 실패 분기 3개와 메일 실패를 모두 같은 성공 응답으로 바꾼다. 쿨다운/제한(429)은 모든 경우에 똑같이 적용되게 해서 429 여부로도 구분할 수 없게 한다.
2. 타이밍: 메일 발송을 요청 경로에서 분리한다(`@Async` 또는 큐). 이때 실패 로깅은 기존 `SafeMailFailure` 화이트리스트 방식을 유지한다.
3. 인증번호 검증(`verify`)과 재설정 완료(`complete`) 흐름은 변경하지 않는다.
4. 프론트 안내 문구를 통일된 응답에 맞춘다.

**건드리지 말아야 할 영역**
- 인증번호 생성·저장·검증 로직, 재설정 후 세션 무효화(`authVersion`)
- 로그인 응답(이미 통일돼 있음), `check-username`(C안 선택 시에만)
- 제한 수치 자체(STEP 5에서 결정된 값 유지)

**완료 조건**
- 없는 아이디 / 불일치 / 카카오 계정 / 정상 요청의 HTTP 상태와 본문이 같다(테스트로 고정)
- 정상 요청만 메일 발송이 호출된다
- 메일 서버 장애가 응답에 드러나지 않는다
- 응답 시간이 메일 발송 시간에 좌우되지 않는다(비동기화 확인)

**실행해야 할 테스트**
- `cd backend && mvn test`(통합 포함). `PasswordResetRequestTest`의 기존 "구분 응답" 테스트를 "통일 응답" 테스트로 교체하는 것은 이 STEP의 의도된 변경이다
- `cd board-service && npm test`(회귀 확인용)
- `docs/smtp-e2e-checklist.md` 절차로 실제 메일 발송 확인(사용자 SMTP 설정 필요, 선택)

---

## 5. 공통 작업 규칙

모든 STEP에 공통으로 적용된다.

1. 작업 시작 전 `git status`로 현재 상태 확인 — 이전 세션이 남긴 미커밋 변경이 있으면 먼저 사용자에게 확인하거나 별도로 처리, 임의로 버리지 않는다.
2. `docker-assignment` 브랜치에서만 작업한다. 다른 브랜치로 전환하거나 새 브랜치를 만들지 않는다.
3. 기존에 정상 동작하는 기능을 임의로 리팩터링하지 않는다. 해당 STEP의 구현 요구사항에 명시된 범위만 수정한다.
4. 작업 중 STEP 범위 밖의 문제를 발견해도 임의로 고치지 않는다 — 이 파일의 "발견된 추가 이슈" 섹션(아래, 없으면 새로 만들어 추가)에 기록만 한다.
5. `.env`, API key, token, password 등 민감정보를 절대 커밋하지 않는다. `git add` 전 `git status`/`git diff`로 반드시 확인한다.
6. 작업 완료 후 **변경과 직접 관련된 테스트만** 실행한다. 범위는 아래 "작업 및 검증 경량화 원칙"을 따른다(2026-10-01 개정: 이전의 "매번 `mvn test`·`npm test` 전체 + 변경하지 않은 쪽도 함께 실행" 규칙을 대체한다). 전체 테스트는 GitHub Actions가 수행한다.
7. 테스트가 실패하면 원인을 해결하기 전에는 commit도 push도 하지 않는다. 원인이 이번 변경 때문인지, 기존부터 있던 문제인지 먼저 구분한다.
8. commit 전 `git diff`로 변경사항을 최종 검토한다.
9. 문제가 없으면 **해당 STEP에서 변경한 파일만** commit한다(다른 STEP이나 무관한 파일을 같이 묶지 않는다).
10. `origin/docker-assignment`로 push한다.
11. 이 파일(`REVCC_NEXT_TASKS.md`)의 "다음 작업 순서" 표에서 완료한 STEP을 `[x]`로 갱신하고, 아래 "작업 이력" 섹션에 결과와 commit hash를 기록한 뒤, 이 갱신 자체도 같은 commit(또는 바로 다음의 문서 전용 commit)에 포함해 push한다.
12. `REVCC_AUDIT.md`는 절대 수정하지 않는다(감사 원본 보존).

### 작업 및 검증 경량화 원칙 (2026-10-01, STEP 10-impl-C 이후 모든 작업에 적용)

기본 원칙은 **"변경 범위에 비례한 최소 구현 + 최소 검증"**이다. REV.CC는 PostgreSQL·Flyway·Docker 호환성을 시험하는 프로젝트가 아니라 실제 자동차 커뮤니티 서비스를 만드는 프로젝트다. 테스트와 검증은 서비스 개발을 돕는 수단이며, 개발 작업보다 커지면 안 된다. 기존 테스트 자산(단위·통합·system·browser 스크립트, V1~V5 migration)은 그대로 보존한다. 줄이는 것은 "매번 실행하는 범위"와 "새 테스트를 추가하는 기준"뿐이다.

**일반 작업: 로컬 기본 검증**
1. 변경 기능과 직접 관련된 단위·통합 테스트
2. 변경한 API의 핵심 정상 동작 확인
3. DB 변경이 있으면 현재 최신 schema에 신규 migration 적용 확인
4. diff 확인

여기까지 통과하면 로컬 검증을 끝낸다. 명확한 이유 없이 아래를 매 작업마다 반복하지 않는다.
- 전체 Maven test, 전체 npm test
- 전체 Docker Compose E2E, 모든 system·manual 테스트 스크립트, 브라우저 E2E
- PostgreSQL 16/18 등 여러 DB 버전 반복 검증
- 빈 DB에서 V1부터 최신까지 Flyway 전체 적용, checksum·재기동·up-to-date 반복 검증
- 대량 fixture 생성, 같은 기능을 여러 계층에서 중복 검증
- 가능성이 매우 낮은 edge case 테스트 대량 추가, 반복적인 race condition stress test
- 일회성 검증을 위한 새 테스트 인프라·스크립트 구축

"안전을 위해", "혹시 모르니", "완전성을 위해"라는 이유만으로 검증 범위를 넓히지 않는다.

**Flyway**
- 기존 V1~V5는 절대 수정하거나 합치지 않는다. schema 변경은 V6, V7처럼 새 migration으로 추가한다.
- 로컬 기본 검증은 "현재 최신 schema → 신규 migration 적용 → 변경 기능 테스트"까지다. migration을 추가할 때마다 PG16·PG18을 각각 띄워 같은 검증을 반복하지 않는다.
- 빈 DB 전체 적용, 여러 PostgreSQL 버전, checksum·재기동 검증은 DB 호환성이나 migration 자체가 이번 작업의 핵심 위험일 때만 한다.

**고위험 작업**
- 인증·인가, 세션, 회원탈퇴·데이터 삭제, 관리자 권한, DB migration, 데이터 유실, 동시성, 운영 인프라처럼 위험이 큰 변경은 필요한 검증을 추가할 수 있다.
- 하지만 "고위험"이라는 이유만으로 전체 회귀를 자동 실행하지 않는다. 실제로 일어날 수 있는 위험을 먼저 판단하고, 그 위험을 검증하는 최소 범위만 테스트한다.

**CI**
- 로컬은 빠른 관련 테스트에 집중한다. GitHub Actions가 전체 테스트를 수행하므로 같은 전체 테스트를 로컬에서 다시 돌리지 않는다.
- 순서: 로컬 관련 테스트 통과 → diff 확인 → commit → push → GitHub Actions 확인.
- CI가 성공한 뒤 추가 테스트나 분석을 새로 시작하지 않는다.

**전체 회귀·E2E**
- 매 STEP마다 하지 않는다. P2 같은 큰 작업 묶음 완료, main merge 직전, production 배포 직전에만 종합적으로 수행한다.

**새 테스트 추가 기준**
- 다음 중 하나의 명확한 가치가 있을 때만 추가한다: 핵심 비즈니스 규칙 보호, 실제 발견된 버그의 재발 방지, 중요한 보안 경계 검증, 실제 데이터 유실 방지.
- 테스트 개수를 품질로 보지 않는다. 기존 테스트가 이미 보장하는 동작을 새 E2E·system·browser 테스트로 다시 검증하지 않는다.
- 가벼운 기능 변경 때문에 테스트 코드나 검증 스크립트가 실제 구현보다 커지지 않게 한다.

STEP 10-impl-C에서 수행한 검증(PG16·PG18 각각 전체 Maven, Flyway 반복 검증, 전체 Node, 다수 system test, 브라우저 E2E, 동시성 반복 검증)은 그 STEP 한정이었다. 앞으로 모든 기능의 기본 검증 방식으로 쓰지 않는다.

### 발견된 추가 이슈 (STEP 범위 밖에서 발견된 것들 — 기록만, 수정 금지)

_(작업 중 발견하면 여기에 "STEP 번호 — 파일:설명" 형식으로 추가할 것.)_

- STEP 1 — `frontend/components/garage/garage-session.tsx`: Next.js "My Garage" 프로토타입 가입 폼에는 8자 최소 길이 클라이언트 검증이 없다(서버가 400으로 거부하지만 안내 문구가 없음). 기본 compose 미포함 프로토타입이라 수정하지 않음.
- STEP 1 — 테스트 환경: Windows 개발 PC에는 Java/Maven/Node가 설치되어 있지 않아 `maven:3.9.9-eclipse-temurin-23`, `node:22-alpine` 컨테이너로 테스트를 실행했다(Dockerfile과 같은 버전). STEP 3 CI에서도 같은 버전을 쓰면 된다.
- STEP 2 — `board-service/src/schema.sql`: `moderation_logs.action_type` CHECK 제약에 `LISTING_DELETE`를 추가했다(기존 DB는 board-service 기동 시 1회 교체, 임시 PostgreSQL에서 기존 로그 보존·재적용 무변화·잘못된 값 거부 확인). 공유 Neon DB에는 board-service가 새 코드로 처음 재기동될 때 적용된다. 이전 코드와도 호환된다(허용 값만 늘어남).
- STEP 2 — `assignment-frontend/js/admin.js` 운영 로그 탭: 매물 삭제 로그의 카테고리는 부품 카테고리 키(`brakes` 등)가 그대로 표시된다(커뮤니티 카테고리 이름표만 있음). 기능 영향 없음, 표시 개선만 필요.
- STEP 2 — `board-service/src/market.js`: 관리자 매물 삭제는 소프트 삭제가 아니라 실제 삭제다(관심 목록은 CASCADE로 함께 삭제). 원문(제목·설명·판매자)은 `moderation_logs`에 스냅샷으로 남는다. 이미지(`image_ids`)는 로그에 남지 않는다.
- STEP 4 — 스키마 소유 주체는 감사 기록의 3곳이 아니라 4곳이었다: `VehicleRepository`의 `@PostConstruct`도 `vehicles` 테이블을 만들고 시드 데이터를 넣고 있었다. 이번에 V1으로 옮겼다.
- STEP 4 — 스키마가 기동 순서에 따라 달라지고 있었다: 빈 DB에서는 core(Hibernate)가 먼저 `owner_vehicles`/`vehicle_verifications`를 identity 컬럼, 기본값 없음, year CHECK 없음으로 만들었고, Neon은 board `schema.sql`이 먼저 만든 형태(SERIAL, 기본값, CHECK)였다. V1은 Neon 형태를 기준으로 삼았다. 이전 코드로 만든 로컬 볼륨은 Hibernate 형태로 남지만 baseline과 validate는 통과한다(임시 DB에서 확인).
- STEP 4 — Neon에만 있는 `board_test_posts_archive` 테이블: 코드에서 쓰지 않으므로 V1에 넣지 않았고 건드리지도 않았다. 필요 없으면 수동으로 정리할 대상이다.
- STEP 4 — `users.email`에 unique 제약(`uk6dotkott...`, Hibernate)과 unique 인덱스(`users_email_unique`, 과거 수동 마이그레이션)가 중복돼 있다. 운영 DB와 맞추려고 V1에 그대로 두었다. 정리하려면 새 마이그레이션으로 처리한다.
- STEP 4 — Neon은 PostgreSQL 18.6인데 로컬 compose와 CI는 postgres:16이다. Spring Boot 3.5.0이 쓰는 Flyway는 PG18에서 "지원 미검증" 경고를 낸다(PG18 임시 DB에서 V1·V2 적용, baseline, 재기동 모두 정상 확인). CI와 compose를 18로 올릴지는 별도로 판단할 사항이다.
- STEP 4 — Neon 반영 시점: 새 core가 Neon에 처음 기동할 때 baseline(V1)을 기록하고 V2(`LISTING_DELETE` CHECK)를 적용한다. Neon은 아직 STEP 2 제약이 반영되지 않은 상태였다(덤프로 확인). 이전 코드(Mac 등)와도 호환된다. 이전 board `schema.sql`은 멱등하고, 이전 Hibernate update는 추가할 컬럼이 없다. 이 세션에서는 Neon에 쓰기를 하지 않았다(읽기 전용 스키마 덤프만 실행).
- ~~STEP 5~11 계획 중 발견(2026-09-30) — **STEP 4 회귀**: `scripts/admin-system.mjs`, `community-system.mjs`, `market-system.mjs`, `moderation-system.mjs`, `garage-schema-check.py`가 STEP 4에서 삭제한 `board-service/src/schema.sql`을 직접 읽거나 JPA의 스키마 자동 생성을 전제로 한다. 지금은 실행되지 않는다.~~ → **STEP 4 후속 수정 완료(2026-09-30, 작업 이력의 "STEP 4 follow-up" 참고)**. `.mjs` 4개는 공통 helper `scripts/lib/flyway-migrations.mjs`로 Flyway `V*.sql`을 버전 순서대로 격리 스키마에 적용하고, 실행기 `scripts/run-board-system.sh`가 만든 임시 PostgreSQL에서만 돈다(`REVCC_SYSTEM_TEST_DB=isolated`가 없으면 실행 거부 → Neon에 연결된 board 컨테이너에서는 돌지 않음). `garage-schema-check.py`는 compose 대신 임시 네트워크·postgres·redis와 현재 소스로 빌드한 core/board를 쓰고, core의 Flyway가 빈 스키마에 V1→V2를 적용하는지까지 확인한다. 없어진 `schema.sql` "두 번 적용 멱등성" 검사는 대상이 사라져 Flyway 적용 확인으로 대체했다.
- STEP 4 follow-up 중 발견 — `scripts/admin-system.mjs`는 같은 사용자로 API를 통해 게시글 23개를 연속 작성한다. 2026-09-28 커밋 `098518e`가 추가한 글 작성 rate limit(10/분)에 걸려 11번째 글에서 429로 실패한다. 스크립트 마지막 수정(2026-09-22)이 rate limit 도입보다 앞서므로 **STEP 4와 무관한 기존 문제**다. 10개마다 61초 대기만 넣은 사본으로 실행하면 전체 검증이 통과함을 확인했다(저장소 파일은 수정하지 않음). → **STEP 5-B에서 해결 완료**: 작성자를 10개씩 나눠(a 10, b 10, c 3) rate limit을 끄거나 대기하지 않고 23개를 만든다. 1번 글은 일반 회원 글로 유지해 "관리자도 남의 글 수정 불가" 검사 의미를 보존했다. 4개 스크립트 전체가 대기 없이 약 8초에 PASS.
- STEP 5~11 계획 중 발견 — `docker-compose.prod.yml`이 core의 `POSTGRES_PASSWORD`와 board의 `PGPASSWORD`를 로컬 postgres 변수 `${POSTGRES_PASSWORD}`로 덮어쓴다. 기본 compose는 Neon 접속에 `DB_PASSWORD`를 쓰므로 두 값이 다르면 prod 오버레이 기동이 실패한다. STEP 7-A 범위에 포함시켰다.
- STEP 5~11 계획 중 발견 — board 차고 쓰기 엔드포인트(`POST /api/board/garage`, `PUT /api/board/garage/:id`, `POST /api/board/garage/:id/records`)와 장터 수정(`PUT /api/parts/listings/:id`)에도 rate limit이 없다. P2-4 원래 범위 밖이라 STEP 5에 넣지 않았다. 필요하면 5-B에 추가한다.
- STEP 5~11 계획 중 발견 — Spring이 저장하는 자유 텍스트(차고 차량 `nickname`/`description` 등 `GarageVehicleRequest` 필드, 관리자가 수정하는 `users.nickname`)도 서버측 정리가 없다. STEP 6은 board-service만 다룬다.
- STEP 5~11 계획 중 발견 — core와 board가 Neon에 같은 DB 사용자(`DB_USER`)로 접속한다. 이 사용자는 Flyway DDL 권한까지 가진다. 앱용/마이그레이션용 역할 분리(최소 권한)는 어느 STEP에도 포함되지 않았다.
- STEP 5~11 계획 중 발견 — Docker는 healthcheck가 unhealthy여도 컨테이너를 재시작하지 않는다. STEP 8의 restart 정책은 프로세스 종료만 복구한다. hang 상태 복구가 필요하면 별도 감시가 필요하다.
- STEP 10 — `board_posts.image_ids`/`parts_listings.image_ids`는 배열이라 FK를 둘 수 없다. STEP 10-impl-B는 공개 범위 검사와 공통 삭제 함수로 orphan을 막는 데까지만 한다. 연결 테이블(`post_images` + FK)로 바꾸는 것은 별도 작업이다.
- STEP 10 — 비밀번호 재설정 요청은 아이디→이메일 순서로 검사하며 결과별로 다른 코드를 준다(`USERNAME_NOT_FOUND`/`IDENTITY_MISMATCH`/`SOCIAL_ACCOUNT`). 탈퇴 계정도 이 경로를 탄다(아이디가 바뀌어 NOT_FOUND). 열거 문제는 STEP 11 범위다.
- STEP 10 — 회원가입 username에는 길이 제한만 있고 문자 제한이 없다. 그래서 "탈퇴한 회원"이나 관리자처럼 보이는 이름으로 가입할 수 있다. STEP 10-impl-A는 탈퇴 관련 예약어만 막는다.
- STEP 10-impl-A — **Neon 반영 전 확인**: V3는 아직 Neon에 적용되지 않았다. 새 core가 Neon에 처음 기동할 때 적용된다. `users_account_status_check`는 기존 값이 허용 목록 밖이면 적용에 실패한다. 기동 전에 읽기 전용으로 `SELECT DISTINCT account_status FROM users`를 다시 확인한다(2026-09-30에는 전부 NULL). 이전 코드(Mac 등)는 새 컬럼을 모르지만, 컬럼 추가뿐이라 함께 떠 있어도 깨지지 않는다.
- STEP 10-impl-B — **이미지 물리 삭제(`purgeUnreferencedImages`)는 만들지 않았다**. 지금 이미지 행을 지우는 코드 경로가 없어(회원 삭제 cascade뿐) 모을 대상이 없고, 호출할 곳은 C(탈퇴)와 E(정리)다. 만들 때 조건: ① 작성자가 삭제한 글도 원문 보존 대상이므로 `deleted` 글의 image_ids도 "참조"로 센다(공개 규칙 `image-references.js`와 다르다). ② 방금 올리고 아직 글에 붙이지 않은 사진(작성 중)을 지우지 않도록 생성 후 경과 시간 조건을 둔다. ③ `owner_vehicles.image_id`는 `ON DELETE` 없는 FK라 참조 중인 사진은 DB가 삭제를 거부한다.
- STEP 10-impl-B — 미첨부·삭제 글 전용 사진은 이제 공개되지 않지만 행은 계속 쌓인다. 작성자가 지운 글의 원문·사진도 무기한 남는다. 보존기간과 정리는 E(결정 E-1)에서 한다.
- STEP 10-impl-B — **혼합 배포 주의**: 새 board가 배포되기 전까지 이전 board(Mac 등)는 본인 글을 계속 hard delete하고 모든 사진을 공개한다. V4는 인덱스 추가뿐이라 이전 코드와 함께 떠 있어도 안전하다. Neon에는 V3·V4가 함께 적용된다(V3 확인 사항은 위 항목).
- STEP 10-impl-B — 작성자 본인 삭제는 moderation_logs를 남기지 않는다(관리자 조치 기록이므로). 본인 삭제의 흔적은 `board_posts.deleted_at/deleted_by/deleted_reason`에만 있다.
- STEP 10-impl-C — **legacy 이메일 없는 계정의 한계(C-1)**: Neon 일반 계정 33개 중 이메일이 있는 계정은 1개다. 나머지는 탈퇴해도 아이디 HMAC만 남아, 새 아이디로 다시 가입하는 것을 막을 수 없다(제재 회피 포함). 이메일 필수화 등은 별도 결정이 필요하다.
- STEP 10-impl-C — **정지·비활성화 회원은 탈퇴할 수 없다**: 탈퇴는 로그인이 필요한데, 정지(SUSPENDED)·비활성화(DISABLED) 회원은 로그인·세션이 거부된다. "제재 중이라는 이유만으로 탈퇴를 막지 않는다"는 정책을 지금은 API로 지킬 수 없다. SANCTION 기록 로직(종료일과 30일 중 늦은 날, 무기한)은 구현·테스트했지만, API 경로에서는 세션 확인과 잠금 사이에 제재된 경우만 도달한다. 제재 회원용 탈퇴 경로(예: 아이디+비밀번호로 본인 확인하는 별도 요청)는 인증 없는 경로가 생기는 문제라 결정이 필요하다.
- STEP 10-impl-C — 무기한 SANCTION(`expires_at IS NULL`)을 해제하는 관리자 화면·API가 없다. 지금은 운영자가 DB 행을 직접 지워야 하고 기록도 남지 않는다(`docs/member-withdrawal.md`).
- STEP 10-impl-C — 탈퇴 트랜잭션이 회원 행을 잠근 동안 같은 회원이 board에서 새 매물을 등록하면, 그 INSERT는 FK 잠금 때문에 기다렸다가 탈퇴 커밋 뒤 판매중 상태로 들어간다. 판매자는 impl-A 규칙으로 "탈퇴한 회원"으로 보이고 연락처도 공개되지 않지만, 매물은 공개 목록에 남는다. 요청이 겹칠 때만 생기는 좁은 경쟁이다. 새 게시글도 같은 방식으로 들어가며, 이것은 "탈퇴한 회원" 글로 남는다.
- STEP 10-impl-C — `WITHDRAWAL_HMAC_SECRET`이 없는 로컬 환경(기본 compose)을 운영 DB(Neon)에 붙이면, 운영에서 누군가 탈퇴해 제한 행이 생긴 뒤에는 로컬 가입이 503이 된다(제한을 조용히 건너뛰지 않도록 한 설계). 로컬도 같은 키를 쓰거나 격리 DB를 쓴다.
- STEP 10-impl-C — `withdrawal_blocks.user_id`는 탈퇴 회원을 가리킨다. 만료 행 정리와 함께 E에서 다룬다(원문이 없어 개인정보는 아니지만 회원과 연결된다).
- STEP 10-impl-C — 탈퇴한 판매자의 닫힌 매물(`closed`)과 판매완료 매물 행, 작성자 삭제 글의 원문·사진은 무기한 남는다. 보존기간은 E-1.
- STEP 10-impl-C → **D 전에 알아야 할 것**: ① `WithdrawalService.withdraw`는 `user.getKakaoId()!=null`이면 `KAKAO_REAUTH_REQUIRED`로 거부한다. D는 카카오 재인증 결과로 이 검사를 대체하되, 비밀번호 확인과 같은 수준의 "방금 본인 확인" 증거(재인증 state·짧은 유효시간)를 서비스에 넘겨야 한다. ② 재가입 제한은 이미 KAKAO 식별자를 기록·검사한다(`kakao:<id>`, 콜백의 신규 가입에서 409). ③ unlink 호출(외부 HTTP)을 DB 트랜잭션 안에서 할지(D-1)는 이 서비스의 잠금 시간과 직결된다. ④ `KakaoOAuthService`의 HttpClient timeout 부재(STEP 9 이슈)도 D에서 함께 다룬다. ⑤ 프론트는 `method==="KAKAO"`일 때 안내만 보여 준다. D에서 재인증 버튼으로 바꾼다.
- STEP 10-impl-B — 이미지 공개 판정의 `member_profiles.avatar_image_id/cover_image_id`, `owner_vehicles.image_id` 조회에는 인덱스가 없다(계획은 image_ids GIN만). 지금은 행 수가 적어 문제없지만 커지면 추가를 검토한다.
- STEP 9 — **실제 Named Tunnel에서 아직 확인하지 않은 것**: TryCloudflare Quick Tunnel로만 실측했다(경로에 `cf-worker: trycloudflare.com`이 있다). 자체 zone(rev.cc)에서 클라이언트가 CF-Connecting-IP를 보냈을 때 엣지가 거부(1000)하는지 덮어쓰는지, 헤더 구성이 같은지는 운영 tunnel 생성 후 확인해야 한다. 어느 쪽이든 origin에는 Cloudflare가 만든 값만 도착한다. 운영 배포 후 `docker compose ... logs proxy`의 첫 칸이 실제 사용자 IP인지, `curl -sI https://rev.cc/`에 HSTS가 있는지 확인한다.
- STEP 9 — `tunnel` 네트워크 대역 172.16.238.0/28(Docker 기본 주소 풀 밖)이 운영 서버의 호스트·VPC 네트워크와 겹치면 기동이 실패하거나 라우팅이 꼬인다. 바꿀 때는 `nginx/default.conf`(set_real_ip_from, HSTS map), `docker-compose.prod.yml`(ipv4_address, subnet), `scripts/nginx-forwarded-check.sh`를 함께 바꾼다(스크립트가 세 값을 대조한다). 같은 이유로 이 스크립트는 운영 스택이 떠 있는 호스트에서 실행하지 않는다.
- STEP 9 — X-Forwarded-Proto는 여전히 어느 발신지에서 와도 core/board로 전달된다(P0-2 로직, 이번 범위에서 변경 금지). 운영에서는 proxy에 닿는 것이 cloudflared뿐이고 Cloudflare가 값을 덮어쓰므로 안전하다. 로컬 과제 구성에서는 클라이언트가 `https`라고 속일 수 있다(자기 요청에만 영향). HSTS는 이 값만으로 판단하지 않고 cloudflared 발신지를 함께 확인한다.
- STEP 9 — `KakaoOAuthService`의 `HttpClient.newHttpClient()`에 연결·요청 timeout이 없다. 카카오 API가 멈추면 사용자는 nginx 504(30초)를 받지만 core의 요청 스레드는 계속 기다린다. 앱 timeout 추가는 이번 범위 밖이다.
- STEP 9 — nginx realip는 CF-Connecting-IP가 쉼표 목록이면 마지막 값을 쓴다. Cloudflare는 단일 값만 만들고 클라이언트 값은 엣지에서 거부하므로 운영에서는 해당 없다(테스트로 동작만 고정했다). IP가 아닌 값이면 cloudflared 주소로 남아 모두 한 버킷이 된다(안전한 쪽으로 실패).
- STEP 9 — 신뢰 경계는 "172.16.238.2에서 온 TCP 연결"이다. 이 주소를 쓰려면 호스트나 Docker 권한이 필요하다. Linux 호스트의 root는 컨테이너 IP로 proxy에 직접 닿을 수 있으므로 호스트 자체는 신뢰 범위다. `TUNNEL_TOKEN`은 다른 비밀값처럼 `docker inspect`로 보인다.
- STEP 9 — 로컬 과제 구성에서는 Docker 포트 매핑 때문에 모든 브라우저가 게이트웨이 IP 하나로 보이고(5-A 기록과 같음) nginx rate limit 버킷도 공유한다. 과제 시연에서 한 PC로 1분에 로그인·가입 등을 30회 넘게(순간 30) 하거나 API를 초당 20회 넘게(순간 200) 보내면 nginx 429가 날 수 있다. `docker-compose.garage.yml`의 Next.js garage-ui는 서버에서 proxy를 호출하므로 모든 사용자가 garage-ui 컨테이너 IP 하나로 묶인다(로컬 전용 프로토타입).
- STEP 9 — `scripts/nginx-forwarded-check.sh`는 여전히 수동 검사다(CI에 넣지 않음, 5-A 기록과 같음). `cloudflared` 이미지는 2026.9.3으로 고정했다(자동 업데이트 없음). 보안 업데이트는 태그를 바꿔 재배포한다.
- STEP 9 — **운영 배포 후 후속 검증 항목**(Kakao HttpClient timeout 부재는 위 항목에 별도 기록):
  1. 실제 Named Tunnel(rev.cc) 경유로 IP spoofing을 다시 확인한다. `X-Forwarded-For`·`Forwarded`·`True-Client-IP`를 요청마다 바꿔도 Spring 로그인 IP 제한은 10회, board 조회수 제한은 60회 뒤에 429가 나야 한다. 위조한 `CF-Connecting-IP`는 엣지가 거부하거나 덮어써야 하고, proxy 로그의 첫 칸은 실제 사용자 IP여야 한다. STEP 9 e2e(Quick Tunnel)와 같은 절차로 확인한다.
  2. `docker inspect`로 cloudflared가 `tunnel` 네트워크에서 172.16.238.2를 쓰는지 확인한다. 최초 기동, `docker compose up -d` 재생성, 호스트 재부팅 뒤에 각각 확인한다. 주소가 다르면 실제 IP 복원과 HSTS가 조용히 꺼진다(모든 사용자가 cloudflared 주소 bucket 하나를 공유). 운영 서버의 `ip route`·VPC 대역이 172.16.238.0/28과 겹치지 않는지도 확인한다.
  3. `scripts/nginx-forwarded-check.sh`를 GitHub Actions에 넣을지 검토한다. 이 스크립트는 Docker와 고정 대역 네트워크(172.16.238.0/28)만 있으면 되므로 ubuntu 러너에서 실행할 수 있을 것으로 보이지만 확인하지 않았다. 넣으면 nginx 설정 회귀(신뢰 주소 불일치, 전달 헤더 제거 누락, rate limit·HSTS 조건 변경)를 자동으로 막을 수 있다.
- STEP 9 — HSTS 확대(`max-age` 604800 → 2592000, `includeSubDomains`, `preload`)는 사용자 결정 사항이다. `preload`는 되돌리기 어렵다.
- STEP 8 — core는 DB가 멈췄을 때 board보다 늦게 503이 된다(단건 약 10초, 쿼리 진행 중이면 최대 약 20초). Hikari가 오래 쉰 연결을 빌려줄 때 유효성 검사(`validation-timeout` 기본 5초)를 먼저 하고, 실패하면 새 연결을 기다리기(5초) 때문이다. 제한 시간이 있어 무한 대기는 아니며, 더 줄이려면 `validation-timeout`·`socketTimeout`을 낮춘다.
- STEP 8 — Neon은 compute 크기(자동 확장 범위)에 따라 max_connections가 달라진다. 2026-09-30 값(901)은 현재 설정 기준이다. 플랜이나 compute 크기를 바꾸면 다시 확인해야 한다. 지금은 Neon 풀러(`-pooler` 호스트)가 아닌 직접 연결을 쓴다.
- STEP 8 — core의 `minimum-idle: 2`는 요청이 없어도 Neon 연결 2개를 열어 둔다. Neon의 유휴 시 자동 일시정지(scale to zero)가 열린 유휴 연결의 영향을 받는지는 확인하지 않았다. 비용·일시정지가 중요하면 Neon 문서를 확인하고 `CORE_DB_POOL_MIN_IDLE=0`을 검토한다.
- STEP 8 — `.env` 파일에서 `KEY=   # 설명`처럼 값이 빈 줄 뒤에 인라인 주석을 달면 Compose가 주석 글자를 값으로 읽는다(실측: `REDIS_PASSWORD`가 `# [prod][base]`로 들어감). `.env.example`은 주석을 모두 별도 줄로 옮겼다. 실제 `.env`를 편집할 때도 같은 주의가 필요하다.
- STEP 8 — 쿼리 응답 제한(core `DB_SOCKET_TIMEOUT_S`, board `PG_QUERY_TIMEOUT_MS`, 기본 15초)은 compose가 전달하지 않아 코드 기본값으로만 동작한다. 오래 걸리는 정상 쿼리가 생기면 compose 전달을 추가해 조정한다.
- STEP 7-B — `docker-compose.garage.yml`(Next.js garage-ui)을 prod 오버레이와 함께 쓰면 garage-ui는 기본 네트워크에 붙는데 prod에는 기본 네트워크가 없어 proxy에 닿지 않는다. garage 오버레이는 로컬 전용(127.0.0.1 포트)이라 prod와 조합하지 않는 것을 전제로 수정하지 않았다. 필요하면 garage 오버레이에 `networks: [edge]` 등을 추가한다.
- STEP 7-B — `app` 네트워크는 일반 bridge라 core/board뿐 아니라 proxy도 외부로 나갈 수 있다. proxy는 게시 포트 때문에 internal이 아닌 네트워크가 하나 필요해 이렇게 두었다. core/board의 외부 통신도 목적지 제한은 없다(Neon·Kakao·SMTP 외 차단은 호스트 방화벽/egress 정책 영역).
- STEP 7-B — 기본 과제 compose와 prod 오버레이는 네트워크 구조가 다르다(단일 `revcc-network` vs edge/app/data). `docs/DOCKER-SUBMISSION.md`의 `docker network inspect revcc-network` 확인 절차는 과제 구성 기준이며 prod에는 해당하지 않는다.
- STEP 7-A — 운영 반영 시 필요한 수동 작업: 운영 `.env`에 `REDIS_PASSWORD`(영문·숫자, 예 `openssl rand -hex 32`)를 새로 넣어야 한다. 넣지 않으면 prod 오버레이 기동이 거부된다. `.env`는 git에 없으므로 Mac과 Windows에 각각 넣어야 한다.
- STEP 7-A — prod 오버레이는 `!reset`/`!override`를 쓰므로 Docker Compose 2.24 이상이 필요하다(이 PC는 v5.5.1). Mac이나 운영 서버의 Compose 버전을 확인해야 한다.
- STEP 7-A — 컨테이너 밖에서 `docker-compose.dev.yml`의 Redis(127.0.0.1:6379)에 Spring/Node를 직접 붙이는 로컬 개발은 이제 `REDIS_PASSWORD`(기본 `revcc-local-redis`)를 넘겨야 한다. 넘기지 않으면 NOAUTH로 실패한다(`docs/DOCKER-SUBMISSION.md`에 안내).
- STEP 7-A — Redis 비밀번호에 큰따옴표나 백슬래시가 있으면 redis 설정 파일 파싱이 깨질 수 있다. 영문·숫자만 쓰도록 문서화했고 강제 검사는 하지 않았다.
- STEP 7-A — 검증 중 발견: `docker-compose.yml`의 고정 `container_name`(revcc-*)과 네트워크 이름(`revcc-network`) 때문에, 같은 PC에 기존 compose 프로젝트 컨테이너가 남아 있으면(이 PC에는 10시간 전에 멈춘 revcc-* 6개가 있음) 다른 프로젝트 이름으로도 동시에 띄울 수 없다. 검증은 이름만 바꾸는 테스트 전용 오버레이(scratchpad)로 했고, 기존 컨테이너·`revcc-network`·`revcc_revcc_pg` 볼륨은 건드리지 않았다. 과제 요구(고정 이름) 때문에 수정하지 않았다.
- STEP 7-A — 검증에서 `docker compose up --build`를 실행해 로컬 이미지 `revcc-core/board/frontend/proxy:assignment`가 현재 소스(STEP 7-A 포함)로 다시 빌드되었다. 기존 멈춘 컨테이너는 옛 이미지 ID를 그대로 쓰므로 영향은 없고, 다음 `docker compose up --build` 때 어차피 다시 빌드된다.
- STEP 6 — B안의 알려진 변형(테스트로 고정): 붙여 쓴 `a<b`는 `<b` 태그 시작으로 해석되어 `a`만 남는다(`a < b`처럼 띄우면 유지). 사용자가 엔티티 글자를 직접 입력하면(`&amp;` 등) HTML로 해석되어 `&`로 저장된다. 검색어(`q`)와 관리자 필터도 `text()`를 거치므로 같은 규칙이 적용된다(필터는 이후 allow-list로 다시 검사).
- STEP 6 — 기존 데이터 백필 없음(결정대로). 이미 저장된 글에 태그 문자열이 있어도 그대로 남는다. Neon에 해당 데이터가 있는지는 조회하지 않았다. 필요하면 읽기 전용 점검 후 별도 STEP으로 백필을 제안한다.
- STEP 6 — Spring이 저장하는 자유 텍스트(차고 차량 `nickname`/`description` 등, `users.nickname`)는 여전히 sanitize되지 않는다(앞의 "STEP 5~11 계획 중 발견" 항목과 같은 문제, 이번 범위 밖).
- STEP 6 — `sanitize-html` 2.17.7은 Node ≥ 22.12를 요구한다(`engines`). Dockerfile과 CI는 `node:22`(현재 22.23)라 문제없지만, Mac에서 로컬 Node로 board를 직접 실행한다면 버전을 확인해야 한다.
- STEP 5-B — 로그인 응답 시간: 없는 아이디는 BCrypt 비교를 건너뛰므로(`AuthController.login()`의 `user == null ||` 단락 평가) 응답이 더 빠르다. 응답 본문은 같지만 시간 차이로 계정 존재 여부를 추정할 수 있다. 기존 동작이며 이번 STEP에서 바꾸지 않았다(더미 해시 비교로 해결 가능). 다만 아이디는 게시글 작성자·`check-username`으로 이미 공개된 정보다(STEP 11 참고).
- STEP 5-B — 계정 잠금은 "검사 후 실패 기록" 순서라, 잠기기 직전에 동시에 들어온 요청 몇 개는 5회를 넘겨 비밀번호 검사를 받을 수 있다. 추가 시도는 IP당 10/분 제한으로 묶인다. 원자적 예약 방식으로 바꾸려면 별도 작업이 필요하다.
- STEP 5-B — 아이디 단위 잠금의 본질적 트레이드오프: 아이디를 아는 누구나 틀린 비밀번호 5회로 그 계정을 15분 잠글 수 있다(피해자 DoS). 영구 잠금은 없고 카카오 로그인·비밀번호 재설정은 영향받지 않는다. 사용자 승인 수치(5회/15분)대로 구현했다.
- STEP 5-A — `scripts/nginx-forwarded-check.sh`(nginx가 X-Forwarded-For를 덮어쓰는지 확인)는 수동 검사다. GitHub Actions에는 넣지 않았다(CI 워크플로 변경은 이 STEP 범위 밖). nginx 설정 회귀를 CI에서 막으려면 별도로 추가한다.
- STEP 5-A — Docker Desktop의 포트 매핑으로 로컬 접속하면 nginx의 `$remote_addr`가 Docker 게이트웨이 주소가 되어, 로컬의 모든 브라우저가 IP 버킷 하나를 공유한다. 로컬 개발 한정이며 기존 동작과 같다(수정하지 않음).
- STEP 4 — `docker compose down -v && up` 검증: 기본 compose는 core/board가 `.env`의 Neon을 가리키고 URL에 `sslmode=require`가 고정돼 있다. 그래서 compose를 그대로 기동하지 않고, 같은 이미지로 임시 PostgreSQL(16·18)과 Redis 스택을 만들어 compose와 같은 순서(core healthy → board)로 검증했다.

---

## 6. 작업 이력

| STEP | 상태 | 완료일 | commit hash | 비고 |
|---|---|---|---|---|
| P0-1/P0-2 | 완료 | 2026-09-29 | `07c7d7d` | Kakao OAuth state, Cloudflare/TLS 대응. `mvn test` 77 run/0 fail, `npm test` 9 run/0 fail |
| STEP 1 | 완료 | 2026-09-30 | `688e990` | 비밀번호 8자 이상(가입/재설정만), `/api` 본문 64KB·인증서류 업로드 5MB 상한(413), prod 배포 문서. `mvn test` 86 run/0 fail/0 skip(통합테스트 포함), `npm test` 9 run/0 fail |
| STEP 2 | 완료 | 2026-09-30 | `a7ed438` | 관리자 매물 삭제(사유 필수, `LISTING_DELETE` 로그), admin/market 인가·IDOR 테스트 5건. `npm test` 14 run/0 fail, `mvn test` 86 run/0 fail(통합 9 skip) |
| STEP 3 | 완료 | 2026-09-30 | `a74eb33` | `.github/workflows/ci.yml`(backend: Java 23 + Postgres/Redis 서비스로 통합테스트 포함, board: Node 22). GitHub Actions 첫 실행 성공: `mvn test` 86 run/0 fail/0 skip, `npm test` 14 pass. 1차 시도는 러너가 서비스 컨테이너 초기화 단계에서 멈춰 취소됐고(로그 없음, 일시 장애로 판단) 재실행에서 통과 |
| STEP 4 | 완료 | 2026-09-30 | `e68e81f` | Flyway 도입(`V1__baseline`=Neon 스키마, `V2`=`LISTING_DELETE` CHECK), `baseline-on-migrate`, `ddl-auto: validate`. board `schema.sql`, `backend/migrations/`, `VehicleRepository` DDL 제거. 검증: 빈 PG16/PG18 적용 후 Neon 덤프와 비교(예상한 차이만 있음), Neon 스키마 복제본+데이터에서 baseline→V2 적용·데이터 보존·재기동 멱등·API 200, 이전 코드로 만든 DB에서 baseline 통과. `mvn test` 86 run/0 fail/0 skip(통합 포함), `npm test` 14 pass |
| STEP 4 follow-up | 완료 | 2026-09-30 | `47dbd69` | 수동 시스템 테스트 5개를 Flyway 단일 스키마 소유 구조로 전환(`scripts/lib/flyway-migrations.mjs`, `scripts/run-board-system.sh`, `garage-schema-check.py` 임시 스택화, 문서 4곳의 실행 명령 수정). 임시 PostgreSQL 16에서 실행: community/market/moderation PASS, garage-schema-check PASS(V1→V2 + core validate), admin은 기존 rate limit 충돌로 실패(사본으로 나머지 검증 PASS, 추가 이슈 참고). `mvn test` 86 run/0 fail/0 skip(통합 포함), `npm test` 14 pass. Neon 미접속. GitHub Actions run 36661042141 성공(Spring tests, Node tests 모두 success) |
| STEP 5-A | 완료 | 2026-09-30 | `1aae376` | 재현: Spring(`forward-headers-strategy: framework`)은 X-Forwarded-For 첫 값을 IP로 쓰고 nginx는 클라이언트 값 뒤에 덧붙이고 있어, 위조 헤더로 core 로그인 IP 버킷을 매번 바꿀 수 있었다(`ForwardedClientIpTest`, `scripts/nginx-forwarded-check.sh`로 수정 전 실패 확인). 수정: nginx 두 `/api` location에서 X-Forwarded-For를 `$remote_addr`로 덮어씀, Spring/board limiter에 만료 윈도 정리(윈도 길이마다 sweep, 시계 주입). 검증: `mvn test` 91 run/0 fail/0 skip(통합 포함, 신규 5), `npm test` 16 pass(신규 2), nginx 검사 PASS, 현재 소스로 빌드한 전체 임시 스택에서 가입·로그인·글쓰기·프론트 정상 + 위조 XFF를 바꿔 가며 로그인해도 10회 초과 시 429. Cloudflare 실제 IP 복원은 STEP 9. Neon 미접속 |
| STEP 5-B | 완료 | 2026-09-30 | `83c79f1` | 계정 단위 로그인 제한 `LoginAttemptLimiter`(Redis, 키 `login-fail:<SHA-256(로그인과 같은 정확한 아이디)>`, 실패 5회 → 그 시점부터 15분 429 + `Retry-After`, 막힌 동안은 DB·비밀번호 검사 없음, 없는 아이디·정지 계정도 같은 401/429, 성공 시 초기화하지 않고 TTL로만 만료 — `PasswordResetService`와 같은 패턴). 기존 IP 필터와 병행. board: 매물 등록 사용자당 10/분, 신고 사용자당 10/분, 조회수 2곳 IP당 60/분(`rateLimiter`에 `by: "ip"` 추가, 로그인 여부 무관). `admin-system.mjs` 작성자 분산으로 rate limit 충돌 해소. 검증: `mvn test` 99 run/0 fail/0 skip(통합 포함, 신규 8), `npm test` 20 pass(신규 4), 수동 시스템 테스트 5개 PASS, 임시 전체 스택 e2e(동시에 띄운 별도 IP 클라이언트로 계정 잠금·없는 아이디 동일 응답·잠금 중 올바른 비밀번호도 429·다른 아이디 영향 없음·IP 제한 병행 확인). Neon 미접속 |
| STEP 6 | 완료 | 2026-09-30 | `6274979` | `validation.js`의 `text()` 한 곳에서 `sanitize-html`(2.17.7, `allowedTags: []`)로 태그 제거 → sanitize-html이 만든 엔티티 4종(`&lt; &gt; &quot; &amp;`)만 평문으로 되돌림 → 값이 바뀌지 않을 때까지 반복(최대 5회, 수렴하지 않으면 400; 엔티티로 숨긴 태그 차단). 제어·bidi·폭 없는 문자 제거(이모지용 ZWJ는 유지). 길이는 정리 전 원문 기준으로 먼저 검사, 정리 후 빈 필수 값은 400. 백필 없음. 검증: `npm test` 41 pass(신규 21), `mvn test` 99 run/0 fail/0 skip(회귀), 수동 시스템 테스트 5개 PASS, 실제 PostgreSQL에서 작성→조회 왕복(태그 제거, `<3`·`1<2 & 3>2`·이모지 평문 유지, 엔티티 없음). 참고: STEP 6 본문의 "`community-system.mjs`는 깨져 있어 사용 불가"는 STEP 4 follow-up(`47dbd69`)으로 해결된 옛 문구다. Neon 미접속 |
| STEP 7-A | 완료 | 2026-09-30 | `de14a47` | 결정: 운영 DB는 Neon 확정. Redis 인증: `REDIS_PASSWORD`를 redis(설정 파일로 전달해 ps에 노출 안 됨, healthcheck는 `REDISCLI_AUTH`+PONG 확인)·core(`spring.data.redis.password`, prod 프로파일은 필수)·board(`createClient({password})`)에 같은 값으로 전달, 기본 compose는 로컬 기본값 `revcc-local-redis`, prod 오버레이는 `:?` 강제, 비밀번호 미설정 시 무인증 접속 유지(CI·격리 테스트). DB: prod 오버레이가 로컬 `POSTGRES_PASSWORD`로 core/board를 덮어쓰던 문제 제거, core/board는 `DB_HOST/DB_NAME/DB_USER/DB_PASSWORD`를 `:?`로 강제, 로컬 postgres 서비스와 `revcc_pg` 볼륨은 prod 병합 결과에서 `!reset null`로 제거(core `depends_on`은 `!override`로 redis만). `scripts/assignment-run.sh`·`docs/DOCKER-SUBMISSION.md`·`.env.example` 반영. 검증: 가짜 env로 `docker compose config` 병합 결과 확인(prod 서비스 5개·postgres/볼륨 없음·Neon 값만 사용·로컬 비밀번호 미유입·Redis 값 3곳 일치·필수값 6개 누락 시 기동 거부, 기본 compose 6개·`revcc-network` 유지), SSL 켠 임시 PostgreSQL(Neon 대역)로 prod·기본 구성 실제 기동(prod 5개 healthy·postgres 컨테이너/볼륨 미생성·SSL 연결·Flyway V1/V2·가입/로그인/board 글쓰기·Secure 쿠키, 기본 6개 healthy·같은 흐름), Redis 무인증 접근 NOAUTH, `mvn test` 99 run/0 fail/0 skip(무인증 Redis 통합 포함), `npm test` 41 pass, 수동 시스템 테스트 5개 PASS. Neon 미접속 |
| STEP 7-B | 완료 | 2026-09-30 | `7819b9a` | prod 오버레이에만 역할별 네트워크: `edge`(proxy·frontend, internal), `app`(proxy·core·board, 외부 통신 가능), `data`(core·board·redis, internal). 기본 과제 compose(`revcc-network` 6개)는 변경 없음, prod 병합 결과에 기본 네트워크·postgres·볼륨 없음. 임시 prod 스택(SSL PostgreSQL로 Neon 대역) 실측 — 허용: proxy→frontend/core/board, 게시된 포트→proxy(edge가 internal이어도 동작), core/board→redis(로그인·board 세션), core/board→외부 PostgreSQL TLS(12/12 SSL, Flyway V1/V2), core/board→kauth/kapi.kakao.com HTTPS 응답, Redis 인증(NOAUTH/PONG). 차단 12건: frontend→redis/core(DNS·IP)·인터넷, proxy→redis(DNS·IP), redis→frontend/proxy/core의 app IP·인터넷·외부 PostgreSQL. 대조군(같은 nc/TCP 도구로 허용 경로 연결 성공) 확인. `mvn test` 99 run/0 fail/0 skip, `npm test` 41 pass, board 수동 시스템 테스트 4개 PASS(garage-schema-check는 compose를 쓰지 않아 영향 없음). Neon 미접속 |
| STEP 8 | 완료 | 2026-09-30 | `8d8f94e` | Neon 읽기 전용 확인: max_connections 901, superuser_reserved 4(일반 가용 897), 역할·DB 한도 없음, 앱 외 연결은 관리·백그라운드뿐. 풀: core Hikari 최대 10·최소 유휴 2·연결 대기 5초·socketTimeout 15초, board pg.Pool 최대 10·유휴 30초·연결 대기 5초·query_timeout 15초(모두 env로 조정) → 평시 합산 최대 20, 재배포 중첩 40(가용의 약 4.5%). DB 연결 실패는 Spring도 503(`DatabaseUnavailableHandler`, board는 기존 핸들러). 검증 중 발견·수정: 이미 열린 연결에서 DB가 멈추면 board 쿼리가 무한 대기(40초 무응답)하던 문제 → query_timeout/socketTimeout 추가 후 503. prod 오버레이 5개 서비스 `restart: unless-stopped`(기본 compose는 없음), `.env.example`을 compose 변수 전체 기준으로 재작성(값 없는 줄 뒤 인라인 주석이 값이 되는 문제 발견·회피). 검증: `docker compose config`(prod 5개·재시작 정책·풀 변수·7-A/7-B 구조 유지, 기본 6개·재시작 없음), 격리 prod 스택 실측(부하 중 board 연결이 정확히 10에서 멈춤, DB 중지/멈춤/부하 중 멈춤 모두 503·최대 15.0초(board)/20.2초(core)·무응답 0건·복구 후 200, redis·core 비정상 종료 후 자동 재시작·수동 stop은 유지), `mvn test` 101 run/0 fail/0 skip(신규 2), `npm test` 45 pass(신규 4), 수동 시스템 테스트 5개 PASS. Neon에는 SELECT/SHOW만 실행 |
| STEP 9 | 완료 | 2026-09-30 | `c9a4490` | Named Tunnel 운영 확정. nginx: cloudflared 고정 주소(172.16.238.2)에서 온 요청만 CF-Connecting-IP로 실제 IP 복원, `Forwarded`·`True-Client-IP`·`X-Forwarded-Host/Port/Prefix/Ssl`·`CF-Connecting-IP`를 백엔드로 넘기지 않음(**5-A 우회 발견·수정**: Spring이 `Forwarded: for=`를 우선해 로그인 IP 제한을 우회할 수 있었음), limit_req(`/api` 20r/s·burst 200, 인증 30r/m·burst 30, JSON 429), HSTS `max-age=300`(cloudflared 경유 https만), `server_tokens off`, timeout 명시(proxy read 30s 등). prod 오버레이: `cloudflared` 서비스 + `tunnel` 네트워크, proxy 호스트 포트 제거. 검증: Quick Tunnel로 Cloudflare 엣지 헤더 실측, `scripts/nginx-forwarded-check.sh` PASS(수정 전 설정은 FAIL), 임시 prod 스택(SSL PostgreSQL로 Neon 대역) 실제 엣지 경유 e2e(HSTS, http→301, Secure 세션 로그인·board 세션·글쓰기·업로드 4MB, nginx 로그에 실제 공인 IP, 위조 헤더를 바꿔도 Spring 10회·Node 60회 후 429, 인증 zone 429), 신뢰 발신지 시뮬레이션(사용자별 버킷 분리, 비신뢰 발신지는 한 버킷), 구 설정 이미지로 `Forwarded` 우회 재현, proxy 직접 접근 불가(게시 포트 없음, 외부 컨테이너 도달 불가), core 정지 시 504 30.0초, 기본 과제 compose 회귀(6개 healthy, 로컬 http에 HSTS 없음, 가입·로그인·세션·글·댓글·이미지·로그아웃·기존 rate limit·415). `docker compose config`(prod 6개·게시 포트 0·토큰 누락 시 거부, 기본 6개·8090·`revcc-network` 유지), `.env.example` ⊇ compose 변수. `mvn test` 102 run/0 fail/0 skip(통합 포함, 신규 1), `npm test` 45 pass, 수동 시스템 테스트 4개 PASS. GitHub Actions run 36718881922 성공(Spring tests, Node tests). Neon 미접속 |
| STEP 10 | 결정 완료 | 2026-09-30 | (문서) | 회원탈퇴 정책 12개 결정(soft withdrawal, 콘텐츠 "탈퇴한 회원" 유지, 즉시 탈퇴 + 본인 재확인 등) 기록, STEP 10-impl A~E 계획 정의. 조사: 임시 PostgreSQL에서 `DELETE FROM users` 시나리오 실측(ROLLBACK), Neon은 FK 카탈로그·집계만 읽기 전용 확인(FK 30개 V1과 일치, orphan 0, 관리자 1명, 일반 계정 32개 중 31개 이메일 없음). 코드 변경 없음 |
| STEP 10-impl-A | 완료 | 2026-10-01 | `cf9fe55` | Flyway V3: `users.withdrawn_at`, `account_status` CHECK(ACTIVE/SUSPENDED/DISABLED/WITHDRAWN), `board_posts.deleted_at/deleted_by(FK users)/deleted_reason`(AUTHOR/ADMIN, 기존 deleted=true는 ADMIN 백필). V1/V2 무변경, 탈퇴 API 없음. Spring: WITHDRAWN을 `User.isBlocked()`에 포함 → 일반 로그인(없는 계정과 같은 401)·카카오 로그인(403, 닉네임 갱신 전 거부)·공유 세션·관리자 인가 차단, 비밀번호 재설정 요청/완료도 거부. 관리자 회원 PATCH: 탈퇴 대상은 모든 변경 409, 변경 후 유효 관리자 0명이면 409(ADMIN 행 전체 id 순 FOR UPDATE 후 요청자·대상을 다시 읽음), 목록 WITHDRAWN 필터(기본 목록·overview 회원 수 제외). 예약 아이디(NFKC·대소문자·구두점 정규화, "탈퇴한 회원"·`withdrawn` 접두어·관리자류): 가입·중복 확인·카카오 신규/닉네임 갱신. board: WITHDRAWN 세션 거부, 공통 `member-display.js`로 글·댓글·알림·방명록·장터·관리자 글/신고 목록에 "탈퇴한 회원" 표시와 공개 id·연결 차량 숨김(관리자는 내부 id 유지), 탈퇴 회원 프로필·차고·방명록 404, 연락처 비공개, 회원 수·검색·관리자 회원 목록 제외. frontend: id 없으면 프로필 링크 없음, 관리자 회원 창 WITHDRAWN 표시·편집 비활성. **중단 복구**: 작업 중 세션이 끊겨 커밋 전 working tree에서 재개. 누락 1건(관리자 글/신고 목록의 탈퇴 표시)을 보완하고, 남아 있던 임시 컨테이너 `s10a-testpg`/`s10a-testredis`를 정리했다. 검증: `mvn test` 118 run/0 fail/0 skip(통합 포함, 빈 PG16·빈 PG18 각각, 같은 DB 재기동 시 flyway history·checksum 동일), 마지막 관리자 동시 강등 8라운드 매번 1건만 성공·관리자 1명 유지, Flyway CLI로 V1+V2 적용 DB(기존 글·정지 회원 포함)에 V3 적용 PG16/PG18 모두 성공(백필 ADMIN, 기존 상태 유지, 잘못된 상태 CHECK 거부, validate 통과), `npm test` 47 pass, 수동 시스템 테스트 5개 PASS(`withdrawn-member-system.mjs` 신규), `garage-schema-check.py` PASS(V1→V2→V3 + core validate). Neon 미접속·V3 미적용(다음 core 기동 시 V3 적용됨). GitHub Actions run 36738672032 성공(Spring tests, Node tests) |
| STEP 10-impl-B | 완료 | 2026-10-01 | `544a819` | 본인 글 삭제를 `DELETE`에서 soft delete로 바꿨다(`deleted=true, deleted_at=NOW(), deleted_by=삭제한 사용자 id, deleted_reason='AUTHOR'`, 원문·사진 참조 유지). 관리자 삭제도 `deleted_at/deleted_by/deleted_reason='ADMIN'`을 기록한다(원문은 기존대로 moderation_logs, 글의 제목·본문·image_ids는 비움). 댓글·신고·좋아요·북마크·알림은 더 이상 cascade로 지워지지 않고, 반복 삭제는 404(기록 추가 없음). 공개 조회는 이미 `NOT deleted`였고, 관리자 overview `totalPosts`·회원별 `postCount`·관리자 게시글 목록에서도 삭제 글을 뺐다. 관리자 신고 목록은 삭제 글의 신고를 유지하며 `postDeleted/deletedReason/deletedAt`과 작성자 삭제 글의 원문을 준다(관리자 화면에 "작성자가/관리자가 삭제한 글" + 원문 펼치기). 이미지 공개(`GET /api/board/images/:id`): 삭제되지 않은 글·매물의 image_ids, 탈퇴하지 않은 회원의 avatar/cover/차량 image_id가 참조할 때만 공개하고, 소유자(미리보기)와 DB 기준 관리자는 항상 볼 수 있다. 그 밖은 없는 id와 같은 404(`board-service/src/image-references.js`). 글·매물 응답의 imageIds는 실제 있는 이미지와 교집합(순서 유지). Flyway V4 `V4__image_reference_indexes.sql`: `board_posts.image_ids`, `parts_listings.image_ids` GIN 인덱스. 이미지 행을 지우는 코드 경로는 원래 없었다(삭제는 회원 cascade뿐)라 바꾸지 않았다(추가 이슈 참고). 검증: `mvn test` 118 run/0 fail/0 skip(빈 PG16·PG18 각각, 재기동 후 flyway history·checksum 동일), Flyway CLI로 V1→V3 + 데이터 5000행 DB에 V4 적용 PG16/PG18 성공, 재실행 "up to date", `image_ids @> ARRAY[..]`가 `board_posts_image_ids_gin` Bitmap Index Scan 사용, `npm test` 47 pass, 수동 시스템 테스트 6개 PASS(`post-soft-delete-system.mjs` 신규: 요청한 15개 항목 + 탈퇴자 프로필·차량 사진 404 + 숫자가 아닌 이미지 id 400, `moderation-system.mjs`에 deleted_by/deleted_reason 기대값, `community-system.mjs`는 미첨부 사진 비로그인 404로 기대값 변경), `garage-schema-check.py` PASS(V1→V4 + core validate). Neon 미접속·V3/V4 미적용. GitHub Actions run 36744039479 성공(Spring tests, Node tests) |
| STEP 10-impl-C | 완료 | 2026-10-01 | `1af7edb` | 일반 계정 탈퇴 `POST /api/auth/withdraw {password, confirm:true}`(로그인 필수, 로그인과 같은 비밀번호 확인, 실패 회원당 5회/15분 `withdraw-fail:<id>` + IP 10/분 + nginx 인증 구간), 화면용 `GET /api/auth/withdraw`(방식·관리자·예약중 수). 거부: 카카오 400 `KAKAO_REAUTH_REQUIRED`(D 전까지), ADMIN 409, 예약중 매물 409(개수), 비밀값 없음 503 — 거부 시 아무것도 바뀌지 않는다. `WithdrawalService` 한 트랜잭션: 회원·매물 행 잠금 → `withdrawal_blocks` → 차고(차량 CASCADE로 정비기록·등록증·인증, 글 vehicle_id SET NULL)·프로필·내 차고 방명록 삭제 → 판매중 closed(연락처·찜 삭제), 판매완료 연락처만 삭제(지역·사진 유지) → 좋아요·북마크·찜·받은 알림 삭제 → 어디서도 참조하지 않는 내 사진 삭제(삭제 글·닫힌 매물 참조도 보존) → moderation_logs 대상 이름 `탈퇴한 회원#<id>` → users 익명화(`withdrawn:<id>`, email·kakao_id·nickname NULL, 사용 불가 비밀번호, suspended_until 유지) + WITHDRAWN + withdrawn_at + auth_version+1 → `SELF_WITHDRAW:<직전상태>`. 커밋 후 현재 세션 키 삭제·쿠키 제거, 다른 세션은 auth_version으로 Spring·board 즉시 거부. 재가입 제한: HMAC-SHA256(`WITHDRAWAL_HMAC_SECRET`, `type:value`)만 저장(V5 CHECK로 hex 64자만 허용), 아이디(가입과 같은 원문)·정규화 이메일·카카오 id, COOLDOWN 30일 + SANCTION(정지: 종료일과 30일 중 늦은 날, 종료일 없는 정지·비활성화: 무기한). 확인: 가입·아이디 확인·카카오 신규 가입/닉네임 갱신·관리자 이메일 등록. prod 프로파일·오버레이는 비밀값 없으면 기동 거부, 그 외 환경은 탈퇴 503 + 살아 있는 제한 행이 있으면 가입도 503. Flyway V5 `V5__member_withdrawal_data.sql`(매물 status에 closed — 기존 CHECK는 정의로 찾아 교체, closed_at, withdrawal_blocks). board: closed 매물은 목록·검색·찜·상세·조회수·찜·수정에서 제외(관리자 상세만), 사진 비공개. `/api/admin/members/{id}/actions`의 admin_id NULL NPE 수정. frontend `/home` "회원 탈퇴"(안내·비밀번호·동의, 서버 사유 표시, 카카오·관리자·예약중은 폼 없이 안내). 문서 `docs/member-withdrawal.md`(키·교체·수동 해제·한계). 검증: `mvn test` 130 run/0 fail/0 skip(빈 PG16·PG18 각각, 같은 DB 재실행 후 flyway history·checksum 동일; 신규 `WithdrawalIntegrationTest` 9·`WithdrawalBlocksTest` 3 — 테이블별 결과, 세션 2개 무효, 탈퇴 전 재설정 토큰 거부, 재가입 409, 원문·단순 SHA-256 미저장, 예약중 409 무변경, 카카오·관리자 거부, 제재 기간 4가지, 강제 실패 전체 롤백, 동시 탈퇴 4회 1건만 성공, 예약 변경 경쟁 6회, 관리자 복구 불가·마지막 관리자 보호), Flyway CLI V4(기존 매물 3상태)→V5 PG16/PG18 성공·재실행 up to date·CHECK 이름이 달라도 교체, `npm test` 47 pass, 수동 시스템 테스트 7개 PASS(`withdrawal-system.mjs` 신규), `garage-schema-check.py` PASS(V1→V5 + core validate), 실제 core+board 임시 스택 e2e PASS, 전체 스택(proxy·frontend 포함) 브라우저 `withdrawal-browser.cjs` PASS, prod 프로파일 비밀값 없이 기동 실패 확인, `docker compose config`(prod는 비밀값 누락 시 거부, 기본 compose는 영향 없음). Neon: 읽기 전용 집계만(Flyway v2, account_status 33명 전부 NULL, 매물 0건, status CHECK 이름 `parts_listings_status_check`, 이메일 1·카카오 1·관리자 1) — 쓰기 없음. GitHub Actions run 36748149088 성공(Spring tests, Node tests) |
| STEP 10-impl-D~E | 보류(2026-10-01) | - | - | 공개 단계 전환으로 보류. D는 §4 LATER-1(최소 구현), E는 §4 "보류" |
| STEP 11 | 보류(2026-10-01) | - | - | 작은 응답 통일은 §4 LATER-2, 큰 설계가 필요하면 보류 |

---

## 7. 다음 실행 명령

새 터미널/새 Claude Code 세션에서 아래 한 문장만 입력하면 된다:

```
REVCC_NEXT_TASKS.md를 읽고 "지금 할 것"의 처음 미완료 작업 하나만 진행해. 공통 작업 규칙과 "작업 및 검증 경량화 원칙"을 따르고, 관련 테스트 통과 후 commit 및 origin/docker-assignment push까지 진행해.
```
