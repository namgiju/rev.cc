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
[ ] STEP 5+: P2/P3 (P1 전부 완료 후, 이 파일에 STEP을 추가로 정의해서 진행)
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
- STEP 4 — `docker compose down -v && up` 검증: 기본 compose는 core/board가 `.env`의 Neon을 가리키고 URL에 `sslmode=require`가 고정돼 있다. 그래서 compose를 그대로 기동하지 않고, 같은 이미지로 임시 PostgreSQL(16·18)과 Redis 스택을 만들어 compose와 같은 순서(core healthy → board)로 검증했다.

---

## 6. 작업 이력

| STEP | 상태 | 완료일 | commit hash | 비고 |
|---|---|---|---|---|
| P0-1/P0-2 | 완료 | 2026-09-29 | `07c7d7d` | Kakao OAuth state, Cloudflare/TLS 대응. `mvn test` 77 run/0 fail, `npm test` 9 run/0 fail |
| STEP 1 | 완료 | 2026-09-30 | `688e990` | 비밀번호 8자 이상(가입/재설정만), `/api` 본문 64KB·인증서류 업로드 5MB 상한(413), prod 배포 문서. `mvn test` 86 run/0 fail/0 skip(통합테스트 포함), `npm test` 9 run/0 fail |
| STEP 2 | 완료 | 2026-09-30 | `a7ed438` | 관리자 매물 삭제(사유 필수, `LISTING_DELETE` 로그), admin/market 인가·IDOR 테스트 5건. `npm test` 14 run/0 fail, `mvn test` 86 run/0 fail(통합 9 skip) |
| STEP 3 | 완료 | 2026-09-30 | `a74eb33` | `.github/workflows/ci.yml`(backend: Java 23 + Postgres/Redis 서비스로 통합테스트 포함, board: Node 22). GitHub Actions 첫 실행 성공: `mvn test` 86 run/0 fail/0 skip, `npm test` 14 pass. 1차 시도는 러너가 서비스 컨테이너 초기화 단계에서 멈춰 취소됐고(로그 없음, 일시 장애로 판단) 재실행에서 통과 |
| STEP 4 | 완료 | 2026-09-30 | (push 후 기록) | Flyway 도입(`V1__baseline`=Neon 스키마, `V2`=`LISTING_DELETE` CHECK), `baseline-on-migrate`, `ddl-auto: validate`. board `schema.sql`, `backend/migrations/`, `VehicleRepository` DDL 제거. 검증: 빈 PG16/PG18 적용 후 Neon 덤프와 비교(예상한 차이만 있음), Neon 스키마 복제본+데이터에서 baseline→V2 적용·데이터 보존·재기동 멱등·API 200, 이전 코드로 만든 DB에서 baseline 통과. `mvn test` 86 run/0 fail/0 skip(통합 포함), `npm test` 14 pass |

---

## 7. 다음 실행 명령

새 터미널/새 Claude Code 세션에서 아래 한 문장만 입력하면 된다:

```
REVCC_NEXT_TASKS.md를 읽고 다음 미완료 STEP을 구현해. 파일에 적힌 작업 규칙과 완료 조건을 따르고, 테스트 통과 후 commit 및 origin/docker-assignment push까지 진행해.
```
