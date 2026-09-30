# REV.CC 회원 간 부품 직거래 장터

2026-09-22. `/parts`를 기존 예시 호환 조회 화면에서 회원 간 부품 장터로 전환했다. 레퍼런스는 실제 존재하는 `references/badges/부품레퍼런스.png`이며 파일명은 한글 분해형일 수 있다. `references/ui`는 없었다. 기존 커뮤니티 부품 카테고리(`/community?category=parts`, 상세 `/community/parts/{id}`)는 별도로 유지한다.

## 조사 결과와 범위

- 기존 `/parts`는 Spring의 차량 목록과 Node의 `/api/parts/compatibility` 예시 데이터를 조합하는 화면이었다. 가격/판매 상태/관심 매물 저장 구조는 없었다.
- `users`, `owner_vehicles`, `member_profiles`, `community_images` 및 기존 Redis 세션을 재사용한다.
- Spring 인증/개인 차량/관리 API 및 Nginx 구성은 변경하지 않았다. 이미 `/api/parts/*`가 Node로 전달되므로 별도 라우팅이 필요 없다.
- 기존 예시 호환 UI와 API 호출은 장터 화면에서 제거했다. 호환 API 자체는 기존 클라이언트 호환을 위해 유지하되 장터와 연결하지 않는다.
- 결제/에스크로/배송/실시간 채팅/호환성 판정은 구현하지 않는다.

## 파일

변경:

- `assignment-frontend/parts/index.html`: 기존 NAV/Footer를 유지한 3열 장터, 필터/등록/상세 폼
- `assignment-frontend/js/app.js`: 기존 세션 흐름에 장터 초기화/세션 변경 연결, 장터에서도 기존 커뮤니티 활동 메뉴가 정상 이동하도록 처리
- `assignment-frontend/community/index.html`, `assignment-frontend/js/community-list.js`, `assignment-frontend/css/community-list.css`: 기존 MY GARAGE를 공통 모듈로 연결
- `board-service/src/app.js`: 같은 Redis 세션 미들웨어로 `/api/parts` 사용자 확인, 장터 router 연결
- `board-service/src/community.js`: 기존 검증/이미지 소유권 helper를 공통 파일로 이동, 커뮤니티 동작 유지
- `board-service/src/schema.sql`: 장터 테이블/인덱스 멱등 생성

신규:

- `assignment-frontend/js/market.js`, `assignment-frontend/css/market.css`
- `assignment-frontend/js/my-garage-card.js`, `assignment-frontend/css/my-garage-card.css`
- `board-service/src/market.js`, `board-service/src/validation.js`, `board-service/src/owned-images.js`
- `scripts/market-browser.cjs`, `scripts/market-system.mjs`
- 이 문서

직전 커뮤니티 목록 작업에서 변경한 파일과 테스트는 그대로 보존한다. Next.js 폴더와 레퍼런스 원본은 이번 코드 작업에서 수정하지 않는다.

## DB

`parts_listings`:

- 판매자 `seller_id` → 기존 `users.id`
- 제목/설명/가격(0~20억 원, 정수)
- 부품 카테고리 9종
- 상태: `selling` / `reserved` / `sold`
- 기존 `community_images`의 이미지 id 배열, 최대 3장
- 판매자 제공 적용 차량 텍스트, 거래 지역, 연락 방법
- 조회수, 작성일, 수정일

`parts_favorites`:

- `listing_id`, `user_id` 복합 PK
- 매물/회원 삭제 시 cascade

커뮤니티 댓글·게시글·북마크와 의미가 달라 별도 두 테이블을 사용한다. 회원/차량/이미지 테이블을 복제하지 않는다. 이미지 형식·용량·소유권 검증은 기존 업로드 API/helper와 동일하다. 장터 테이블은 core의 Flyway 마이그레이션이 관리한다(`docs/DATABASE-MIGRATIONS.md`).

## API

모두 `/api/parts/listings` 아래:

| Method | 경로 | 기능 |
| --- | --- | --- |
| GET | `/` | 목록/검색/필터/정렬/페이지네이션 |
| POST | `/` | 로그인 회원의 판매글 등록 |
| GET | `/:id` | 공개 매물 상세. 연락 방법은 로그인 시에만 포함 |
| PUT | `/:id` | 본인 판매글 수정 |
| PATCH | `/:id/status` | 본인 판매 상태 변경 |
| DELETE | `/:id` | 본인 판매글 삭제 |
| PUT | `/:id/favorite` | 현재 회원 관심 상태 설정 `{active: boolean}` |
| POST | `/:id/view` | 실제 상세 조회 시 조회수 증가 |

목록 필터: `q`, `category`, `status`, `region`, `vehicle`, `sort`, `scope`, `page`, `limit`.

- 정렬: `latest`, `popular`(관심 수 → 조회수 → id), `price-low`, `price-high`
- 범위: 전체, `mine`, `favorites`. 개인 범위는 비로그인 401.
- 응답: `{items,total,page,limit}`. 동일 SQL statement에서 전체 개수와 페이지 결과를 계산한다.
- 기본 페이지 크기 12. 화면에는 이전/다음 및 실제 페이지 번호를 표시한다.
- 목록에는 연락 정보를 포함하지 않는다.
- 모든 변경의 판매자/관심 사용자 ID는 세션에서만 결정한다. ADMIN도 타인 판매글 수정/삭제/상태 변경 불가.

## 기존 API 재사용

- `/api/board/me`, `/api/auth/login`, `/api/auth/logout`: 기존 `REVCC_SESSION`/Redis 계약
- `/api/board/members/{currentUser.id}`: MY GARAGE 대표 차량, 판매 폼의 내 차량 선택
- `/api/board/images`: JPG/PNG/WebP, 장당 3MB, 최대 3장의 실제 판매자 사진
- `/home`: 차량 등록·관리 진입점
- 기존 회원 정보/커뮤니티 활동 링크와 `getPostUrl`

MY GARAGE는 커뮤니티와 동일한 `createMyGarageCard`를 사용한다. 비로그인/차량 없음/차량 있음/로딩/오류를 구분하고 이전 사용자 응답은 무시한다. 로그인 확인 후 같은 사용자 ID로 대표 차량을 조회한다.

## 거래와 UI

- 적용 차량은 직접 입력하거나 본인 등록 차량에서 텍스트를 가져온다. 판매 당시의 설명으로 저장하며 차량 삭제/변경에 따라 자동으로 달라지지 않는다. 호환성 보증 표시를 하지 않는다.
- 연락 방법은 판매자 입력 텍스트이며 로그인 회원에게 공개됨을 작성 폼에 안내한다. 임의 URL을 자동 실행하지 않는다. 회원끼리 직접 연락하고 거래한다.
- 상세 주소는 `/parts#listing-{id}`. 직접 진입/새로고침 가능하며 존재하지 않는 매물은 오류 안내를 표시한다.
- 최근 본 매물은 localStorage `revcc:recent-listings:v1`에 id/title/price/viewedAt만 저장한다. 성공적으로 조회한 매물만 기록하며 최대 5개, 중복 제거. 서버 DB와 동기화하지 않는다.
- 인기 사이드바는 실제 판매중인 매물을 관심 수와 조회수로 정렬한다.
- USER/ADMIN의 일반 장터 UI는 같고 관리자 NAV의 ‘관리’ 링크만 기존 정책대로 표시한다.

## 검증 결과

모두 통과:

1. `market-system.mjs`: 실제 PostgreSQL 격리 스키마/HTTP. 세션·판매자 ID 위조 차단, USER/ADMIN 타인 수정 차단, 이미지 소유권/입력 검증, 연락 정보 공개 범위, 검색/지역/차종/상태 필터, 정렬, 실제 전체 개수/페이지 결과, 관심 중복 방지, 조회/상태/수정/삭제/cascade, 커뮤니티 데이터 분리, 멱등 마이그레이션.
2. `market-browser.cjs`: 실제 USER/ADMIN/비로그인, 내 대표 차량/차량 없는 상태, 사진 포함 판매글 등록, 내 차량 정보 가져오기, 구매자 관심 매물, 수정/예약/판매완료/삭제, 13개 실제 테스트 매물 페이지 이동/새로고침, 인기 매물 클릭, 최근 본 매물 5개 제한, 삭제 후 404, 연락 정보의 로그인/로그아웃 상태, 3열/좁은 화면/Footer.
3. 기존 `community-list-browser.cjs`, `post-detail-browser.cjs`, `post-detail-live.cjs`: 커뮤니티 목록/공통 차량 카드, 작성자/viewer, canonical/댓글/답글/추천/북마크/신고/수정/삭제.
4. 기존 `home-garage-browser.cjs`: 등록/차량 CRUD/사진/정비기록/프로필/대표 차량/방명록/인증 및 관리자 화면/세션 회귀.
5. 기존 `community-system.mjs`: 공통 검증 helper 분리 후 기존 커뮤니티 API 회귀.

실제 브라우저 검사는 고유 접두어의 임시 계정/차량/매물만 생성하며 종료 후 데이터와 세션을 삭제한다. 서비스용 가짜 매물은 넣지 않았다.

## 남은 제한

- 실거래 완료 여부는 판매자가 설정한다. 결제·배송·에스크로·채팅·거래 보증은 없다.
- 조회수는 요청 횟수이며 고유 방문자 수나 부정 조회 방지 지표가 아니다. UI에서는 같은 페이지 생명주기 동안 중복 증가를 줄인다.
- 매물 신고/운영 검수/자동 만료/외부 연락처 검증은 이번 범위에 없다. 기존 커뮤니티 신고 기능과 혼합하지 않는다.
- 업로드 후 등록을 취소한 이미지나 매물에서 제거한 이미지는 기존 이미지 저장소에 남을 수 있다. 자동 미사용 이미지 정리는 별도 과제다.
- 적용 차종/지역은 판매자 텍스트이며 정규화/자동 호환 판정을 하지 않는다.
- 최근 본 매물의 제목/가격은 다른 사용자가 수정한 뒤 재조회하기 전까지 이전 값일 수 있다.

## 공통 커스텀 드롭다운 (선택 UI)

2026-09-22. `/parts`의 모든 `<select>`를 OS 기본 팝업 대신 페이지 안에서 펼쳐지는 REV.CC 드롭다운으로 통일했다. 기존에 커스텀 드롭다운 구현은 없어 새로 만들었다.

- `assignment-frontend/js/dropdown.js`, `css/dropdown.css`: 재사용 가능한 단일 컴포넌트 `RevDropdown`. `<body data-rev-dropdown>`가 있는 페이지는 동적으로 생성되는 select까지 자동 변환한다. 변환을 원하지 않는 select에는 `data-native`를 붙인다.
- 네이티브 select는 화면에서만 숨기고 값의 원본으로 남긴다. 그래서 `FormData`, `.value`, `change` 이벤트, 쿼리 파라미터, API 본문, 필터 자동 검색과 폼 제출 로직은 변경 없이 동작한다. 코드에서 바꾼 `select.value`, `form.reset()`, 옵션 갱신도 화면에 반영된다.
- 메뉴는 `position: fixed`로 트리거 바로 아래에 붙고, 공간이 부족하면 위로 뒤집히며 화면 밖으로 잘리지 않는다. 다이얼로그 안에서도 잘리지 않는다.
- 키보드: Enter/Space/방향키로 열기, 방향키/Home/End 이동, Enter 선택, ESC 닫기(다이얼로그는 유지), Tab 닫기, 영문 타입어헤드. `role=combobox`/`listbox`, `aria-activedescendant` 지원.
- 대상: 필터(카테고리, 거래 상태, 정렬), 판매글 등록/수정(카테고리, 판매 상태, 내 차량 불러오기), 상세의 판매 상태 변경.
- 지역과 적용 차종은 직접 입력 필드라 그대로 유지한다.
- 검사: `scripts/dropdown-browser.cjs`(동작/접근성/노출 전수 검사), `scripts/market-browser.cjs`(기존 E2E를 커스텀 드롭다운 조작으로 갱신).

