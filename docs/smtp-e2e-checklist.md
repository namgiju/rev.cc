# Gmail SMTP 실제 E2E 진행 상태

Neon 마이그레이션 및 기존 회원 32명 보존은 사용자 확인 완료 상태다. 이번 SMTP 점검에서는 DB 변경/마이그레이션/기존 회원 수정 없이 진행했다.

## 현재 확인

- application.yml → Compose core environment → 실행 중 core에 SMTP/재설정 변수 9개가 연결되어 있다. 비밀값을 출력하지 않고 일치 여부만 비교했다.
- 현재 SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM, PASSWORD_RESET_SECRET은 비어 있다. 실제 Gmail 발송/E2E는 아직 완료되지 않았다.
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

입력 후 비밀값을 공유하지 않고 “설정 완료”만 알려주면 된다. 기존 회원을 변경하지 않는 조건을 지키기 위해 다음 단계는 수신 가능한 주소를 사용하는 새 전용 테스트 회원으로 진행한다. 테스트 회원의 비밀번호/상태만 변경하며 회원을 삭제하지 않는다.

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
