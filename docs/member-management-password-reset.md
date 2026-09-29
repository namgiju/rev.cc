# 회원 관리와 비밀번호 재설정

## 구현 범위와 사용법

기존 순수 HTML/CSS/JS 화면, Spring/JPA, BCrypt, PostgreSQL 연결 설정과 공유 Redis를 유지한다. 추가 의존성은 Spring Boot의 SMTP starter뿐이다.

- `/admin` → **회원 관리**: 아이디·닉네임·이메일 검색, 상태 필터, 20명 단위 서버 페이지네이션. 아이디 버튼으로 상세 창을 연다.
- 닉네임·이메일·계정 상태·권한·정지 종료일을 저장할 수 있다. 비밀번호 직접 편집은 없다.
- 이메일은 trim/소문자 정규화하며 중복을 허용하지 않는다. 관리자는 주소 소유자를 확인한 후 등록/변경해야 한다.
- 기존 회원의 이메일과 닉네임은 NULL로 보존한다. 신규 가입은 선택적 이메일 입력을 지원하며 기존 username/password API 요청도 계속 동작한다.
- 닉네임은 별도 관리 필드이며 기존 게시판 표시 이름(username)은 변경하지 않는다.
- 최근 로그인 정보는 기존 DB에 없어 표시하지 않는다. 알 수 없는 가입일은 그대로 NULL/“기록 없음”이다.
- ACTIVE: 정상, DISABLED: 비활성, SUSPENDED: 무기한 또는 종료일 지정 정지. 종료일이 지나면 로그인 가능하며 상태 필터에는 기록된 SUSPENDED가 남는다.
- 자신의 계정을 정지하거나 관리자 권한을 낮추는 변경은 차단한다.
- 저장으로 실제 변경이 발생하면 모든 기존 세션과 진행 중인 재설정 권한을 무효화한다. 본인 정보를 수정한 관리자도 다시 로그인해야 한다.
- 상세 창의 **비밀번호 재설정 메일 발송**은 등록된 이메일로 인증번호를 요청한다. 카카오 전용 계정과 이메일 미등록 계정에는 제공하지 않는다.
- 회원 상세에서 최근 50건의 감사 기록을 확인한다. 기존 게시물 삭제 운영 로그는 유지한다.

## 사용자 재설정 흐름

`/login`의 “비밀번호를 잊으셨나요?” → `/password-reset` → 아이디와 이메일 입력 → 6자리 코드 발송 → 코드 검증 → 10분짜리 reset token 발급 → 새 비밀번호/확인 입력 → BCrypt 저장 및 세션 무효화 → `/login?reset=1`에서 “비밀번호가 변경되었습니다. 다시 로그인해주세요.” 표시.

인증번호는 SecureRandom으로 생성한다. Redis에는 이메일 및 코드의 HMAC 검증값을 사용하고, 재설정 토큰은 256비트 난수다. 코드 검증·삭제는 Lua로 원자 처리하고 토큰은 GETDEL로 한 번만 소모한다. DB 반영 전에 토큰을 소모하므로 DB 실패 시 새 인증이 필요하다. 서로 다른 유효 토큰의 동시 사용도 사용자 행 잠금과 auth_version 비교로 한 번만 비밀번호를 바꾼다. 비밀번호 정책은 기존 가입과 동일하게 공백만 입력 불가, 최대 255문자 및 UTF-8 72바이트다.

SMTP 전송은 제한된 작업 큐(2 스레드/100 대기)에서 비동기로 처리하여 이메일 존재 여부에 따라 SMTP 응답 시간이 노출되지 않도록 했다. 계정 확인 결과는 code/message로 구분하며, 실제 메일 전송 구조는 유지한다. 발송 요청 응답은 실제 수신 성공을 보장하지 않는다. SMTP 실패 시 수신자/본문/예외 원문 없이 고정 오류 분류, 예외 클래스명, 숫자 SMTP 상태 코드만 남긴다. 큐는 영속 큐가 아니므로 재시작 중 요청은 재발송이 필요할 수 있다.

## API

| Method | Path | 내용 |
|---|---|---|
| GET | `/api/auth/check-username?username=...` | 실제 DB 중복확인, `{available}` 응답, 캐시 금지 |
| GET | `/api/admin/members?q=&field=username&status=&page=1` | 검색/목록, field=username/nickname/email, pageSize=20 고정 |
| GET | `/api/admin/members/{id}` | 회원 DTO, 비밀번호/해시 제외 |
| PATCH | `/api/admin/members/{id}` | nickname, email, status, role, suspendedUntil(ISO-8601 또는 null) |
| POST | `/api/admin/members/{id}/password-reset` | 관리자 재설정 메일 요청 |
| GET | `/api/admin/members/{id}/actions` | 해당 회원 최근 감사 기록 50건 |
| POST | `/api/auth/password-reset/request` | `{username, email}`; 동일 회원일 때만 발송 |
| POST | `/api/auth/password-reset/verify` | `{email, code}` → `{resetToken}` |
| POST | `/api/auth/password-reset/complete` | `{token, password, confirm}` |

기존 `/api/auth/signup`은 선택 필드 `email`을 추가 수용한다. 관리자 API는 세션 및 DB의 현재 ADMIN 권한을 검증한다. 일반 사용자의 직접 URL/API 호출도 거부한다. 기존 차량 인증 관리자 API 역시 DB의 현재 권한을 추가 검증한다.

## DB 마이그레이션과 배포

`backend/migrations/20260929_member_management.sql`을 **현재 사용 중인 연결 DB에** 먼저 실행한 뒤 core와 board를 함께 배포하고 frontend를 배포한다. 현재 프로젝트의 Hibernate `ddl-auto: update`도 유지되어 새 컬럼/테이블을 생성할 수 있지만, 명시적 SQL 적용을 권장한다. DB 연결 설정은 변경하지 않았다. Compose에 있는 로컬 postgres가 실제 운영 DB라고 가정하지 않는다.

```sh
# 기존에 사용하는 연결 옵션으로 psql에 접속하여 실행한다. 비밀번호를 명령줄에 넣지 않는다.
psql <기존 연결 옵션> -v ON_ERROR_STOP=1 -f backend/migrations/20260929_member_management.sql
```

- users에 nullable `nickname`, `email`, `account_status`, `suspended_until`, `auth_version` 추가.
- email unique index. 이메일은 NULL이면 여러 회원에게 허용.
- `admin_member_actions`: id, admin_id, user_id, action, created_at. 대상 회원/ID 내림차순 조회 index.
- UPDATE 기록에는 변경 필드명만, 메일 요청에는 PASSWORD_RESET_REQUEST만 저장한다. 비밀번호·코드·토큰·이메일 원문을 감사 로그에 저장하지 않는다.
- 기존 데이터 삭제·초기화 없음. SQL은 재실행 가능.
- NULL account_status는 ACTIVE, NULL auth_version은 0으로 취급. version 없는 기존 Redis 세션도 0으로 읽어 보존.
- 배포 중 이전 board 인스턴스가 남으면 버전 검증을 하지 않으므로 core/board를 모두 업데이트해야 한다.

## Redis

`<email-hmac>`, `<token-hmac>`, `<bucket-hmac>`는 PASSWORD_RESET_SECRET으로 계산한 HMAC-SHA256 hex이다. Redis 키에도 원문 이메일/토큰을 넣지 않는다.

| Key | 값 | TTL |
|---|---|---|
| `password-reset:<email-hmac>` | 코드 HMAC 및 회원 ID/세션 버전/이메일 HMAC | 300초 |
| `password-reset-attempts:<email-hmac>` | 검증 시도 횟수, 5회 초과 차단 | 첫 시도부터 300초 |
| `password-reset-token:<token-hmac>` | 회원 ID/세션 버전/이메일 HMAC | 600초 |
| `password-reset-cooldown:<email-hmac>` | 발송 재요청 간격 | 60초 |
| `password-reset-limit:<bucket-hmac>` | 발송 이메일별 5회, IP별 20회 | 3600초 |
| 같은 limit prefix, 검증 IP bucket | IP별 코드 검증 60회 | 300초 |

관리자 발송도 이메일 제한을 공유하며 요청자 제한은 관리자 ID별 20회/시간이다. 재발송해도 검증 실패 카운터는 초기화하지 않는다. 세션은 기존 `revcc:session:<token>`/30분을 유지하고 JSON에 `version`만 추가한다.

비밀번호 변경 후 PostgreSQL auth_version을 증가시킨다. Spring과 board가 매 인증 요청 시 현재 버전과 정지 상태를 검증하므로 모든 이전 세션은 즉시 사용할 수 없다. Redis의 기존 키는 조회 시 삭제되거나 원래 TTL에 만료된다. 이미 처리 중이던 요청까지 취소하지는 않는다.

## 환경변수 / 직접 설정할 항목

`.env.example`은 변수명만 제공한다. 기존 `.env`에 추가하고 기존 DB/Redis/Kakao 값을 유지한다. 실제 값은 커밋하지 않는다.

| 변수 | 설정 |
|---|---|
| SMTP_HOST | 사용하는 메일 공급자의 SMTP 서버 |
| SMTP_PORT | 보통 587, 기본 587 |
| SMTP_USERNAME | SMTP 사용자명 |
| SMTP_PASSWORD | 공급자 앱 비밀번호/SMTP 인증정보 |
| SMTP_FROM | 공급자가 허용한 발신 주소 |
| SMTP_AUTH | 보통 true, 기본 true |
| SMTP_STARTTLS | 보통 true, 기본 true (TLS 필수 협상) |
| PASSWORD_RESET_SECRET | 최소 32문자 난수 비밀값; 예: `openssl rand -hex 32`로 별도 생성 |
| PASSWORD_RESET_URL | 실제 HTTPS 서비스 주소 + `/password-reset` |

코어 인스턴스들은 동일 secret을 사용한다. secret 미설정/32문자 미만이면 재설정만 503으로 차단하고 기존 로그인은 유지한다. secret 교체 시 진행 중인 재설정은 다시 요청해야 한다. SMTP 기본 설정은 587/STARTTLS이며 465 implicit TLS만 제공하는 공급자는 추가 Spring Mail SSL 설정이 필요하다. SMTP 계정 인증, 발신자 인증, 실제 메일 수신 및 스팸함 여부는 운영자가 설정 후 확인해야 한다.

## 테스트와 제한

최종 결과: Java 47건 통과(실패/오류/skip 0), board 9건 통과, 1440px/390px 브라우저 테스트 통과, `git diff --check` 통과. 기존 데이터 보존 및 마이그레이션 재실행 검증 통과. 운영 DB에는 적용하지 않았다.

- 기존 Java 테스트 + 실제 Redis Lua/TTL/동시 검증 + 격리 PostgreSQL 기반 Spring API 통합 테스트.
- 회원 검색/페이지네이션, 일반 사용자·비로그인 거부, 자기 강등 차단, 정보 변경/감사, 정지, 비밀번호 재설정, 이전 두 세션 무효화와 타 계정 세션 유지.
- 로컬 SMTP 프로토콜 서버로 이메일 제목·코드·링크 구성을 테스트. 실제 공급자의 인증/TLS/메일 도착은 미검증.
- board 테스트로 버전 없는 기존 세션 호환과 비밀번호 변경/정지 시 게시판·내 차고 접근 거부 확인.
- `scripts/member-browser.cjs`: 1440/390px 브라우저, API fixture를 사용해 관리자 상세/저장/메일과 재설정 UI 흐름, JS 오류 및 가로 넘침 검사. 실제 API는 별도 Spring 통합 테스트로 검증.
- 마이그레이션은 격리 DB의 기존 형태 users 행을 보존하면서 두 번 적용해 확인.

재실행 예시(격리 DB revcc_test, postgres/test, 별도 Redis):

```sh
REVCC_TEST_DB_PORT=15439 REVCC_TEST_REDIS_PORT=16379 mvn -f backend/pom.xml test
npm test --prefix board-service
PLAYWRIGHT_MODULE=/외부/테스트용/node_modules/playwright node scripts/member-browser.cjs
```

프로젝트 Java 목표는 23이며 이번 로컬 환경은 JDK 22이므로 Maven 검증에 `-Djava.version=22`만 지정했다. pom의 Java 버전은 변경하지 않았다. 통합 테스트 환경변수 미지정 시 해당 테스트는 skip한다. UI 테스트용 Playwright는 프로젝트 의존성에 추가하지 않았다.

인증 요청마다 DB 조회가 추가되어 DB 장애/지연이 게시판 인증에도 영향을 준다. 운영 부하가 커지면 권한 검증의 일관성을 유지하는 별도 캐시 전략을 검토해야 한다. 카카오 외부 OAuth 실로그인과 실제 운영 SMTP 수신은 이번 격리 테스트에서 실행하지 않았다.

## 변경 파일

- backend: User, UserRepository, AuthController, AdminController, SharedSessionService 수정.
- backend 신규: AdminMemberController(최소 감사 entity/repository 포함), PasswordResetService/Controller, ResetMailService, MailConfig, MemberExceptionHandler.
- 설정: backend/pom.xml, application.yml, docker-compose.yml, .env.example, backend/migrations/20260929_member_management.sql.
- frontend: admin/index.html, auth/index.html, auth/reset.html, js/admin.js, js/auth.js, js/password-reset.js, css/auth.css, css/dashboard.css, nginx.conf.
- board: src/app.js 및 테스트 fixture/세션 무효화 테스트.
- Java 테스트: AuthControllerTest, AdminControllerTest, PasswordResetServiceTest, SharedSessionServiceTest, MemberFlowIntegrationTest, ResetMailServiceTest.
- 브라우저: scripts/member-browser.cjs. 문서: 이 파일.

## 아이디 중복확인 및 재설정 정보 일치 검증

회원가입 화면에서 중복확인을 완료해야 제출할 수 있다. 아이디 입력 변경 시 즉시 무효화하며 조회 중 입력을 바꾸면 이전 응답을 무시한다. 서버는 기존 정책(공백만 입력 불가, 최대 100자, 대소문자 구분, 별도 문자 정규식 없음)을 유지한다. 조회에는 JPA existsByUsername을 사용하며 실제 가입 시의 사전 중복검사와 DB UNIQUE 제약도 유지한다. 중복확인 API는 기존 인증 rate limiter로 IP별 분당 10회 제한한다.

재설정 요청은 username으로 회원을 조회한 후 정규화된 이메일을 대조한다. 없는 아이디는 HTTP 400/USERNAME_NOT_FOUND, 이메일 불일치는 HTTP 400/IDENTITY_MISMATCH, 카카오 전용 계정은 HTTP 400/SOCIAL_ACCOUNT를 반환한다. 일치한 일반 계정만 인증번호를 생성하며 HTTP 200/CODE_SENT와 “인증번호를 발송했습니다.”를 반환한다. 입력 형식 오류와 요청 제한 응답은 계정 존재 여부와 무관하게 적용한다. 관리자 재설정은 선택한 회원의 username과 email을 서버에서 전달한다. 검증/완료 API와 Redis 키·TTL·횟수 제한, SMTP 설정·안전 로그는 유지한다. 60초 재발송 대기 중에는 발송 성공으로 응답하지 않고 HTTP 429/RATE_LIMITED를 반환한다. 잘못된 계정 정보는 요청 횟수 제한에는 반영하지만 인증번호·재발송 대기 키는 생성하지 않는다.

추가 검증 결과: Java 62건(격리 PostgreSQL/Redis 포함) 모두 통과, Node 9건 통과, 1440px/390px 브라우저에서 미확인 제출 차단·입력 변경·늦은 응답 무시·중복 아이디·정상 가입·아이디+이메일 재설정 흐름 통과. 테스트에서 SMTP는 로컬 테스트 서버 또는 mock을 사용했으며 실제 Gmail 수신을 새로 실행하지 않았다. Neon 데이터와 SMTP 환경변수는 이 변경에서 수정하지 않았다.

### 계정 확인 UX 응답

`POST /api/auth/password-reset/request`는 `{code, message}`를 반환한다.

| HTTP | code | message |
|---|---|---|
| 400 | USERNAME_NOT_FOUND | 등록되지 않은 아이디입니다. |
| 400 | IDENTITY_MISMATCH | 아이디와 이메일 정보가 일치하지 않습니다. |
| 200 | CODE_SENT | 인증번호를 발송했습니다. |
| 429 | RATE_LIMITED | 요청이 많습니다. 잠시 후 다시 시도해주세요. |
| 400 | SOCIAL_ACCOUNT | 카카오 계정은 카카오 로그인을 이용해주세요. |
| 503 | MAIL_UNAVAILABLE | 메일 발송 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요. |

프론트는 CODE_SENT일 때만 입력값을 잠그고 인증번호 입력 단계를 연다. 정보 오류나 요청 제한일 때는 해당 서버 메시지를 표시하고 수정 가능한 계정 입력 단계에 머문다. 이메일만 조회하는 API는 추가하지 않는다. CODE_SENT는 기존 비동기 SMTP 전송 요청이 접수되었다는 뜻이며 최종 수신 성공까지 보장하지 않는다. 실제 SMTP 실패는 기존 안전 로그로 확인한다.

## 로그인 성공 후 목적지

일반 로그인 및 비밀번호 재설정 후 로그인은 사용자 권한에 따라 USER는 `/`, ADMIN은 `/admin`으로 이동한다. `/api/auth/me`의 기존 role을 사용하며 명시된 안전한 next가 있으면 우선한다. `/home`의 로그인 링크처럼 명시적으로 전달된 `next`가 있으면 기존 허용 목록의 동일 출처 내부 경로로 복귀하고 쿼리/해시를 보존한다. 외부 URL, `//` URL, 역슬래시/제어문자, 허용되지 않은 경로는 `/`로 처리한다. 카카오 OAuth 콜백도 기존 role에 따라 USER는 `/`, ADMIN은 `/admin`으로 이동한다. OAuth 인증·세션 생성 구조는 유지한다.

`scripts/login-redirect-browser.cjs`는 실제 auth/site-nav/home 자산과 격리 API fixture를 사용해 일반·재설정 후·관리자 로그인, 실제 차고의 로그인 링크 복귀, 실패 로그인, 외부 이동 차단을 데스크톱/모바일에서 검증한다. `scripts/member-browser.cjs`도 재설정 완료부터 새 비밀번호 로그인 후 `/` 도착까지 확인한다. 실제 세션 생성·무효화는 별도의 PostgreSQL/Redis 통합 테스트로 검증한다.

## 관리자 회원 상세 보안과 닫기

회원 목록·상세·수정은 비밀번호 필드가 없는 Member DTO를 반환하며 수정 DTO 역시 비밀번호를 수용하지 않는다. User의 비밀번호 getter는 JSON 직렬화에서 제외한다. BCrypt 인증 getter와 DB 컬럼은 유지한다. 관리자 비밀번호 기능은 재설정 메일 요청만 제공한다.

회원 상세는 네이티브 dialog를 유지한다. 닫기 버튼, ESC, 실제 dialog 경계 바깥 클릭으로 닫히며 내부·패딩 클릭으로는 닫히지 않는다. close 이벤트에서 선택 회원·폼·메시지·작업 상태를 정리하고 가능하면 원래 회원 버튼으로 포커스를 복귀한다. 닫힌 후 도착하는 API 응답은 현재 모달에 반영하지 않는다. 이벤트는 초기화 시 한 번만 등록하며 별도 body 스크롤 잠금이나 임시 전역 listener를 추가하지 않는다.
