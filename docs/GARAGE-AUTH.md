# 내 차고 인증·권한 수정 (2026-09-21)

> 아래는 선행 수정 기록입니다. 현재 내 차고는 `/home`으로 통합되었으며
> `/garage`는 리다이렉트합니다. 최신 화면/라우팅/검사는 [GARAGE-HOME.md](GARAGE-HOME.md)를 참조하세요.

## 실제 원인

`/garage` 링크는 내 차고로 표시되었지만 `refreshGarage()`는 공개 API인
`GET /api/board/garage`를 소유자 조건 없이 호출하고 전체 차량 중 앞 4대를 표시했다.
로그인 여부도 확인하지 않아 비로그인 사용자에게도 같은 차량들이 노출됐다.
`내 활동 → 내 차고`는 `/garage`가 아니라 `#member-{id}` 공개 회원 모달을 열었다.
따라서 내 차고 진입점에 따라 다른 화면과 데이터가 표시됐다.

별도로 `/garage`에서 로그아웃할 때 `resetComposer()`가 존재하지 않는 `#post-form`을
초기화하다 실패하여, 서버 로그아웃 이후에도 화면의 사용자와 차량이 남을 수 있었다.
`/home`에서는 차고 API 실패를 빈 배열로 바꿔 차량 없음과 조회 실패를 혼동했다.

수정 전 실제 비로그인 브라우저 재현: `/garage`에 차량 카드 4개, 로그인 안내 없음.
DB 읽기 확인: 기존 관리자 id=14에 소유 차량 1대가 정상 연결되어 있었다.
실제 외래 키는 `owner_vehicles.owner_id → users.id`이며 `user_id` 컬럼이 아니다.
스키마나 관리자 차량 데이터를 수정할 필요가 없었다.

## 기존 인증 흐름 — 변경 없음

1. `POST /api/auth/login`: 비밀번호 검증 후 기존 토큰 폐기, `sessions.create(user)` 호출.
2. Redis `revcc:session:<token>`에 `{id, username, role}` 저장, TTL 1800초.
3. `REVCC_SESSION` 쿠키: `Path=/`, `HttpOnly`, `SameSite=Lax`, Max-Age 1800초.
4. `GET /api/auth/me`와 `GET /api/board/me`는 같은 Redis 세션을 읽는다.
5. ADMIN과 USER의 구조·쿠키·사용자 ID 취급은 동일하며 role 값만 다르다.
6. 현재 소스에서 비밀번호 로그인은 JSON 응답이며 redirect를 하지 않는다.
   카카오 callback은 동일한 세션 생성 후 `/home`으로 redirect한다.
   `/home`이 ADMIN에게 관리자 링크를 표시하고 `/admin`은 role을 검증한다.
   관리자 진입 때 새 세션 생성, 사용자 ID 교체, 세션 초기화는 없다.

## 수정

- 모든 '내 차고' 진입은 `/garage`를 사용한다. 내 활동 버튼도 같은 경로로 통일했다.
- `GET /api/board/garage/mine` 추가: 인증 필수, `WHERE owner_id = req.user.id`.
  USER/ADMIN 모두 동일한 조회를 하며 query의 owner/userId는 사용하지 않는다.
  사진·기록 수·인증 상태를 포함하되 차량번호·등록증은 반환하지 않는다.
- 기존 공개 `/api/board/garage`, `?owner=...`, `/garage/:id`는 회원 프로필과
  커뮤니티의 공개 차량 열람 기능을 위해 유지한다. 개인 차고 화면은 이를 목록으로 사용하지 않는다.
- 기존 Spring `GET /api/garage/vehicles` 역시 동일한 세션 ID로 조회하고 비로그인은 401이다.
- `refreshSession()` → `refreshGarage()` → `renderGarageState()` 순서로 표시한다.
- 비로그인: 로그인 안내와 기존 카카오 로그인 링크. 차량 API 요청과 차량 등록 UI 없음.
- 로그인 + 차량 없음: 빈 차고 안내, 차량 등록 폼, `/home` 등록·인증 안내 링크.
- 로그인 + 차량 있음: 본인 차량 전체, 인증 상태, 수정·기록 관리·인증 관리 링크.
- ADMIN도 차량 유무에 따라 같은 화면을 사용한다.
- 인증 확인 중/차량 로딩/조회 실패는 위 3가지 결과 상태와 별도로 처리한다.
- 로그아웃, 사용자 변경, 재접속 시 기존 차량과 모달을 지운다.
  요청 순번으로 늦은 응답을 무시하고 focus 및 BFCache 복귀 시 세션을 다시 확인한다.
- `/home`의 차고 요청 오류는 빈 차고로 표시하지 않는다.

## 검증

`scripts/garage-auth-browser.cjs`는 실제 Spring 가입/로그인, Redis, PostgreSQL,
Chrome을 사용한다. 고유한 임시 일반 사용자 2명(차량 0대/5대)과 관리자 1명을 만들고,
관리자 role은 해당 임시 계정에만 설정한다. 종료 시 계정·차량·인증 신청·세션을 정리한다.
기존 회원의 비밀번호, 권한, 차량을 변경하지 않는다.

- A/B: 비로그인 클릭·직접 접근·차량 해시 접근에서 로그인 UI, 차량 요청 0건.
- C: 일반 사용자 차량 0대, 빈 상태 및 등록 CTA.
- D: 일반 사용자 본인 차량 5대 전체 및 수정·관리 버튼.
- E: 관리자 메뉴와 실제 관리자 API 접근, 일반 사용자 관리자 API는 403.
- F/G: 관리자 본인 차량, 관리자 페이지 왕복 후 동일 쿠키·세션 유지.
- H: 로그아웃 후 차량·상세·사용자 표시 제거, 개인 API 401.
- I: 비로그인/빈 차고/차량 보유/관리자 상태 새로고침 유지.
- API 비교: Spring/Express me의 id·role과 Redis JSON 일치, 쿠키 속성 확인,
  개인 차고 두 API 모두 소유자 일치, owner/userId query로 다른 사람 조회 불가.
- 추가: 실제 인증 신청·승인 상태 표시, 다른 탭 로그아웃 후 focus 처리,
  로그아웃 전 느린 차량 응답 무시, 조회 오류와 빈 차고 분리 및 재시도.
- Board 단위 테스트 5개, 기존 격리 DB 커뮤니티 통합 검사, 게시글 상세 fixture 브라우저 검사.

```sh
npm test --prefix board-service
docker compose exec -T board node --input-type=module < scripts/community-system.mjs
PLAYWRIGHT_MODULE=/tmp/revcc-browser/node_modules/playwright \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/garage-auth-browser.cjs
```

## 관련 기술부채 / 검증 한계

- Spring과 Express에 차량 API가 병존한다. 이번에는 공개 조회를 깨뜨리지 않도록
  개인 목록 경로를 명시적으로 분리했다. 향후 입력 규칙·차량 응답 계약 통합이 필요하다.
- 차량 등록과 기록 관리는 `/garage`, 등록증 인증 신청은 기존 `/home`에서 제공한다.
- app/home/admin의 세션 표시 코드는 여전히 별도 스크립트다. 내 차고 진입과 판별은
  `/garage`에 모았지만 전체 인증 UI 모듈을 재작성하지 않았다.
- 카카오 외부 계정 로그인 자체는 자동화하지 않았다. 기존 OAuth 코드와 callback,
  쿠키 발급 흐름을 유지하고 UI 링크 및 실제 비밀번호 로그인으로 공통 세션을 검증했다.
- Next.js 차고 폼의 차량번호 누락, 공개 Spring 프로필 응답의 차량번호,
  차량 변경 후 재인증 정책은 이번 HTML 차고 인증·라우팅 수정 범위 밖이다.
