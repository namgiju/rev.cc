# REV.CC 배포 전 전체 점검 보고서 (진행 중)

> 이 문서는 분석 진행 상황을 기록하는 작업 파일입니다. 세션이 중단되어도 이 파일을 먼저 읽고,
> [완료] 항목은 재분석하지 않고, [진행중]부터 이어서 진행합니다.
> 브랜치: `docker-assignment` / 코드 수정 없음, 분석 전용.

## 진행 방식 메모 (다음 세션이 반드시 읽을 것)
- 6개의 병렬 조사 서브에이전트를 백그라운드로 실행함 (2026-09-29 시작). 아래 "서브에이전트 상태" 표 참고.
- 각 에이전트가 완료 알림을 보내면, 그 결과를 해당 섹션에 즉시 반영하고 이 파일을 업데이트할 것.
- 최종 15번(등급별 정리)·16번(마지막 요약) 섹션은 1~14번 섹션이 실질적으로 채워진 뒤에 작성.

## 서브에이전트 상태 (내부 추적용 — 사용자에게 agentId 언급 금지)
| # | 담당 영역 | 상태 |
|---|---|---|
| 1 | Spring Boot 백엔드 인증/인가/API/DB/테스트 | **완료** |
| 2 | Node board-service 인가/세션신뢰/rate-limit/XSS/SQL/Redis | **완료** |
| 3 | Docker Compose/Nginx/포트노출/secret/hardening | **완료** |
| 4 | PostgreSQL 스키마 무결성/cascade/트랜잭션/N+1 | **완료** |
| 5 | assignment-frontend XSS/하드코딩/데드코드/UX | **완료** |
| 6 | 테스트 범위 / 죽은 코드 / 문서-실제 구현 비교 | **완료** |

**모든 서브에이전트 조사 완료. 이제 남은 작업: 섹션 1/3/7/8/9/10/11/12/13/14 종합 작성 + 15(P0~P3) + 16(최종요약).**

---

## 이미 직접 확인한 사실 (재확인 불필요)

- 저장소 루트 구조 확인 완료 (최상위 디렉터리 목록: assignment-frontend, backend, board-service, frontend(별도 Next.js, 용도 미확정 — 에이전트5가 compose 연결 여부 확인 중), nginx, docker-compose*.yml 5종, docs/, scripts/, references/, prototype/).
- `.gitignore`에 `.env`, `revcc_backup.dump`, `__pycache__/`, `*.tsbuildinfo` 등이 포함되어 있고, `git ls-files`로 확인한 결과 `.env`와 `revcc_backup.dump`는 **git에 커밋되지 않음** (git history에도 없음, `git log --all -- .env` / `-- revcc_backup.dump` 결과 없음). → 시크릿/DB 덤프 파일의 git 유출은 현재 없음. (단, 로컬에 2.6MB `revcc_backup.dump`가 실존 — 내용은 열람하지 않음, 운영 DB 백업이라면 저장 위치/접근권한 별도 확인 필요.)
- `.env.example`만 git에 커밋되어 있음 (`git ls-files | grep -iE '\.env|secret|dump|\.pem|\.key'` 결과 `.env.example` 하나뿐).
- IDE에서 사용자가 `backend/src/main/java/com/revcc/app/PasswordResetController.java`를 열어봄 — 비밀번호 재설정 컨트롤러가 실제로 존재함 (경로만 확인, 내용은 에이전트1 결과에서 다룰 예정).

## 섹션별 상태

### 1. 프로젝트 구조 파악 — [완료]

**컨테이너 구성 (docker-compose.yml, 6개)**: `proxy`(nginx, 유일하게 호스트 노출 `${REVCC_PORT:-8090}:80`) → `frontend`(assignment-frontend, nginx 정적서빙) / `core`(Spring Boot, 8080) / `board`(Node/Express, 3001) / `redis` / `postgres`(실제로는 앱이 Neon 원격 Postgres를 바라봄 — 로컬 postgres 컨테이너는 기본값 크리덴셜로 떠 있으나 앱 트래픽과 무관, §4 참고). 전부 `revcc-network` 단일 브리지 네트워크(계층 분리 없음).
- 별도로 `frontend/`(Next.js, "My Garage" 프로토타입)가 존재하나 **기본 배포 스택에 포함되지 않음** — `docker-compose.garage.yml`이라는 선택적 오버레이로만 연결되고, `:3000`으로 nginx 우회 직접 노출됨. 과제 제출 범위(6-container)에는 포함되지 않는 별도 실험 기능.

**요청 흐름**: 브라우저 → nginx(`:8090`) → `location /` → `frontend`(정적 HTML/JS) / `location ~ ^/api/(board|parts)` → `board:3001` / `location /api/` → `core:8080`. nginx가 `X-Real-IP`/`X-Forwarded-For`를 `$remote_addr` 기준으로 직접 설정(스푸핑 불가, nginx가 실제 최외곽 홉).

**Spring vs Node 역할 분리**: Spring(`core`)이 회원/인증(자체 세션+Kakao OAuth)/관리자 회원관리/비밀번호 재설정(SMTP)/내 차고(차량 CRUD)/차량 소유 인증(서류 검토)을 담당. Node(`board`)가 커뮤니티 게시글/댓글/좋아요/북마크/알림/신고/부품 장터/관리자(게시글·신고·배지 관리)/방명록을 담당. 두 서비스가 **하나의 Postgres `users` 테이블을 공유** — Spring의 Hibernate `ddl-auto:update`가 테이블을 소유/생성하고 Node는 FK로만 참조(§6 참고, 스키마 소유권 3원화가 가장 큰 구조적 리스크).

**인증/인가 구조**: 자체 구현 쿠키+Redis 세션(Spring Security 미사용). 로그인 성공 시 `SharedSessionService`가 `SecureRandom` 32바이트 토큰 발급, Redis에 `revcc:session:<token>` 키로 저장(`{id, username, role, authVersion}` JSON). 이 Redis 키/포맷을 Node(board-service)가 **직접 읽어** 동일 사용자로 인식 — 두 서비스 간 신뢰가 "공유 Redis 세션 스토어"라는 단일 계약에 의존. 두 서비스 모두 매 요청마다 DB에서 `auth_version`/계정상태를 재조회해 정지/탈퇴/비번변경을 즉시 반영(세션 캐시를 맹신하지 않음 — 잘 설계됨).

**Redis 용도**: 세션 저장이 유일한 용도(캐싱/카운터 용도 없음). TTL 30분 고정(생성 시점 기준, sliding 아님). 인증 없이 접근 가능(무인증) — 네트워크 미노출로만 완화.

**개발/운영 환경 차이**: `docker-compose.dev.yml`(로컬 DB/Redis 포트를 127.0.0.1에 한정 노출, 명시적 `-f` 필요), `docker-compose.override.yml`(assignment-frontend 소스 바인드마운트, **플래그 없이 자동 적용**됨), `docker-compose.prod.yml`(POSTGRES_PASSWORD 필수화, Spring `prod` 프로파일 활성화 → 세션 쿠키 Secure 강제). **다만 실제 문서(`docs/DOCKER-SUBMISSION.md`, `README.md`)는 prod.yml 사용법을 전혀 언급하지 않아, 문서대로 실행하면 하드닝이 적용되지 않는 override 경로로 흘러감** (§5 상세).

**환경변수/secret 관리**: 전부 `.env` 기반 `${VAR}` 참조, 하드코딩된 실제 값 없음(§4). `.env.example`이 최신 변수들(DB_HOST, KAKAO_* 등)을 다수 누락 — 새 기여자가 그대로 따라하면 기동 실패 또는 약한 기본값 사용 위험.

**사용자 입력이 DB까지 가는 주요 경로**: (1) 회원가입/로그인/재설정 → Spring `AuthController`/`PasswordResetController` → JPQL 파라미터 바인딩 → Postgres `users`. (2) 게시글/댓글/장터글/방명록 → Node `community.js`/`market.js` → `pg` 파라미터 바인딩(`$1,$2...`) → Postgres. (3) 이미지 업로드(base64) → 매직바이트 검증 후 `bytea` 컬럼 저장(파일시스템 미사용, 경로순회 위험 구조적으로 없음). 두 서비스 모두 SQL 인젝션 취약점 발견되지 않음(전수 파라미터화 확인).

### 2. 보안 취약점 (인증/인가/세션/입력검증) — [진행중] (board-service 완료, Spring 백엔드 대기)

#### 2-A. board-service (Node/Express) — [완료]
검사 파일: `board-service/src/{app,server,community,market,moderation,admin,admin-access,owned-images,rate-limit,validation}.js`, `board-service/test/*`, `backend/.../SharedSessionService.java`(교차검증), `nginx/default.conf`.

**총평: 학생 프로젝트치고 이례적으로 잘 만들어짐. 크리티컬/하이 등급 취약점 없음.** 세션 신뢰 모델, 소유권 검사, SQL 파라미터화, 관리자 게이팅 전부 정상 구현. 아래는 개선 권고 수준의 갭.

- **세션 신뢰(Cross-service auth)**: `app.js:8-25`에서 `REVCC_SESSION` 쿠키를 정규식(`/^[A-Za-z0-9_-]{43}$/`)으로 형식 검증 후 Redis(`revcc:session:<token>`)에서 조회, JSON payload(id/username) 유효성까지 검사. **`x-user-id` 등 클라이언트 헤더로 신원을 신뢰하는 코드는 없음**(grep 0건) — 헤더 위조로 사칭 불가능. 토큰은 Spring `SharedSessionService.java`에서 `SecureRandom` 32바이트 base64url(43자)로 생성되어 위조/추측 불가.
- **권한 재검증이 매 요청마다 이뤄짐(강점)**: `app.js:49-58`이 `/api/board`, `/api/parts` 요청마다 DB에서 `auth_version`/`account_status`/`suspended_until`을 재조회해 세션이 살아있어도 탈퇴/정지/비번변경 후에는 즉시 무효화됨(`session-revocation.test.js`로 테스트됨). 관리자 라우트도 세션 캐시된 role이 아니라 매번 DB에서 role을 재확인(`admin-access.js:4-9`) — 강등된 관리자의 stale 세션으로도 접근 불가.
- **IDOR 전수 검사 결과: 발견 없음.** community.js/market.js의 모든 mutate 라우트가 `WHERE ... AND author_id=$N`/`owner_id=$N`/`seller_id=$N` 형태로 소유자 확인 후 0 rows면 403. `app.test.js`에 클라이언트가 `authorId:99`를 보내도 세션의 실제 id(7)로 저장되는지 확인하는 명시적 스푸핑 방지 테스트 존재.
- **moderation.js 관리자 삭제**: `deleteContent`가 트랜잭션+`FOR UPDATE` 행 잠금으로 사전 스냅샷과 삭제/로그기록을 원자적으로 처리, 관리자 삭제 시 `reason` 필수(빈 값 거부) — 잘 설계됨.
- **[P2] market.js(부품 장터)에는 관리자 모더레이션 기능 자체가 없음** — 커뮤니티 게시글/댓글은 관리자가 삭제 가능하지만 사기/어뷰징 부품 판매글을 관리자가 내릴 방법이 없음. 취약점은 아니고 기능 공백.
- **[P2] Rate limit 커버리지 공백**: `rate-limit.js`는 in-memory 고정윈도(단일 인스턴스 전제, 코드 주석에 명시적으로 인지됨). 게시글/댓글/이미지업로드/방명록 작성엔 적용되나, **부품 등록(POST `/api/parts/listings`)과 조회수 증가 엔드포인트(`POST /posts/:id/view`, `POST /:id/view`, 비인증)는 rate limit이 전혀 없음** — 조회수 어뷰징 가능(낮은 심각도). 신고(`/posts/:id/report`)도 rate limit 없음(단 `UNIQUE(user_id,post_id)` 제약으로 동일 글 중복신고는 막힘).
- **[중간] 서버 측 HTML sanitization 부재** — `validation.js`는 타입/길이만 검사, `sanitize-html`/DOMPurify 등 의존성 없음 → 게시글/댓글/닉네임/장터글이 원문 그대로 저장·반환됨. **현재는 프론트(`assignment-frontend`)가 전부 `textContent` 기반 렌더링(에이전트5 확인)이라 실제 XSS로 이어지지 않지만, 서버가 아무 방어도 하지 않으므로 향후 프론트 변경이나 다른 API 소비자(관리자 도구, 모바일 앱 등)가 `innerHTML`을 쓰는 순간 바로 저장형 XSS로 연결되는 구조적 공백.** 배포 전 서버측 sanitize 추가 권장.
- **SQL 인젝션: 발견 없음** — 모든 사용자 입력이 `$1,$2...` 파라미터 바인딩. 문자열 템플릿이 쓰인 곳은 전부 하드코딩된 테이블명/컬럼명(사용자 입력 아님).
- **파일 업로드(owned-images.js)**: 이미지가 파일시스템이 아닌 Postgres `bytea`로 저장되어 경로순회 위험 자체가 없음. 업로드 시 매직바이트 검증(JPEG/PNG/WEBP 시그니처) + 3MB 캡 + MIME 화이트리스트, 다른 사용자 이미지 ID를 자기 글에 첨부하는 것도 `owner_id` 체크로 차단. `X-Content-Type-Options: nosniff`로 서빙 — 잘 구현됨. 차량 인증서류(`vehicle_verifications` 테이블)는 board-service에서 전혀 참조하지 않고 Spring이 전담 — 분리 양호.
- **Secrets**: board-service 코드에 하드코딩된 비밀번호/키 없음(grep 0건). DB는 `pg` 표준 `PG*` 환경변수, Redis는 `REDIS_URL` 환경변수.
- **CSRF**: CORS 헤더 미설정 + 쿠키 `SameSite=Lax` + nginx가 JSON Content-Type 아닌 POST/PUT/PATCH를 차단 → 전통적 HTML 폼 CSRF에 대한 다중 방어 존재.
- **Redis 장애 시**: 인증이 **fail-closed**(503 반환) — 가용성은 떨어지지만 보안상 올바른 선택.
- **[테스트 공백]** `market.js`에 대한 테스트가 전무(다른 판매자 글 수정/삭제 IDOR 테스트 없음), `admin.js`/`admin-access.js` 인가 테스트 전무(비관리자 403, 강등된 관리자 거부 등 강점으로 꼽은 로직이 실제로는 테스트되지 않음), moderation.js는 "관리자 아님→403" 경로만 테스트되고 "실제 관리자가 정상 삭제" 성공 경로는 테스트 없음.

#### 2-B. Spring 백엔드 — [완료]
검사 파일: `backend/src/main/java/com/revcc/app/**`(Auth/Admin/AdminMember/GarageVehicle/VehicleVerification/Vehicle Controller·Service·Repository, SharedSessionService, KakaoOAuthService, PasswordResetService/Controller, PasswordMigrationRunner, SafeMailFailure, ResetMailService), `backend/src/test/**`(16개 클래스, 1027줄), `application{,-prod}.yml`, `backend/Dockerfile`.

**총평: Spring Security 없이 커스텀 쿠키+Redis 세션을 직접 구현했는데도 이례적으로 보안 의식이 높은 코드베이스.** DTO 바인딩(mass assignment 구조적으로 불가능), 전수 파라미터화 쿼리, IDOR/인가 우회를 정면으로 겨냥한 테스트 다수. 발견된 이슈는 대부분 Medium 이하.

**[P1] 카카오 OAuth에 `state` 파라미터(CSRF 방지) 없음**
- `KakaoOAuthService.authorizeUrl()`(34-39행)이 `state`를 생성/저장하지 않고, 콜백(`AuthController.java:96-113`)도 검증하지 않음. 고전적 OAuth 로그인 CSRF/인가코드 주입 공격 가능 — 공격자가 자신의 카카오 인가코드를 피해자 브라우저에 `/api/auth/kakao/callback?code=...`로 강제 요청시켜 피해자를 공격자 계정으로 로그인시킬 수 있음(계정 혼동/데이터 오염 공격). 서명된 랜덤 `state`를 서버측(또는 단기 HttpOnly 쿠키)에 저장 후 콜백에서 검증 필요.

**[P1] 비밀번호 최소 길이 제한 없음**
- `AuthController.Credentials.password`(143행), `PasswordResetController.ResetRequest.password`(16행) 모두 `@NotBlank @Size(max=255)`만 있고 `min=` 없음 — **1글자 비밀번호도 가입/재설정 통과**.

**[P1] 전역 요청 본문 크기 제한 없음**
- `application.yml`/`application-prod.yml`에 `server.tomcat.max-http-form-post-size` 등 body 크기 제한이 전혀 없음. Jackson이 `@RequestBody` JSON을 크기 체크 전에 전부 메모리에 역직렬화 — 대용량 JSON으로 메모리 고갈(DoS) 가능. (`VehicleVerificationController`의 4.2MB 체크는 이미 역직렬화된 *이후*에 수행됨.)

**[P2] 비밀번호 재설정 요청 엔드포인트에서 계정 존재 여부 열거(enumeration) 가능 — 의도된 트레이드오프로 보이나 확인 필요**
- `PasswordResetService.request()`(51-72행)가 `USERNAME_NOT_FOUND` / `IDENTITY_MISMATCH` / `SOCIAL_ACCOUNT`를 구분된 코드로 응답(테스트로 의도적 동작임이 명시됨, `PasswordResetRequestTest.java:33-41`). Rate limit(IP당 20/시간, 이메일당 5/시간)으로 일부 완화되나, 인내심 있는 공격자는 유효 아이디를 열거할 수 있음. **팀이 의식적으로 감수한 트레이드오프인지 확인 필요** — UX 우선 설계로 보이나 배포 전 재점검 권장.

**[P2] Rate limit이 IP 기준만 존재, 계정 기준 lockout 없음**
- `RateLimitFilter`가 (URI, IP) 기준 분당 10회 제한 — 분산 IP를 쓰는 공격자는 특정 계정을 무제한 브루트포스 가능(계정 잠금 카운터 없음). 또한 `RateLimitFilter.hits`(`ConcurrentHashMap`, 24행)가 만료된 버킷을 절대 정리하지 않아 장시간 운영 시 메모리 누수 가능성(스푸핑 가능한 XFF를 프레임워크가 신뢰 — `application.yml:5` `forward-headers-strategy: framework`, nginx가 XFF를 덮어쓰지 않으면 우회 가능성도 존재).

**[P3] 관리자 인증 초기 세팅 관련**: 하드코딩된 기본 관리자 계정/시드 데이터 없음(양호). 단, 관리자 권한 부여가 DB 직접 수정 등 "out-of-band"로만 가능 — 운영 절차 문서화 필요.

**잘 구현된 부분 (근거 있음)**
- **세션 고정 방어 완벽**: 로그인마다 `SecureRandom` 32바이트 새 토큰 발급(`SharedSessionService.create()`), 이전 토큰은 즉시 `revoke`.
- **로그아웃 시 서버측 Redis 세션 실제 삭제** + 쿠키 클리어 확인됨.
- **BCrypt 기본 cost(10) 사용**, 72바이트 한계 처리, 레거시 평문 비밀번호 자동 마이그레이션(기동시 + 최초 로그인시), 상수시간 비교(`MessageDigest.isEqual`)로 타이밍 사이드채널 방지.
- **비밀번호/시크릿 로깅 없음** — 로그 문장 2곳뿐, `toString()` 오버라이드로 `[redacted]` 처리, `SafeMailFailure`가 화이트리스트 방식으로만 메일 실패를 로깅(주소/자격증명 절대 미노출, 테스트로 검증됨). `User.getPassword()`에 `@JsonIgnore`.
- **로그인 계정열거 방지**: 존재하지 않는 아이디 vs 틀린 비밀번호가 동일한 401 응답(테스트로 검증).
- **IDOR 전수 검사 결과: 발견 없음** — 내 차고 차량 수정/삭제(`GarageVehicleService.owned()`), 차량 인증 제출/문서열람(소유자/관리자만), 관리자 API(role을 세션+DB 이중 재검증) 전부 서버측 소유권/권한 검사. 클라이언트가 `userId:999`를 보내도 무시되고 세션 사용자로 강제됨(테스트로 명시적 검증).
- **Mass assignment 구조적으로 불가능** — 모든 컨트롤러가 엔티티가 아닌 전용 DTO(record)에 바인딩. 관리자 PATCH에 `password`/`passwordHash`를 몰래 넣어도 무시됨(테스트로 검증).
- **관리자 자기잠금 방지**: 관리자가 자기 자신을 강등/정지/비활성화하면 409 Conflict.
- **비밀번호 재설정 시 전 세션 무효화**: `authVersion` 증가 방식으로 재설정/관리자수정 시 기존 모든 세션이 즉시 무효화(다중 기기 로그인 상태에서도 검증됨).
- **쿠키 설정 양호**: HttpOnly 하드코딩 true, `application-prod.yml`에서 Secure=true 강제(오버라이드 불가), Domain 미설정(범위 최소화), SameSite=Lax.
- **CORS**: 전역 CORS 설정 없음, `VehicleController`에만 `@CrossOrigin(origins="http://localhost:3000")`(공개 GET 데모 데이터용, 자격증명 없음) — 와일드카드+credentials 조합 같은 위험한 설정 없음. (dead code 성격, 위험은 아님)
- **SQL 인젝션 없음**(JPQL 파라미터 바인딩, `AdminMemberController`의 동적 검색 필드도 allow-list + LIKE 이스케이프 처리), 파일업로드는 매직바이트 검증까지 수행.
- **DB 레벨 cascade 정상**(`@OnDelete(CASCADE)`로 차량/인증 데이터 고아 방지), `@EntityGraph`로 N+1 사전 차단.
- **Hibernate bind 파라미터 로깅 명시적으로 OFF**(코드 주석: "요청/응답 body에 비밀번호와 1회용 재설정 코드가 포함될 수 있음") — 비밀번호/토큰이 DEBUG 로그에 찍히는 것을 사전 차단한 의도적 조치.
- **예외 처리**: 스택트레이스/내부정보 클라이언트 노출 없음. 단 `AuthController`/`AdminController`/`VehicleVerificationController`는 전용 `@RestControllerAdvice`가 없어 에러 응답 형태가 다른 컨트롤러(Garage/Member)와 일관되지 않음(보안 문제 아닌 API 일관성 문제).
- **테스트 커버리지 강함**: 16개 클래스 1027줄, 인증성공/실패, IDOR, 세션무효화, rate limit, 열거방지를 정면으로 테스트 — 회귀 방지 자산으로 훌륭함.

### 3. API 전체 감사 (표) — [완료]
(에이전트1/2 조사 결과 취합. 세부 라인은 §2-A/§2-B 참고)

**Spring (`core`, `/api/...`)**

| Method/Path | 인증 | 인가검사 | 입력검증 | Rate limit | 위험 | 판정 |
|---|---|---|---|---|---|---|
| POST /api/auth/signup | 불필요 | N/A | @NotBlank, max길이(최소길이 없음) | 10/min·IP | 비번 최소길이 없음(P1) | 대체로 양호 |
| GET /api/auth/check-username | 불필요 | N/A | 공백/길이 체크 | 10/min·IP | 낮음(의도된 공개 API) | 양호 |
| POST /api/auth/login | 불필요 | N/A | O | 10/min·IP | 계정단위 brute-force 방어 없음(P2) | 양호(열거방지 확인됨) |
| POST /api/auth/logout | 필요 | 본인 세션만 | - | - | - | 양호 |
| GET /api/auth/kakao/login, /callback | 불필요 | N/A | - | 없음 | **state 파라미터 없음 → OAuth 로그인 CSRF(P1)** | **개선 필요** |
| GET /api/auth/me | 필요 | 본인 정보만 | - | - | - | 양호 |
| POST /api/auth/password-reset/request 등 | 불필요 | N/A | O | 이메일당5/시간,IP당20/시간 | 계정열거 가능(P2, 의도됐을 가능성) | 재확인 필요 |
| GET/POST /api/garage/vehicles, PUT/DELETE /{id} | 필요 | **소유자만**(서버검증, 클라이언트 userId 무시) | O | 없음 | 낮음 | 양호 |
| GET /api/garage/vehicles/profile | 불필요(의도) | N/A(공개, 번호판 등 PII 제거) | - | - | 낮음 | 양호 |
| POST /api/garage/vehicles/{id}/verification | 필요 | **차량 소유자만** | 매직바이트+크기(4.2MB, 역직렬화 후 체크) | 없음 | 대용량 JSON DoS 소지(P1, 전역) | 대체로 양호 |
| GET .../verification/{id}/document | 필요 | **소유자 또는 관리자만** | - | - | 낮음(PII 이미지, 올바르게 보호됨) | 양호 |
| GET /api/admin/overview, /vehicle-verifications, POST approve/reject | 필요+ADMIN | **세션+DB 이중 role 재검증** | - | 없음, verifications는 페이지네이션도 없음(P3) | 낮음 | 양호 |
| GET/PATCH /api/admin/members, /actions | 필요+ADMIN | 이중 재검증 + 자기잠금 방지(409) | allow-list DTO(mass assignment 불가) | 없음 | 낮음 | 양호 |
| GET /api/vehicles | 불필요 | N/A(공개 데모 데이터) | - | - | `@CrossOrigin(localhost:3000)` 죽은 코드(무해) | 양호 |

**Node board-service (`/api/board/...`, `/api/parts/...`)**

| Method/Path | 인증 | 인가검사 | 입력검증 | Rate limit | 위험 | 판정 |
|---|---|---|---|---|---|---|
| GET/POST /api/board/posts, PUT/DELETE /:id | 필요(쓰기) | **author_id 서버검증**, 관리자 삭제는 별도 트랜잭션+사유필수 | O(길이/타입) | 작성에만 적용 | HTML sanitize 없음(현재는 프론트 textContent로 완화, P2 구조적 공백) | 양호 |
| POST /posts/:id/view, /:id/view(parts) | 불필요(의도) | N/A | - | **없음** | 조회수 어뷰징 가능(P3) | 개선 권장 |
| POST /posts/:id/comments, DELETE /comments/:id | 필요(쓰기) | **author_id 서버검증** | O | 작성에만 적용 | 위와 동일 sanitize 공백 | 양호 |
| POST/DELETE like·bookmark | 필요 | 세션 사용자 기준 | O(ON CONFLICT로 레이스 안전) | 없음 | 낮음 | 양호 |
| POST /posts/:id/report | 필요 | UNIQUE(user,post)로 중복방지 | O | **없음** | 다수 게시글 대상 신고 스팸 가능(낮음) | 개선 권장 |
| POST /images, GET /images/:id | 필요(업로드)/불필요(조회,의도) | 업로드시 소유 이미지ID만 첨부가능 | **매직바이트+3MB+MIME 화이트리스트** | 업로드에 적용 | 낮음 | 양호 |
| GET/PUT /profile, /profile/representative-vehicle | 필요 | 본인만(owner_id) | O | 없음 | 낮음 | 양호 |
| GET/POST/PUT/DELETE /garage/:id, vehicle records | 필요 | **owner_id 서버검증** | O | 없음 | 낮음 | 양호 |
| POST/DELETE /members/:id/guestbook | 필요 | 작성자 또는 차고주인만 삭제가능(의도된 설계) | O | 작성에 적용 | 낮음 | 양호 |
| GET /members/:id, /me | 필요/불필요 | 본인 정보 노출 범위 통제 | - | - | 낮음 | 양호 |
| /api/board/admin/* (overview,members,posts,reports,badges,logs) | 필요+ADMIN | **requireCurrentAdmin, 매 요청 DB role 재조회**(전체 라우터 게이팅) | O | 없음 | `logs` 엔드포인트가 문서·프론트 어디에도 없이 존재(P3, 고아 API) | 양호(단 테스트 없음, §13) |
| /api/parts/listings CRUD, favorite, view | 필요(쓰기)/불필요(조회) | **seller_id 서버검증** | O | **작성(POST)에 rate limit 없음(P2)** | **관리자 모더레이션 기능 자체가 없음(P2, 사기매물 삭제 불가)** | 개선 필요 |

**공통 발견**: 인증이 필요한데 인증 체크가 통째로 빠진 엔드포인트는 **발견되지 않음**. 모든 mutate 라우트가 소유권/역할을 서버에서 재검증(프론트 버튼 숨김에 의존하는 사례 없음). 가장 실질적인 개선 대상은 (1) Kakao OAuth state, (2) 부품장터 rate limit·모더레이션 공백, (3) 전역 body 크기 제한, (4) board-service 서버측 sanitize 안전망.

### 4. Secret / 환경변수 / Git 보안 — [완료]
- git 커밋 여부: 위에서 확인 완료 (.env, dump 파일 git 미포함).
- **compose/설정 파일에 하드코딩된 실제 secret 값 없음** — 전부 `${VAR}` 참조. 다만 `docker-compose.yml:98` `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-revcc}` — **약한 기본값 fallback**(유저명 `revcc`, DB명 `revcc`와 동일 패턴). 현재 로컬 `.env`에 `POSTGRES_PASSWORD=` 라인 자체가 없어 로컬 `postgres` 컨테이너는 **실제로 `revcc/revcc`로 기동 중**. 단, 앱의 실제 DB 연결(`DB_HOST` 등)은 이 로컬 postgres가 아니라 별도(Neon 추정) 인스턴스를 가리켜서 앱 트래픽 자체는 영향 없지만, 약한 기본 크리덴셜의 로컬 postgres 컨테이너가 `revcc-network`의 다른 모든 컨테이너에서 여전히 접근 가능한 채로 떠 있음.
- `docker-compose.prod.yml`은 `${POSTGRES_PASSWORD:?...}` 형태로 필수값 강제 — 올바르게 하드닝됨(단, §5 참고: 문서에서 이 파일 사용법이 안내되지 않음).
- **Redis는 완전히 무인증** — `requirepass`/ACL/`REDIS_PASSWORD` 자체가 존재하지 않음. 외부 미노출로 완화되지만 네트워크가 분리되어 있지 않아(§섹션5 네트워크) 컨테이너 침해 시 세션 데이터 전체 탈취 가능.
- `.env.example`이 **불완전** — `DB_HOST/PORT/NAME/USER/PASSWORD`, `POSTGRES_PASSWORD`, `KAKAO_CLIENT_ID/SECRET/REDIRECT_URI`, `SESSION_COOKIE_SECURE`, `REVCC_PORT` 등 실제 compose에서 쓰이는 변수들이 예시에 없음 — 새 기여자가 `.env.example`만 보고 `.env`를 만들면 앱이 기동 안 되거나 약한 기본값으로 조용히 fallback.
- 발견된 secret류 환경변수 이름 목록(값 아님): `DB_HOST/PORT/NAME/USER/PASSWORD`, `POSTGRES_PASSWORD`, `REDIS_HOST`(비밀번호 변수 자체가 없음=Redis 무인증 방증), `SMTP_HOST/PORT/USERNAME/PASSWORD/FROM/AUTH/STARTTLS`, `PASSWORD_RESET_SECRET`, `PASSWORD_RESET_URL`, `SESSION_COOKIE_SECURE`, `KAKAO_CLIENT_ID/SECRET/REDIRECT_URI`, `REVCC_PORT`, `GARAGE_PORT`.
- 백엔드/board-service 코드 상 모든 secret이 하드코딩이 아닌 env var로 소싱됨 확인 (`application.yml`/`application-prod.yml`, board-service `server.js`의 `pg` 표준 `PG*` 환경변수 + `PGSSLMODE`/`REDIS_URL`).

### 5. Docker / Nginx / 운영 보안 — [완료]
검사 파일: `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.garage.yml`, `docker-compose.override.yml`, `docker-compose.prod.yml`, `nginx/default.conf`, `assignment-frontend/nginx.conf`, 각 서비스 `Dockerfile`, `.env.example`.

**포트 노출 — 양호**: base(`docker-compose.yml`)에서 `proxy`만 호스트 노출(`${REVCC_PORT:-8090}:80`), `frontend/core/board/redis/postgres`는 `ports:` 자체가 없어 내부 네트워크에서만 접근 가능. `docker-compose.dev.yml`의 DB/Redis 노출은 `127.0.0.1` 루프백 한정 + 명시적 `-f` 플래그 필요(자동 적용 안 됨). `docker-compose.prod.yml`은 `ports:` 추가 없음. **Postgres/Redis가 인터넷에 노출된 적 없음 — 올바르게 구성됨.**

**[P1] `docker-compose.override.yml` 자동 적용 vs 문서 안내 불일치**
- override 파일은 `docker compose up`(플래그 없이) 시 **자동 병합**되어 `assignment-frontend` 소스를 컨테이너에 바인드마운트(정적 파일이라 RCE 위험은 낮음, 이미지 불변성 훼손 수준).
- `docker-compose.prod.yml` 헤더는 `-f docker-compose.yml -f docker-compose.prod.yml` 명시 사용을 안내(override 자동 배제, 올바른 설계).
- **그러나 `docs/DOCKER-SUBMISSION.md`의 "일반 실행" 섹션(22행)은 플래그 없이 `docker compose up -d --build --wait`만 안내** — 이 명령은 override가 자동 적용되어, 배포판(Docker Hub 이미지) 내용이 아니라 로컬 소스 파일이 서빙됨. `README.md`/`DOCKER-SUBMISSION.md` 어디에도 `docker-compose.prod.yml`이 언급되지 않음 — **repo에서 유일한 실질적 하드닝 계층(강제 POSTGRES_PASSWORD, secure 쿠키)이 문서에서 완전히 고아 상태**. 다만 두 문서 모두 "이것이 production-ready"라는 허위 주장은 하지 않음(정직하게 로컬 데모용으로 범위 한정).

**[P0] TLS(HTTPS) 종단 지점이 스택 어디에도 없음**
- `nginx/default.conf`, `assignment-frontend/nginx.conf` 둘 다 `listen 443 ssl`/`ssl_certificate` 없음 — 전부 평문 HTTP(8090). 이 상태로 인터넷에 공개하면 로그인 자격증명/세션 쿠키가 평문으로 전송됨.
- 이는 `application-prod.yml`의 `app.session.secure: true`(강제, 오버라이드 불가)와 충돌 위험 — TLS 없이 prod 프로파일을 쓰면 브라우저가 Secure 쿠키를 HTTP로 전송 거부 → **로그인 자체가 깨짐**. 외부 공개 시 반드시 TLS 종단(nginx cert 설정 또는 앞단 로드밴런서/CDN)이 추가로 필요하나 현재 repo에는 전혀 구성되어 있지 않음.

**[P2] Redis 무인증 + 네트워크 미분리**
- `docker-compose.yml:112-115`에 네트워크가 `revcc-network` 브리지 하나뿐 — frontend/core/board/redis/postgres 전부 같은 평면 네트워크. 계층 분리(frontend-tier/backend-tier/db-tier) 없음.
- Redis 무인증(§4) + 네트워크 미분리 조합 → 컨테이너 하나(예: 정적파일 서빙용 frontend nginx)가 침해되면 Redis(세션 전체) · Postgres(약한 기본 크리덴셜의 로컬 인스턴스)에 직접 도달 가능.

**[P2] restart 정책 전무**
- 5개 compose 파일 전체에서 `restart:` 지시자가 단 하나도 없음(grep 결과 0건). Healthcheck는 6개 서비스 전부 구성되어 있어 기동 순서는 보장되지만, **컨테이너 크래시나 호스트 재부팅 후 자동 재시작이 전혀 안 됨** — 무인 운영 환경에서는 실질적 공백.

**[P2] 온전한 rate limit이 애플리케이션 계층에만 존재**
- nginx 레벨에 `limit_req_zone`/`limit_conn_zone`이 전혀 없음 — 로그인/회원가입 rate limit은 전부 Spring 애플리케이션 레이어에서만 구현(주석상 명시). 앱 레이어 로직에 버그가 있으면 nginx가 최후 방어선 역할을 못 함.
- HSTS 헤더 없음(단 CSP의 `frame-ancestors 'none'`이 클릭재킹은 사실상 커버). `proxy_connect/read/send_timeout` 명시 설정 없음(기본값 60초로 동작).

**잘 구성된 부분**
- CSP, X-Content-Type-Options, Referrer-Policy, `client_max_body_size 5m` 등 nginx 엣지에 적용됨.
- `X-Real-IP`/`X-Forwarded-For`를 `$remote_addr` 기준으로 nginx가 직접 설정(스푸핑 불가, nginx가 실제 최외곽 홉이므로 안전).
- 컨테이너 하드닝: backend(`USER revcc`, uid 10001), board-service/frontend(`USER node`) 전부 비root 실행. `privileged: true`, Docker 소켓 마운트, 소스코드 런타임 바인드마운트(override 제외) 전부 없음. 모든 이미지 태그가 `latest` 아닌 버전 고정.
- `docker-compose.prod.yml`의 `${POSTGRES_PASSWORD:?err}` 강제 검증은 올바른 설계.

### 6. 데이터베이스 안정성 — [완료]
검사 파일: `backend/migrations/20260929_member_management.sql`, `board-service/src/schema.sql`, `backend/src/main/java/com/revcc/app/{User,Vehicle,VehicleVerification}.java` 및 repository/service/controller, `board-service/src/{app,server,community,market,moderation,admin,admin-access,owned-images,rate-limit,validation}.js`, `application{,-prod}.yml`, `docker-compose*.yml`. Flyway/Liquibase 없음 확인.

**[P0 후보] 스키마 소유권이 3원화되어 있음 (마이그레이션 관리 부재)**
- `users` 테이블 자체를 만드는 `CREATE TABLE`은 어디에도 없음. Hibernate `ddl-auto: update`(`application.yml:26`)가 `User.java`의 어노테이션으로 테이블을 생성/변형하고, `backend/migrations/20260929_member_management.sql`이 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`로 nickname/email/account_status/suspended_until/auth_version 추가, `board-service/src/schema.sql:3`이 또 `created_at`을 추가. 3개의 독립된 스키마 변경 경로가 한 테이블을 건드리는데 조정 장치가 없음.
- board-service는 **매 컨테이너 기동 시마다** `schema.sql`을 무조건 실행(`server.js:24-26`, BEGIN/COMMIT). 지금은 `IF NOT EXISTS` 가드로 멱등성이 유지되지만, 누군가 가드 없는 `ALTER TABLE`을 추가하는 순간 재기동 시 깨짐. 스키마 버전 이력 테이블이 전혀 없어 "이 마이그레이션이 이 환경에 적용됐는지" 추적 불가.
- 순서 의존성도 `docker-compose.yml`의 `depends_on: core: condition: service_healthy`에만 의존 — DB 레벨 강제가 아님. `board`만 단독 기동하면 `users` 테이블이 없어 `ALTER TABLE users`가 실패할 수 있음.
- 권장: Flyway/Liquibase 도입, `ddl-auto`는 `validate`로 전환(스키마는 검증만, 변형 금지).

**[P1 후보] 사용자 삭제 시 게시글/댓글 FK가 RESTRICT라 실질적으로 계정 삭제 불가능**
- `board_posts.author_id REFERENCES users(id)`, `board_comments.author_id REFERENCES users(id)` 모두 `ON DELETE` 절 없음 → Postgres 기본값 NO ACTION(RESTRICT). 게시글/댓글을 한 번이라도 쓴 계정은 `DELETE FROM users`가 FK 위반으로 실패.
- 반면 `owner_vehicles`, `community_images`, `board_likes`, `board_bookmarks`, `community_notifications`(user_id/actor_id), `community_reports.user_id`, `garage_guestbook`(owner_id/author_id), `parts_listings.seller_id`, `parts_favorites.user_id`, `member_profiles.user_id`는 전부 `ON DELETE CASCADE` — 일관성이 없음.
- 현재 백엔드/보드서비스 어디에도 "회원 탈퇴(하드 삭제)" 코드 경로 자체가 없음(`AdminMemberController`는 상태를 suspend/disable만 함) — 즉 지금 당장 터지는 버그는 아니지만, 나중에 회원탈퇴 기능을 추가하는 순간 (a) 게시글 있는 유저는 삭제가 막히거나 (b) 강제로 게시글부터 지우면 `garage_guestbook.owner_id ON DELETE CASCADE`로 인해 **타인이 내 차고에 남긴 방명록까지 연쇄 삭제**되는 등 예상 밖 부작용 발생.
- 신고(`community_reports.post_id ON DELETE CASCADE`)도 게시글 작성자가 본인 글을 하드 삭제(자진삭제, `moderation.js:30`)하면 처리 대기 중이던 신고 기록까지 함께 삭제됨 — 신고 회피 악용 가능성(중간 정도 심각도).

**[P2] 커넥션 풀 미설정**
- Spring: `application.yml`/`application-prod.yml`에 `spring.datasource.hikari.*` 설정이 전혀 없음 → Hikari 기본값(`maximum-pool-size=10`) 그대로 운영.
- board-service: `server.js:7-11`의 `pg.Pool({ ssl: ... })`에 `max`/`idleTimeoutMillis`/`connectionTimeoutMillis` 전부 미설정 → `connectionTimeoutMillis` 기본값 0(무제한 대기)이라 풀 고갈 시 요청이 즉시 실패하지 않고 무한 대기 → 장애 시 빠른 503 대신 요청 적체로 이어질 위험.
- 운영 DB가 Neon(서버리스 Postgres, 커밋 `66396be`)인데 Spring 10 + Node 10=20 커넥션이 Neon 플랜의 동시 연결 한도 대비 적절한지 코드상 확인/검증된 바 없음.

**[P2] 무제한 조회(pagination 누락)**
- `AdminController.java:46-51` `GET /api/admin/vehicle-verifications` → `findAllByOrderByIdDesc()`, Pageable 없이 전체 반환. 차량 인증 신청이 쌓이면 문제.
- `PasswordMigrationRunner.java:30` `users.findAll()` — 앱 기동할 때마다(1회성 의도지만 매 배포마다 재실행) 전체 유저 로드.

**잘 구현된 부분 (근거 있음, 수정 불필요)**
- 좋아요/댓글수/즐겨찾기수는 별도 카운터 컬럼 없이 매번 `SELECT COUNT(*)` 서브쿼리로 계산(`community.js:36-44`, `market.js:16-19`) — read-modify-write 레이스 자체가 없음.
- 조회수는 원자적 `UPDATE ... SET views=views+1`(`community.js:213-215`, `market.js:186-188`).
- 좋아요/즐겨찾기/북마크 토글은 `INSERT ... ON CONFLICT DO NOTHING` / `DELETE` 패턴(`community.js:244-253`, `market.js:174-183`) — 레이스에 안전.
- 회원가입/이메일 중복은 애플리케이션 체크(`existsByUsername`)에만 의존하지 않고 DB unique 제약 + `try/catch(DataIntegrityViolationException)`으로 이중 방어(`AuthController.java:46-55`, `AdminMemberController.java:82-83,110-111`).
- 로그인/카카오 계정생성/관리자 회원수정에 비관적 락(`PESSIMISTIC_WRITE`) 사용(`UserRepository.java:13-22`, `AuthController.java:59-76,95-124`, `AdminMemberController.java:76`) — 동시 로그인/중복 계정생성 레이스 방지.
- `moderation.js`의 `deleteContent`(5-40행)는 `BEGIN` → `SELECT ... FOR UPDATE` → 커밋/롤백을 명시적으로 수행하는, 이 코드베이스에서 가장 잘 짜인 동시성 처리(두 관리자가 동시에 같은 글 삭제하는 레이스 방지).
- 댓글 작성+알림 발송이 CTE 하나(`WITH target AS(...), inserted AS(...) INSERT`)로 원자적 처리(`community.js:271-285`).
- 게시글/마켓/관리자 목록은 전부 LIMIT/OFFSET 페이지네이션(최대 100건 캡), 방명록은 커서 기반 keyset pagination(`community.js:348-357`) — 가장 확장성 좋은 패턴.
- `@EntityGraph`로 N+1 명시적 방지(`GarageVehicleRepository.java:10-15`, `VehicleVerificationRepository.java:9-14`).

**경미한 이슈**: `AuthController.refreshKakaoNickname()`(115-124행)은 `existsByUsername` 체크 후 락/트랜잭션 보호 없이 `saveAndFlush` — 동시에 같은 닉네임으로 카카오 로그인하는 두 요청이 경합하면 진 쪽이 `DataIntegrityViolationException`을 캐치 없이 던져 500 발생(닉네임 동기화에 한정된 좁은 범위, 낮은 심각도).

### 7. Redis 분석 — [완료]
- **용도**: 세션 저장이 유일한 용도(캐싱/카운터 사용 없음). 키 `revcc:session:<token>`, 값은 `{id,username,role,authVersion}` JSON — Spring이 쓰고 Node가 그대로 읽는 **명시적 공유 계약**(양쪽 코드 주석에 문서화됨).
- **TTL**: 생성 시 30분 고정, 활동에 따라 갱신되지 않는 non-sliding 방식(의도된 설계, `SharedSessionService.require()`가 재설정하지 않음 확인).
- **세션 정리**: 로그아웃 시 `redis.delete()`로 즉시 삭제 확인. 계정 정지/비번변경 시 Redis 값 자체를 지우지 않고 `authVersion` 불일치로 양쪽 서비스가 매 요청마다 거부(사실상 즉시 무효화, TTL 만료 전에도 효과적).
- **인증 없이 접근 가능**: Redis에 `requirepass`/ACL이 전혀 설정되어 있지 않음(Spring/Node 코드 어디에도 Redis 비밀번호 설정 없음). **외부 미노출(포트 매핑 없음)로만 완화됨** — 컨테이너 침해 시 세션 전체 탈취 가능(§5).
- **Redis 장애 시 동작**: board-service는 **fail-closed**(조회 실패 시 503, 인증 우회 안 됨 — 안전한 설계). Spring 쪽 장애시 동작은 별도로 깊게 검증되지 않았으나 세션 조회 자체가 Redis 의존이라 마찬가지로 인증 불가 상태가 될 것으로 추정(fail-closed 방향, 가용성 저하는 있으나 보안 우회는 없음).
- **메모리 무한 증가 가능성**: 세션 키는 TTL 30분이 있어 자연 만료됨 — 무한 증가 위험 낮음. (반면 Spring의 in-memory rate-limit 맵은 Redis가 아니라 애플리케이션 힙에 쌓이며 정리되지 않음 — §2-B 참고, 별개 이슈.)
- **재시작 시 영향**: Redis 재시작 시 모든 세션 유실 → 전체 사용자 강제 로그아웃(별도 영속화 없음, 세션 스토어의 일반적 특성). 컨테이너 healthcheck는 있으나 `restart:` 정책이 없어(§5) 크래시 후 수동 개입 필요.

### 8. 프론트엔드 분석 (assignment-frontend) — [완료]
- **실제 배포되는 프론트엔드는 `assignment-frontend`(순수 HTML/CSS/JS)임을 확인**. 별도의 `frontend/`(Next.js)는 기본 compose에 연결되지 않은 실험적 "My Garage" 기능으로, 실제 서비스 화면이 아님(`frontend/app/page.tsx`는 mock 데이터·클라이언트단 가짜 인증만 사용).
- **Stored/DOM XSS: 발견 없음.** `innerHTML` 사용은 단 2곳(`admin.js:76` 빈 문자열 클리어, `footer.js` 완전 정적 템플릿)뿐이고, 사용자 생성 콘텐츠(게시글/댓글/닉네임/차량정보/장터글/방명록)는 전부 공통 `el(tag, text)` 헬퍼를 통해 `textContent`로만 렌더링됨 — 일관되고 의도적인 안전 패턴. nginx CSP(`script-src 'self'`)가 추가 방어선.
- **하드코딩된 endpoint 없음** — `localhost`/포트/절대경로 grep 0건, 전부 상대경로 fetch(`/api/...`) + nginx 프록시 의존 → 도메인 무관하게 동작.
- **클라이언트단 권한 처리**: 관리자 화면은 매 로드시 `/api/board/me` 서버 응답으로 role을 확인(캐시된 값 신뢰 안 함), localStorage에 권한/역할 정보를 저장하는 곳 없음(최근 본 글/매물 캐시만 존재) — "버튼 숨기기만 보안으로 인정하지 말 것"이라는 요구사항 기준으로도 실제 서버측 재검증이 확인됨(§2-B AdminController의 이중 role 재검증과 일치).
- **잠재적 landmine(현재는 미발현)**: `app.js`/`admin.js`/`home.js`가 각각 최상위 `const $ = ...` 등을 **IIFE로 감싸지 않고** 중복 선언 — 현재는 한 페이지에 두 스크립트가 동시 로드되지 않아 문제없지만, 향후 페이지 개편 시 두 스크립트가 같이 로드되면 `SyntaxError`로 전체 스크립트가 죽을 수 있음.
- **DOM selector 미방어 소수 존재**(`app.js:252-254`, `notify()`) — 현재 로드되는 페이지 조합에서는 문제없지만 공유 JS 파일과 개별 HTML이 독립적으로 수정되면 깨질 수 있는 암묵적 계약.
- **에러처리/로딩**: 버튼 이중클릭 방지(`disabled` 처리) 광범위 적용, 최상위 async 흐름에 `.catch()` 존재. 단 `api()` 헬퍼가 `fetch()` 자체를 try/catch하지 않아 네트워크 완전 단절 시 브라우저 기본 영문 에러 메시지가 그대로 노출(예: "Failed to fetch") — 사소한 UX 공백.
- **로그인 상태 race**: 세션 확인이 API 호출 기반이라 페이지 로드 직후 짧게 "로그아웃 상태" 헤더가 보였다가 로그인 상태로 바뀌는 flash 발생(불가피한 설계 트레이드오프, 명시적 스켈레톤 없음). 교차 스크립트 레이스는 요청 토큰 비교로 방지되어 있음(양호).
- **뒤로가기/새로고침**: 게시글/장터 에디터는 `beforeunload` 가드 + baseline dirty-check로 데이터 유실 방지, 저장 후 실제 페이지 이동(location.assign)이라 back+재제출 문제 없음. 비밀번호 재설정 흐름은 bfcache 복원 시 강제 새로고침으로 stale 상태 방지(의도적).
- **접근성/모바일**: alt 속성, label 연결 전반적으로 양호. 최근 커밋으로 모바일 반응형 다수 보강됨. `my-garage-card.css`만 미디어쿼리 없음(작은 위젯, 낮은 심각도).
- **데드코드**: `garage/index.html`은 nginx가 `/home`으로 302 리다이렉트해 **실질적으로 도달 불가능한 orphan 페이지**(이미지는 여전히 빌드됨). `app.js` 내 "부품 호환성"(`#vehicle-select`, `#compatibility`) 관련 코드가 현재 어떤 HTML에도 없는 DOM ID를 참조 — 이전 기능의 잔여 코드로, silent no-op이라 에러는 안 나지만 삭제 후보.

### 9. 기능 누락 및 UX 문제 — [완료]
- **화면은 있는데 서버 모더레이션이 없는 기능**: 부품 장터(`market.js`)는 게시글/댓글과 달리 관리자가 사기/어뷰징 매물을 삭제할 방법이 코드상 없음 — 커뮤니티 신고·모더레이션 체계가 장터에는 이식되지 않음. 실거래를 전제로 한다면 배포 전 반드시 필요한 기능 공백(단순 "있으면 좋은 기능"이 아니라 실거래 안전을 위한 최소 요건).
- **API는 있는데 화면/문서에서 안 쓰는 기능**: board-service `/api/board/admin/logs`가 구현·마운트되어 있으나 `docs/ADMIN-OPERATIONS.md`와 프론트 어디에도 참조가 없는 "고아 API".
- **도달 불가능한 화면**: `garage/index.html`이 nginx 리다이렉트로 막혀 있음(§8) — 오래된 차고 UI가 `home/index.html`로 완전히 대체된 것으로 보이나 빌드 산출물엔 남아있어 혼동 소지.
- **로그인하지 않은 사용자 예외처리**: Spring/Node 양쪽 다 비인증 요청에 401을 일관되게 반환하고 프론트도 `requireLogin()` 가드로 처리 — 이 부분은 양호.
- **부품 직거래 장터의 "실거래에 필요한 최소 기능" 관점**: 관리자 모더레이션 부재 외에, 거래 완료/후기/정산 등 실거래 보증 장치는 에이전트 조사 범위에서 확인되지 않음(현재 CRUD+상태관리 수준) — 실거래 플랫폼으로 공개한다면 사기 신고/차단 프로세스가 가장 먼저 필요.
- **빈 상태(empty state)/401·403·404·500 처리**: 프론트가 `Promise.allSettled` + 위젯별 "불러오지 못했어요" 재시도 UI를 갖추고 있어(에이전트5 확인) 전반적으로 양호한 편. 다만 `api()`가 순수 네트워크 실패 시 브라우저 기본 에러 문자열을 그대로 노출하는 점은 다듬을 여지 있음.

### 10. 동시성 / 실사용 환경 — [완료]
- **좋아요/북마크 동시 클릭**: `INSERT...ON CONFLICT DO NOTHING`/`DELETE` 패턴으로 레이스 안전(양호).
- **동시 댓글 작성**: 카운트가 서브쿼리로 실시간 계산되고 댓글+알림이 CTE 하나로 원자 처리 — 안전.
- **게시글 삭제 중 댓글 작성 레이스**: `moderation.js`의 `deleteContent`가 `BEGIN`+`SELECT...FOR UPDATE`로 명시적으로 방어(에이전트4가 "가장 잘 짜인 동시성 코드"로 평가) — 양호.
- **동일 계정 동시 로그인/회원가입**: 비관적 락(`PESSIMISTIC_WRITE`)과 DB unique 제약 + `DataIntegrityViolationException` 캐치로 이중 방어, 동시 가입 레이스 테스트로 검증됨(`MemberFlowIntegrationTest.concurrentSignupCreatesOnlyOneAccount`).
- **차량정보 동시 수정**: 소유권 검사는 되어 있으나(§2-B) 낙관적 락(버전 컬럼) 등 동시 수정 시 마지막 쓰기가 이기는 전형적 lost-update 가능성은 별도 방지 장치 확인 안 됨(낮은 실사용 빈도로 심각도는 낮음).
- **카카오 닉네임 동기화 레이스**: `AuthController.refreshKakaoNickname()`이 체크 후 락 없이 저장 — 동시에 같은 닉네임으로 충돌 시 진 쪽이 캐치되지 않은 예외로 500(좁은 범위, 낮은 심각도, §6 참고).
- **Redis 재시작**: 전체 세션 유실 → 사용자 전원 강제 로그아웃(예상된 동작, 영속화 없음). **`restart:` 정책이 없어 재시작 자체도 자동으로 이뤄지지 않음**(§5, 운영상 더 큰 문제).
- **Node/Spring 재시작**: board-service는 재기동 시마다 `schema.sql`을 무조건 재실행 — 가드가 깨지면(§6) 재기동 자체가 실패할 수 있는 취약한 지점.
- **PostgreSQL 일시 장애**: 커넥션 풀 타임아웃이 board-service 쪽에 설정되어 있지 않아(§6, `connectionTimeoutMillis` 기본 0=무제한 대기) 장애 시 빠른 실패 대신 요청이 무한정 쌓일 위험.
- **브라우저 새로고침/API timeout**: 프론트는 에디터 dirty-check와 실제 페이지 이동 방식으로 중복 제출 위험이 낮음(§8).

### 11. 성능 문제 — [완료]
**지금 수정하면 좋은 것**:
- board-service `pg.Pool()`에 `connectionTimeoutMillis` 미설정(기본 무제한) — 명시적 타임아웃(예: 5000ms) 설정 권장, 장애 시 빠른 503 확보.
- `AdminController.verifications()`(Spring)와 board-service `/api/board/admin/logs`류는 페이지네이션 적용된 다른 admin 목록과 달리 무제한 조회 — 현재 데이터량은 적어 급하지 않으나 값싸게 고칠 수 있는 항목.

**사용자가 늘면 수정할 것**:
- Hikari/pg 풀 크기가 전혀 튜닝되지 않음(기본값 그대로) — 운영 DB가 Neon(서버리스, 커밋 이력상 확인)이라 동시 연결 한도와 실제 필요량을 검증한 적이 없음.
- `moderation_logs` 테이블에 인덱스가 전혀 없고 관리자 검색이 `ILIKE '%...%'`(인덱스 활용 불가, append-only) — 로그가 쌓이면 검색 성능 저하.
- Hibernate `ddl-auto:update` + 3원화된 스키마 변경 경로(§6) 자체가 스키마 변경 시 안전성 문제로 이어질 수 있음 — 사용자/데이터가 늘수록 위험도 증가.
- 정적 파일 캐싱/gzip·brotli 여부는 이번 조사에서 nginx 설정에 명시적 `gzip`/캐시 헤더 지시자가 확인되지 않음(Cache-Control: no-store가 오히려 API 응답 등에 전역 적용된 것으로 보임) — 트래픽이 늘면 정적 자산(CSS/JS/이미지)에 대해서는 별도로 장기 캐시 헤더+gzip 적용 검토 필요(이번 조사에서 nginx 설정 파일 전체 재확인까지는 못함, **미확인** 항목으로 남김).
- N+1은 현재 `@EntityGraph`로 잘 방지되어 있으나, 이 어노테이션이 실수로 제거되면 즉시 회귀할 수 있는 구조 — 리그레션 테스트/코드리뷰 체크포인트로 남겨둘 만함.

**과도한 최적화(지금 불필요)**: board-service의 카운트 서브쿼리 방식(좋아요/댓글수)은 현재 스케일에서 충분히 빠르고 레이스에도 안전 — 데이터가 매우 커지기 전까지 비정규화 카운터 컬럼 도입은 불필요.

### 12. 로그 / 모니터링 / 장애 대응 — [완료]
- **Spring 로그**: 민감정보 보호에 특히 신경 씀 — `org.hibernate.orm.jdbc.bind: OFF`를 명시적으로 설정(주석: "요청/응답 body에 비밀번호와 1회용 재설정 코드가 포함될 수 있음"), 메일 실패 로그는 화이트리스트 방식(`SafeMailFailure`)으로만 카테고리/예외클래스명/SMTP 상태코드만 남기고 실제 주소/자격증명은 절대 노출 안 함(테스트로 검증). 비밀번호 필드는 `toString()` 오버라이드로 `[redacted]`.
- **예외 스택트레이스 노출**: 발견되지 않음 — Spring 기본 `/error` 핸들링(트레이스 미포함) 또는 두 개의 스코프된 `@RestControllerAdvice`를 통해 안전하게 처리. 다만 `AuthController`/`AdminController`/`VehicleVerificationController`는 전용 advice가 없어 에러 응답 형태가 다른 컨트롤러와 다를 수 있음(정보노출은 아니고 일관성 문제).
- **Node 로그**: `morgan` 의존성 존재(package.json) — 요청 로깅은 되고 있는 것으로 보이나, 별도의 민감정보 필터링 로직은 board-service 조사에서 특별히 확인되지 않음(양호/불량 판단을 위해서는 morgan 포맷 설정을 별도 확인 필요, **미확인**).
- **Nginx access/error log**: 별도 조사 범위에서 상세 확인 안 됨(**미확인**) — 기본 nginx 로그 포맷 사용으로 추정.
- **로그인 실패 기록**: 별도의 실패 로그인 이력 테이블/카운터는 확인되지 않음(rate limit은 있으나 감사로그 목적의 실패기록 저장은 아님).
- **관리자 작업 기록**: **잘 구현됨** — `moderation_logs` 테이블이 의도적으로 FK 없이 불변 스냅샷으로 설계되어(주석으로 명시) 콘텐츠/계정이 나중에 삭제돼도 감사기록이 살아남음. 삭제 사유(reason) 필수 입력.
- **healthcheck**: docker-compose.yml의 6개 서비스 전부 healthcheck 블록 보유, `depends_on: condition: service_healthy`로 기동 순서 보장 — 양호. 단 **`restart:` 정책이 어디에도 없어(§5) 장애 자동복구는 안 됨** — healthcheck는 "탐지"는 하지만 "대응(재시작)"으로 이어지지 않는 반쪽짜리 구성.
- **서비스/DB/Redis 장애 탐지**: healthcheck 수준의 탐지는 있으나, 알림(Slack/이메일 등 외부 모니터링 연동)은 이번 조사 범위에서 발견되지 않음 — 별도의 모니터링 스택(Prometheus/Grafana, Sentry 등) 부재.

### 13. 테스트 분석 — [완료]
- **Spring(backend)**: 16개 클래스, 1027줄. 인증 성공/실패, 계정열거 방지, **IDOR(다른 사용자 차량 수정/삭제, 차량인증 제출/열람)**, 관리자 role 이중검증, mass-assignment 방지, 세션무효화(비번변경/정지 시 전 세션 킬), rate limit, 동시가입 레이스, BCrypt 마이그레이션, 메일 발송/실패시 로그 안전성까지 — **보안 관점에서 매우 촘촘함**. 14/16개는 순수 유닛테스트(Mockito/MockMvc, 인프라 불필요), 2개(`MemberFlowIntegrationTest`, `PasswordResetServiceTest`)는 실제 Postgres/Redis가 필요한 통합테스트지만 환경변수 미설정 시 **자동 스킵**(빌드 실패 아님) — CI에서 인프라 없이도 안전하게 돌릴 수 있음.
  - **공백**: OAuth state 미검증에 대한 테스트 없음(기능 자체가 없어서), 비밀번호 최소길이 거부 테스트 없음(제약 자체가 없어서), 전역 body 크기 제한 테스트 없음(제약 자체가 없어서), rate-limit 맵의 IP 스푸핑/메모리누수 테스트 없음.
- **Node(board-service)**: 4개 파일(`app`, `community`, `rate-limit`, `session-revocation`), 전부 **인메모리 가짜 db/redis 주입** 방식이라 실제 인프라 없이 완전히 빠르게 동작(`node --test`). 세션 스푸핑 방지(클라이언트 authorId 무시), 소유권 위반 시 403(게시글/댓글/차고), 이미지 위변조 거부, 세션 무효화(정지/탈퇴 즉시 반영) 등을 테스트.
  - **공백**: **`market.js`(부품장터) 테스트가 전무** — 다른 판매자 매물 수정/삭제 IDOR 테스트 없음. **`admin.js`/`admin-access.js` 인가 테스트도 전무** — 비관리자 403, 강등된 관리자 거부 같은 실제로는 잘 구현된 로직이 테스트로 보호되지 않고 있음(회귀 위험). `moderation.js`도 "관리자 아님→403" 경로만 테스트되고 정상 삭제 성공 경로는 테스트 없음.
- **XSS/인젝션 전용 테스트**: 백엔드/board-service 어디에도 "HTML이 이스케이프되는지" 자동 검증하는 테스트는 없음(현재 안전성은 프론트 `textContent` 관례에 의존 — 회귀 안전망 없음).
- **CI**: `.github/workflows` 디렉터리 자체가 없음 — **테스트를 자동으로 돌리는 CI가 전혀 없다.** 테스트 실행은 전부 수동/로컬(Dockerfile이 빌드시 테스트를 실행한다는 문서상 주장은 이번 조사에서 Dockerfile RUN 단계까지는 직접 확인 안 됨, **미확인**).
- **배포 전 우선순위별로 추가해야 할 테스트**:
  1. (P1) board-service `admin.js`/`admin-access.js` 인가 테스트 — 이미 구현된 로직을 회귀로부터 보호.
  2. (P1) board-service `market.js` IDOR 테스트(다른 판매자 매물 수정/삭제 시도).
  3. (P2) CI 파이프라인 구성(GitHub Actions 등)으로 기존 1000줄+ 테스트를 자동 실행.
  4. (P2) moderation.js 관리자 정상삭제 성공 경로 테스트.
  5. (P3) XSS 회귀 방지용 렌더링 계층 스냅샷/이스케이프 테스트(현재 안전하지만 회귀 감지 수단 없음).

### 14. 죽은 코드 / 레거시 분석 — [완료]
- **TODO/FIXME 등**: 전체 저장소에서 단 1건(`VehicleVerification.java:29`, 승인 후 원본 파기 배치 추가 예정 — 의도된 향후 작업 메모, 방치 흔적 아님).
- **대규모 주석처리 코드**: 발견되지 않음(Java/JS/프론트 전체 스캔).
- **OAuth/카카오 코드**: 죽은 코드 아님 — 실제로 살아서 쓰이고 있음(`assignment-frontend/auth/index.html`에 카카오 버튼과 아이디/비번 폼이 **둘 다 현재 살아있음**, 문서 `docs/DOCKER-SUBMISSION.md:71`의 "카카오 버튼만 제공한다"는 서술은 **현재 코드와 불일치하는 낡은 문서**).
- **`docker-compose.garage.yml`**: 잊혀진 파일이 아니라 README/docs에 "선택적 애드온"으로 문서화된 현재진행형 실험 기능. 단, 메인 6-컨테이너 과제 제출 범위엔 포함 안 됨.
- **compose ↔ 디렉터리 1:1 매핑**: `backend/board-service/assignment-frontend/nginx`는 정확히 기본 compose 서비스 4개와 1:1 대응. **`frontend/`(Next.js)는 기본/운영 compose 어디에도 연결되지 않은 사실상 죽은 인프라**(garage 오버레이로만 도달 가능, 그마저도 nginx를 우회해 :3000 직접 노출).
- **board-service 고아 엔드포인트**: export된 라우트 핸들러 중 미마운트된 것은 없음(전수 확인). 단 `/api/board/admin/logs`는 마운트되어 실제로 살아있지만 **문서와 프론트 어디서도 호출하지 않는 "UI 고아" API**(기능은 살아있음, 활용되지 않음).
- **프론트 데드코드**: `garage/index.html`(nginx가 `/home`으로 강제 리다이렉트, 도달 불가), `app.js`의 "부품 호환성" 관련 코드(`#vehicle-select`, `#compatibility` — 어떤 HTML에도 없는 DOM ID 참조, 이전 장터 구현의 잔여물). JS 파일 중 완전히 미사용인 파일은 없음(전부 최소 1개 HTML에서 로드됨).
- **문서-코드 불일치(오래된 문서)**: `ASSIGNMENT.md:161`("Java 테스트 2+3개 통과")은 현재 16개 클래스/1000줄+ 규모보다 훨씬 이전 스냅샷 — 실제보다 과소평가된 낡은 기록. `docs/AUTH-UI.md`("닉네임/이메일 컬럼 없음")도 이후 추가된 회원관리 기능으로 이미 대체된 서술.

### 15. 최종 등급별 정리 (P0~P3) — [완료]
(전체 findings는 최종 답변 본문에 상세 서술. 목록/ID만 여기 기록)

**P0 (즉시 수정)**
- P0-1: Kakao OAuth `state` 파라미터 부재 → 로그인 CSRF/계정 혼동 (backend AuthController.java:96-113, KakaoOAuthService.java:34-39)
- P0-2: 스택 전체에 TLS 종단 지점 없음(평문 HTTP) → 외부 공개 시 자격증명/세션쿠키 평문 노출 (nginx/default.conf, assignment-frontend/nginx.conf)

**P1 (배포 전 수정)**
- P1-1: 비밀번호 최소 길이 제한 없음 (AuthController.java:143, PasswordResetController.java:16)
- P1-2: 전역 요청 본문 크기 제한 없음 → 메모리 고갈 DoS (application.yml/application-prod.yml)
- P1-3: 스키마 소유권 3원화(Hibernate ddl-auto:update + 수동 마이그레이션 + board-service 매 부팅 schema.sql) — 마이그레이션 이력 관리 부재
- P1-4: 부품 장터(market.js)에 관리자 모더레이션 기능 전무 → 사기/어뷰징 매물 삭제 불가
- P1-5: docker-compose.override.yml 자동적용으로 인해 문서(`DOCKER-SUBMISSION.md`)대로 실행 시 `docker-compose.prod.yml` 하드닝이 적용되지 않음
- P1-6: board-service `admin.js`/`admin-access.js`, `market.js` 인가 로직에 대한 자동 테스트 전무(회귀 보호 없음)
- P1-7: CI 파이프라인 부재(.github/workflows 없음) — 1000줄+ 기존 테스트가 전혀 자동 실행되지 않음

**P2 (빠른 시일 내 개선)**
- P2-1: 비밀번호 재설정 요청에서 계정 존재여부 열거 가능(의도된 UX 트레이드오프로 보이나 재확인 필요)
- P2-2: Rate limit이 IP 기준만 존재, 계정단위 brute-force 방어 없음 + Spring RateLimitFilter 메모리 누수
- P2-3: board-service 서버측 HTML sanitize 부재(현재 프론트 textContent로 완화되나 구조적 방어망 없음)
- P2-4: 부품장터 글 작성(POST)·조회수 증가·신고 엔드포인트에 rate limit 없음
- P2-5: Redis 무인증 + Docker 네트워크 미분리(단일 flat bridge)
- P2-6: 로컬 postgres 컨테이너 약한 기본 크리덴셜(`POSTGRES_PASSWORD:-revcc`)
- P2-7: Hikari/pg 커넥션 풀 전혀 튜닝 안 됨(board-service `connectionTimeoutMillis` 기본 무제한)
- P2-8: 전 서비스에 `restart:` 정책 없음(healthcheck는 있으나 자동복구 없음)
- P2-9: `.env.example`이 실제 사용되는 다수 환경변수를 누락
- P2-10: nginx에 요청 rate limit(`limit_req_zone`) 없음, HSTS 헤더 없음
- P2-11: 회원 삭제 시 게시글/댓글 FK가 RESTRICT라 사실상 탈퇴 불가능 + 방명록 CASCADE 부작용(향후 탈퇴기능 구현 시 반드시 재검토)

**P3 (장기 개선)**
- P3-1: `AdminController.verifications()`, board-service 일부 admin 목록 페이지네이션 없음
- P3-2: `moderation_logs` 테이블 인덱스 없음(현재는 무관, 로그 누적 시 검색 저하)
- P3-3: `garage/index.html` 도달 불가능한 orphan 페이지, `app.js`의 부품 호환성 데드코드
- P3-4: board-service `/api/board/admin/logs`가 문서·프론트 어디서도 쓰이지 않는 고아 API
- P3-5: 문서-코드 불일치(ASSIGNMENT.md 낡은 테스트 통계, DOCKER-SUBMISSION.md의 "카카오 버튼만 제공" 서술이 실제와 다름, AUTH-UI.md 낡은 서술)
- P3-6: 카카오 닉네임 동기화 레이스(uncaught exception → 500, 좁은 범위)
- P3-7: `VehicleController`에 남은 dev용 `@CrossOrigin(localhost:3000)` 죽은 코드
- P3-8: 모니터링/알림 스택(Sentry, Prometheus 등) 부재 — healthcheck 탐지만 있고 알림 연동 없음
- P3-9: XSS 회귀 방지용 자동 테스트 없음(현재 안전하나 안전망 없음)

### 16. 마지막 요약 (A~G, 배포단계 판단) — [완료]
- 최종 답변 본문에 상세 서술.

---
## 작업 완료
2026-09-29 세션에서 전체 16개 섹션 분석 완료. 모든 서브에이전트 조사 완료, 최종 보고서를 사용자에게 답변으로 전달함. 코드 수정 없음(분석 전용 요청 준수).

---

## 다음 세션이 할 일 (이 세션이 중단된 경우)
1. 이 파일의 "서브에이전트 상태" 표를 확인하고, 아직 결과를 받지 못한 에이전트가 있다면 완료 알림을 기다리거나 상태를 재확인.
2. 이미 [완료]로 표시된 섹션은 재조사하지 말 것.
3. [진행중] 섹션부터 순서대로 이어서 채울 것.
4. 모든 섹션이 채워지면 15번(P0~P3), 16번(요약) 작성.
