# REV.CC 다음 구현 작업 (진행 관리 파일)

> **새 세션 규칙: 이 파일 하나만 읽고 작업을 시작할 것.**
> `REVCC_AUDIT.md`는 2026-09-29에 완료된 감사 원본이다 — **재분석하지 말고 수정하지도 말 것**.
> 이 파일은 그 감사 결과와 이후 완료된 P0 작업을 요약해, 다음 STEP을 바로 구현할 수 있게 만든 실행 파일이다.

---

## 1. 현재 브랜치와 프로젝트 상태

- 브랜치: `docker-assignment` (항상 이 브랜치에서만 작업, 다른 브랜치로 전환하지 말 것)
- 이 파일 작성 시점 기준 `git status`: P0 변경사항 + `REVCC_AUDIT.md` + 이 파일이 커밋 대상으로 대기 중이었고, 이번 세션에서 **P0 변경사항 + REVCC_AUDIT.md + REVCC_NEXT_TASKS.md를 함께 커밋·push했다** (아래 "완료된 작업"의 commit hash 참고).
- 프로젝트 구조: `backend`(Spring Boot, `core`), `board-service`(Node/Express, `board`), `assignment-frontend`(정적 HTML/JS), `nginx`(proxy), `frontend`(Next.js "My Garage" 프로토타입, 기본 compose 미포함), `docker-compose*.yml` 5종.
- 인증 구조: 커스텀 쿠키+Redis 세션(Spring Security 미사용). `SharedSessionService`가 세션을 만들고 `revcc:session:<token>` 키로 Redis에 저장, Node가 같은 키를 직접 읽음.

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

```
[x] STEP 1: P1-1 비밀번호 최소 길이 + P1-2 요청 body 크기 제한 + P1-5 운영 배포 문서 수정
[x] STEP 2: P1-4 부품장터 관리자 모더레이션 + P1-6 admin/market 인가 테스트
[x] STEP 3: P1-7 GitHub Actions CI
[x] STEP 4: P1-3 Flyway/Liquibase 기반 DB migration 정리
[x] STEP 5-A: P2-2 외부 X-Forwarded-For 신뢰 문제 해결 + limiter 만료 버킷 정리
[x] STEP 5-B: P2-2 계정 단위 로그인 제한 + P2-4 board 누락 엔드포인트 rate limit (+ admin-system.mjs 정합화)
[x] STEP 6: P2-3 서버측 XSS 방어 (B안: 입력 시 HTML 태그 제거)
[x] STEP 7-A: P2-5 Redis 인증 + P2-6 DB credential 정리
[ ] STEP 7-B: P2-5 Docker 네트워크 분리 (prod 오버레이에만 적용)
[ ] STEP 8: P2-7 + P2-8 + P2-9 운영 안정성 (커넥션 풀, restart 정책, .env.example)
[ ] STEP 9: P2-10 Nginx 하드닝
[ ] STEP 10: P2-11 회원탈퇴/FK 정책 — ⚠ 결정 STEP(구현 STEP 아님). 데이터 보존 정책을 사용자가 결정한 뒤 구현 STEP을 새로 정의한다
[ ] STEP 11: P2-1 비밀번호 재설정 계정 열거 (정책 결정 포함)
[ ] STEP 12+: P3 (P2 완료 후, 이 파일에 STEP을 추가로 정의해서 진행)
```

새 세션은 이 표에서 **처음 `[ ]`인 STEP 하나만** 구현한다. 여러 STEP을 한 번에 진행하지 않는다.

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

---

### STEP 11: 비밀번호 재설정 계정 열거 (P2-1)

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
6. 작업 완료 후 관련 테스트를 실행한다: `cd backend && mvn test`, `cd board-service && npm test`. 두 서비스 중 변경하지 않은 쪽도 회귀가 없는지 확인 차원에서 함께 실행한다.
7. 테스트가 실패하면 원인을 해결하기 전에는 commit도 push도 하지 않는다. 원인이 이번 변경 때문인지, 기존부터 있던 문제인지 먼저 구분한다.
8. commit 전 `git diff`로 변경사항을 최종 검토한다.
9. 문제가 없으면 **해당 STEP에서 변경한 파일만** commit한다(다른 STEP이나 무관한 파일을 같이 묶지 않는다).
10. `origin/docker-assignment`로 push한다.
11. 이 파일(`REVCC_NEXT_TASKS.md`)의 "다음 작업 순서" 표에서 완료한 STEP을 `[x]`로 갱신하고, 아래 "작업 이력" 섹션에 결과와 commit hash를 기록한 뒤, 이 갱신 자체도 같은 commit(또는 바로 다음의 문서 전용 commit)에 포함해 push한다.
12. `REVCC_AUDIT.md`는 절대 수정하지 않는다(감사 원본 보존).

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
| STEP 7-A | 완료 | 2026-09-30 | (push 후 기록) | 결정: 운영 DB는 Neon 확정. Redis 인증: `REDIS_PASSWORD`를 redis(설정 파일로 전달해 ps에 노출 안 됨, healthcheck는 `REDISCLI_AUTH`+PONG 확인)·core(`spring.data.redis.password`, prod 프로파일은 필수)·board(`createClient({password})`)에 같은 값으로 전달, 기본 compose는 로컬 기본값 `revcc-local-redis`, prod 오버레이는 `:?` 강제, 비밀번호 미설정 시 무인증 접속 유지(CI·격리 테스트). DB: prod 오버레이가 로컬 `POSTGRES_PASSWORD`로 core/board를 덮어쓰던 문제 제거, core/board는 `DB_HOST/DB_NAME/DB_USER/DB_PASSWORD`를 `:?`로 강제, 로컬 postgres 서비스와 `revcc_pg` 볼륨은 prod 병합 결과에서 `!reset null`로 제거(core `depends_on`은 `!override`로 redis만). `scripts/assignment-run.sh`·`docs/DOCKER-SUBMISSION.md`·`.env.example` 반영. 검증: 가짜 env로 `docker compose config` 병합 결과 확인(prod 서비스 5개·postgres/볼륨 없음·Neon 값만 사용·로컬 비밀번호 미유입·Redis 값 3곳 일치·필수값 6개 누락 시 기동 거부, 기본 compose 6개·`revcc-network` 유지), SSL 켠 임시 PostgreSQL(Neon 대역)로 prod·기본 구성 실제 기동(prod 5개 healthy·postgres 컨테이너/볼륨 미생성·SSL 연결·Flyway V1/V2·가입/로그인/board 글쓰기·Secure 쿠키, 기본 6개 healthy·같은 흐름), Redis 무인증 접근 NOAUTH, `mvn test` 99 run/0 fail/0 skip(무인증 Redis 통합 포함), `npm test` 41 pass, 수동 시스템 테스트 5개 PASS. Neon 미접속 |
| STEP 7-B | 미착수 | - | - | 네트워크 분리 (prod 오버레이에만 적용, 기본 compose 유지) |
| STEP 8 | 미착수 | - | - | 커넥션 풀 / restart / .env.example |
| STEP 9 | 미착수 | - | - | Nginx 하드닝 |
| STEP 10 | 결정 대기 | - | - | 회원탈퇴 데이터 보존 정책 결정(구현 STEP 아님) |
| STEP 11 | 미착수 | - | - | 비밀번호 재설정 열거 (방식 결정 필요) |

---

## 7. 다음 실행 명령

새 터미널/새 Claude Code 세션에서 아래 한 문장만 입력하면 된다:

```
REVCC_NEXT_TASKS.md를 읽고 다음 미완료 STEP을 구현해. 파일에 적힌 작업 규칙과 완료 조건을 따르고, 테스트 통과 후 commit 및 origin/docker-assignment push까지 진행해.
```
