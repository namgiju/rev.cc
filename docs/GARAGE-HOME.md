# `/home`을 내 차고로 통합

## 조사 결과

- 기존 `/home`: 로그인 사용자 대시보드. 중앙은 `GET /api/board/posts?limit=6&sort=latest`로
  **전체 회원 최신 글**을 표시했다. 오른쪽 차고는 Spring 개인 차량 API를 사용했다.
  차량 등록 및 자동차등록증 인증 신청은 이미 이 화면에 있었다.
- 기존 `/garage`: 차량 목록 및 상세 모달, 사진/기본 정보 수정, 삭제, 정비·튜닝·부품 기록 관리.
  앞선 인증 수정 후 개인 차고 API를 사용했지만 `/home`과 별도 화면이었다.
- 두 서비스의 차량은 같은 `owner_vehicles`를 사용한다.
  실제 소유자 관계는 `owner_vehicles.owner_id → users.id`다.
- `/garage#car-ID`, 내 활동 버튼, 각 페이지 NAV/홈 카드/푸터가 기존 화면에 의존했다.
  커뮤니티의 `#car-ID`, `#member-ID` 공개 차량/회원 모달도 같은 상세 관리 코드를 사용했다.

## 최종 화면과 경로

모든 HTML 사이트의 '내 차고' NAV 및 진입 링크는 `/home`이다.

1. NAV 바로 아래: 내 차량 영역.
2. 아래: 내 커뮤니티 활동(내가 쓴 글 / 내가 댓글 단 글 / 내 활동 알림).
3. 본인 계정 프로필과 실제 차량·인증·관리자 태그.

기존 전체 회원 최신글 및 예시 인장 카탈로그는 개인 차고에서 제거했다.
전체 커뮤니티는 기존 `/community`에서 계속 이용한다.

- 비로그인: '내 차고를 이용하려면 로그인이 필요합니다.' + 기존 카카오 로그인 링크.
  개인 차량·활동 API를 요청하지 않는다. 빈 차고나 회원용 UI를 표시하지 않는다.
- 로그인/차량 없음: 등록 안내 + '차량 등록하기'. 기존 제조사·모델·연식·차량번호 등록 후
  자동차등록증 업로드/나중에 하기 흐름을 재사용한다.
- 로그인/차량 있음: 본인 차량 전체, 연식, 인증 상태, 상세/수정/인증 신청.
- 관리자: 같은 개인 차고 조회와 화면. 별도로 `/admin` 운영 메뉴를 유지한다.
- 오류: 조회 오류/재시도 UI. 실패를 빈 차량/활동 배열로 바꾸지 않는다.

`/garage`, `/garage/`, `/garage/index.html`은 nginx에서 302 `/home`으로 redirect한다.
query string을 유지하고 브라우저는 기존 fragment를 유지한다.
`/home#car-ID`가 공통 차량 상세 UI를 연다. 이전 `#member-ID`, `#post-ID`는 기존 공개
라우팅으로 이어진다. 기존 garage HTML은 삭제하지 않았으나 위 주소에서 메인 화면으로 제공하지 않는다.
API의 `/api/garage/*` 및 `/api/board/garage/*`는 페이지 redirect와 별개이며 유지한다.
Next.js(3000)의 별도 `/garage`는 이번 HTML 라우팅 변경 대상이 아니다.

## 기존 API 재사용

| 기능 | API / 소유자 기준 |
| --- | --- |
| 로그인 확인 | `/api/board/me`, 기존 Redis `{id, username, role}` |
| 내 차량 | `GET /api/garage/vehicles`, 세션 id → owner_id |
| 차량 등록 | `POST /api/garage/vehicles` |
| 인증 신청 | `POST /api/garage/vehicles/:id/verification` |
| 차량 상세·사진·정보 수정·삭제·기록 | 기존 `/api/board/garage/:id` 및 `/records` |
| 내가 쓴 글 | `/api/board/posts?scope=mine&sort=latest&limit=20&page=N` |
| 내가 댓글 단 글 | `/api/board/posts?scope=commented&sort=latest&limit=20&page=N` |
| 내 활동 알림 | `/api/board/notifications` (기존 최대 100건) |

활동 목록은 20건씩 더 보기를 제공한다. 댓글 단 글은 **댓글 시각이 아니라 원글 최신순**이다.
알림 탭은 조회만 하고 기존 커뮤니티 알림창의 읽음 처리 동작은 변경하지 않는다.
새 API/DB 스키마/로그인 시스템은 추가하지 않았다. ADMIN의 role과 세션도 변경하지 않았다.

## 차량 기능 이전

`js/vehicle-ui.js`는 기존 `app.js`의 차량 상세·사진 수정·삭제·기록 관리 코드를
공통 팩토리로 옮긴 것이다. `app.js`와 `home.js`가 동일한 구현을 사용한다.
게시글·회원 공개 모달의 차량 기능을 유지하면서 `/home`에도 같은 모달과 폼을 연결했다.
신규 등록·등록증 신청은 기존 `home.js` 흐름을 유지한다.

세션 확인 전에는 데이터를 표시하지 않는다. 로그아웃/계정 변경 시 차량·활동·상세·폼을
지우며 요청 순번으로 늦은 응답을 무시한다. focus/BFCache 복귀 및 새로고침 때 재확인한다.

## 수정 파일

- `assignment-frontend/home/index.html`: 내 차량 우선 배치, 개인 활동 탭, 기존 관리 모달 연결.
- `assignment-frontend/js/home.js`: 상태별 차고·개인 활동·기존 등록/인증 연결.
- `assignment-frontend/js/vehicle-ui.js`: 기존 상세/수정/사진/기록 관리 공통 코드.
- `assignment-frontend/js/app.js`: 공통 차량 UI 사용, 내 활동의 차고 링크 변경.
- `assignment-frontend/css/dashboard.css`: 차량 카드·활동 탭·모바일 레이아웃.
- `assignment-frontend/nginx.conf`: `/garage` → `/home` 리다이렉트.
- `assignment-frontend/index.html`, `community/index.html`, `parts/index.html`,
  `admin/index.html`, `garage/index.html`: NAV/진입 링크 및 공통 스크립트 연결.
- `scripts/home-garage-browser.cjs`, `scripts/garage-auth-browser.cjs`: 실제 통합 검사 및 호환 진입점.
- `README.md`, `docs/GARAGE-AUTH.md`, `docs/GARAGE-HOME.md`: 최신 경로 및 검증 기록.

이번 변경에서는 Java/Express API 및 DB 스키마를 수정하지 않았다.
작업 트리에 남아 있는 Board API/단위 테스트 변경은 앞선 개인 차고 인증 수정의 결과다.

## 검증

`scripts/home-garage-browser.cjs`: 실제 Spring 로그인, Redis 세션, PostgreSQL 데이터,
Chrome 브라우저를 사용한다. 임시 일반 사용자 2명과 관리자 1명을 만들고 종료 시 임시
게시글·댓글·차량·사진·인증 서류·계정·세션을 정리한다. 기존 회원 데이터는 변경하지 않는다.

검사 범위:

- NAV `/home`, 비로그인 UI, 비로그인 차량·활동 요청 없음.
- `/garage` 3가지 주소의 리다이렉트, query/hash 유지, 새로고침.
- 차량 없는 회원, 본인 차량 5대, 관리자 본인 차량, 차량 영역이 활동 영역보다 위인지.
- 실제 본인 글·타인 글·댓글·알림 데이터로 개인 활동 필터 확인.
- UI 차량 등록 → 인증 나중에 하기 → 정보·사진 수정 → 기록 등록/삭제 → 차량 삭제.
- 관리자 등록증 업로드 → 승인 → 인증 상태 반영, 관리자 화면 왕복 세션 유지.
- 390px 모바일 가로 넘침, 데스크톱 배치.
- 로그아웃 후 차량·활동 제거, 늦은 응답 차단, 다른 탭 로그아웃, 오류/재시도.
- 기존 게시글 상세 브라우저 회귀 검사: 공유 차량 UI 로딩이 게시글 기능을 깨뜨리지 않는지.

```sh
docker compose up -d --no-deps --build --wait frontend
PLAYWRIGHT_MODULE=/tmp/revcc-browser/node_modules/playwright \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/home-garage-browser.cjs
```

기존 `scripts/garage-auth-browser.cjs` 실행 경로는 위 새 검사로 위임한다.
카카오 외부 계정 로그인은 자동화하지 않았다. 기존 로그인 링크/callback 코드는 그대로 유지한다.
기존 차량 입력 규칙(Spring/Express 차이), 인증 후 차량 변경 시 재심사 정책, Next.js 차고는
이번 라우팅·마이페이지 통합 범위에 포함하지 않았다.
