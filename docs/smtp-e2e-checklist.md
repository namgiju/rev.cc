# Gmail SMTP 설정 및 E2E 검증 기록

Neon 마이그레이션 및 기존 회원 32명 보존은 사용자 확인 완료 상태다. 이번 SMTP 점검에서는 DB 변경/마이그레이션/기존 회원 수정 없이 진행했다.

## 초기 설정 점검 기록

- application.yml → Compose core environment → 실행 중 core에 SMTP/재설정 변수 9개가 연결되어 있다. 비밀값을 출력하지 않고 일치 여부만 비교했다.
- 초기 점검 당시 SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM, PASSWORD_RESET_SECRET이 비어 있었으며, 이후 로컬 설정을 완료했다.
- core의 DB URL은 Neon을 유지한다. DB/Redis/Kakao/세션 설정은 변경하지 않았다.
- Docker 7개 컨테이너 healthy 확인.
- 프론트 정식 경로는 http://localhost:8090/password-reset 이다. /auth/reset.html도 파일 경로지만 설정에는 정식 경로를 사용한다.
- .env는 Git 미추적이며 ignore 적용 상태다. .env.example에는 공개 SMTP 설정과 빈 인증정보만 있다.

## 사용자가 입력할 값

프로젝트 루트 .env에서 아래 9개 항목만 추가/수정하고 기존 설정은 그대로 둔다. .env.example 전체를 .env에 덮어쓰지 않는다.

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_AUTH=true
SMTP_STARTTLS=true
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
PASSWORD_RESET_SECRET=
PASSWORD_RESET_URL=http://localhost:8090/password-reset
```

- SMTP_USERNAME: 본인 Gmail 전체 주소.
- SMTP_PASSWORD: 해당 Google 계정의 앱 비밀번호. 일반 계정 비밀번호를 넣지 않는다.
- SMTP_FROM: 첫 테스트에서는 SMTP_USERNAME과 동일하게 설정.
- PASSWORD_RESET_SECRET: 사용자가 직접 생성한 최소 32자 랜덤 값. 로컬 터미널에서 `openssl rand -hex 32`로 생성할 수 있다. 채팅/커밋에 붙여 넣지 않는다.
- Google 앱 비밀번호: https://support.google.com/accounts/answer/185833
- Gmail SMTP/STARTTLS 587: https://support.google.com/mail/answer/7104828

새 환경에서는 입력 후 비밀값을 공유하지 않고 설정 완료 여부만 확인한다. 기존 회원을 변경하지 않는 조건을 지키기 위해 다음 단계는 수신 가능한 주소를 사용하는 새 전용 테스트 회원으로 진행한다. 테스트 회원의 비밀번호/상태만 변경하며 회원을 삭제하지 않는다.

## 설정 후 검증 순서

1. 비밀값 출력 없이 설정 및 길이를 확인하고 core만 환경변수 반영을 위해 재생성한다. 단순 restart는 변경된 환경변수를 적용하지 않는다. 다른 서비스/DB/볼륨은 변경하지 않는다.
2. 별도 테스트 회원과 로그인 세션을 준비한다. 관리자 검증도 기존 회원의 권한/상태를 변경하지 않는 전용 테스트 계정 범위에서 진행한다.
3. 로그인 페이지 링크에서 인증번호를 요청하고 사용자가 실제 메일 수신을 확인한다. SMTP 성공 로그나 API 200만으로 수신 성공을 판정하지 않는다.
4. 인증번호는 브라우저에 입력한다. Redis 원문 값/토큰/메일 본문은 출력하지 않고 TTL과 존재 여부만 확인한다.
5. 코드 300초/쿨다운 60초/시도 제한/요청 제한과 토큰 600초/성공 후 삭제를 검증한다. 한도 테스트는 정상 흐름을 막지 않도록 분리한다.
6. 새 비밀번호 저장 후 이전 세션으로 auth/me와 게시판·차고 접근이 거부되는지, 이전 비밀번호 로그인 실패와 새 비밀번호 로그인 성공을 확인한다.
7. 관리자 목록/검색/필터/페이지/상세/전용 회원 수정·정지·메일 요청/감사 로그 및 일반 사용자 접근 거부를 확인한다.
8. 게시판 글·댓글·차고·로그아웃 회귀 검증은 전용 테스트 회원으로 진행한다. 카카오 실제 로그인은 사용자 브라우저에서 확인한다.
9. 최종 Git 상태/커밋 대상/제외 파일/결과를 보고한다. 자동 commit/push 하지 않는다.

실제 수신 및 비밀번호 변경 완료 전에는 전체 E2E 성공으로 보고하지 않는다.

## SMTP 실패 진단 보강

후속 점검에서 실행 컨테이너와 Compose 모두 SMTP_HOST=localhost, SMTP_FROM 미설정을 확인했다. 로컬 .env의 두 항목만 Gmail 호스트와 기존 SMTP_USERNAME에 맞춰 보정했다. 앱 비밀번호, 재설정 secret, Neon/Kakao 설정은 변경하지 않았다.

ResetMailService는 이제 예외 원문이나 스택 트레이스를 출력하지 않고 다음 항목만 기록한다.

- category: SMTP_AUTHENTICATION_FAILED, SMTP_CONNECTION_FAILED, SMTP_DNS_FAILED, SMTP_TIMEOUT, SMTP_TLS_FAILED, SENDER_REJECTED, RECIPIENT_REJECTED, SMTP_SEND_FAILED, MESSAGE_CONFIGURATION_INVALID, MAIL_FAILURE, UNEXPECTED_MAIL_FAILURE.
- exceptions: 발생한 예외 클래스명. cause와 Jakarta Mail nextException, MailSendException의 개별 실패 예외도 확인한다.
- smtpStatus: SMTP 숫자 코드 및 enhanced status만 추출(예: 535/5.7.8). 확인할 수 없으면 unavailable.

비밀번호 재설정을 다시 요청한 후 다음 명령으로 이 서비스의 진단 줄만 확인할 수 있다.

```sh
docker compose logs --since=5m core | grep 'Password reset email delivery failed:'
```

메일 본문, 수신자/발신자 주소, 인증정보, 코드, 토큰, 실패 메시지 객체는 출력하지 않는다. JavaMail debug를 켜서 진단하지 않는다. 설정 보정은 실제 Gmail 인증 성공이나 메일 수신 성공을 의미하지 않으며, 실제 재시도로 확인해야 한다.

## 최종 사용자 확인

사용자가 최신 username + email 계정 확인 흐름에서 실제 Gmail 수신·인증번호 검증·비밀번호 변경까지 성공했다고 확인했다. 이후 변경은 일반 로그인 기본 목적지를 `/`로 바꾸는 작업이며 SMTP 환경변수·발송 구조는 변경하지 않았다. 비밀번호 변경 후 로그인도 기본 목적지는 `/`이고, 명시된 안전한 `next` 경로는 유지한다.
