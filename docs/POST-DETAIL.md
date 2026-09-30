# 커뮤니티 게시글 상세

2026-09-21 정정 요청 반영. 레퍼런스는 공개 차고가 아닌 게시글 상세 디자인이다. `/home`은 로그인 사용자의 개인 차고로 유지한다. 직전 미완성 공개 차고 경로, 방명록 UI/API/스키마 변경은 철회했다. 해당 방명록 스키마는 DB에 적용하지 않았다.

## 화면과 변경 파일

네 카테고리 `free`, `maintenance`, `parts`, `drive` 모두 기존 `community/index.html`, `renderPostDetail()` 및 `renderPostContext()`를 공유한다. 새 프레임워크나 카테고리별 상세 페이지는 없다.

이번 변경:

- `assignment-frontend/js/post-context.js`: 실제 작성자 차량 사진이 있는 경우 카드 상단 사진, 중앙 닉네임/이니셜/인증 표시, 차량 트림, 상세 인장 전체 표시, 관련 글 이미지가 없는 경우 작성자 이니셜.
- `assignment-frontend/css/style.css`: 데스크톱 270px / 가변 본문 / 310px, 간격 22px, 최대 1500px. 작성자 카드, 육각형 인증 인장, 관련 콘텐츠, 댓글 작성 영역 스타일. 새 미디어쿼리 없음.
- `assignment-frontend/js/app.js`: 댓글 작성 영역을 목록 앞으로 이동. 차량 없는 작성자를 무조건 ‘오너’라고 표시하던 문구 제거. 기존 이벤트/API/권한 재사용.
- `scripts/post-detail-browser.cjs`: 변경된 레이아웃 폭 검증.
- `scripts/post-detail-live.cjs`: 실제 회원/Redis 세션/차량 인증/게시글을 통한 사용자 구분과 canonical 회귀 검사. 고유 이름의 임시 계정만 생성하고 마지막에 관련 데이터와 세션 정리.
- `docs/POST-DETAIL.md`: 현재 범위와 검증 결과.

이전에 완료한 개인 차고 변경 파일들은 기존 작업으로 유지하며 이번 게시글 디자인 변경과 구분한다.

## 실제 데이터 출처

| 영역 | 데이터 |
| --- | --- |
| 작성자 | `GET /api/board/members/{post.authorId}`. `users.username`, `users.created_at`, 실제 게시글/삭제되지 않은 댓글/받은 추천 집계 |
| 작성자 차량 | 회원 API 내부 `owner_vehicles.owner_id = post.authorId`. 실제 DB 컬럼은 `user_id`가 아닌 `owner_id` |
| 대표 표시 차량 | 인증 차량 우선, 동일 인증 상태는 등록 id 오름차순. 사용자 지정 대표 차량 기능은 없음 |
| 인장 | 회원 API `badges`. 실제 `owner_vehicles.verified`에서 파생되는 ‘인증 오너’만 존재. 가짜 초기 멤버/1K 인장 없음 |
| 오른쪽 차종 | 게시글 `vehicle` 우선, 없으면 작성자의 대표 차량 모델. 사진은 작성자 차량 중 모델이 정확히 일치하는 경우만 사용 |
| 차종 인기글 | 기존 `GET /api/board/posts?vehicle=...&sort=popular&limit=6` |
| 같은 카테고리 최신글 | 기존 `GET /api/board/posts?category=...&sort=latest&limit=6` |

관련 목록에서 현재 글을 제외하고 최대 5개를 표시한다. 글 링크는 모두 `getPostUrl(post)`를 사용한다.

프로필 사진/커버/소개 저장 기능은 없다. 프로필 사진은 닉네임 첫 글자로 대체하며 실제 차량 사진을 프로필 사진으로 둔갑시키지 않는다. 상단 차량 사진의 alt는 ‘작성자의 차량’으로 구분한다. 가입일 이력이 없으면 ‘기록 없음’, 차량과 인장이 없으면 각각 빈 상태를 표시한다. 레퍼런스의 사진·숫자·인장을 실제 사용자 정보처럼 넣지 않았다.

**이번 작업에서 새 API나 DB 구조는 추가하지 않았다.** 기존 공개 회원 응답과 게시글/댓글 API로 필요한 정보가 충족된다. 차량번호와 등록증은 공개 회원 정보에 포함되지 않는다.

## viewer / author와 기존 기능

- `author`: 게시글 `authorId`로 조회한 회원. 왼쪽 전체와 본문 아래 인장은 이 회원만 사용한다.
- `viewer`: 기존 Redis 세션에 연결된 `state.user`. 추천 여부/북마크 여부/댓글 작성/수정·삭제 권한에 사용한다.
- 관리자도 같은 상세 렌더러를 사용한다. 기존 커뮤니티 정책은 본인 글만 수정/삭제 가능하므로 관리자라는 이유로 타인 글 수정/삭제를 새로 허용하지 않는다.
- 본문/이미지/조회/추천/북마크/복사/신고/댓글/답글/삭제/수정 이벤트와 API를 재사용한다. 댓글은 `board_comments`이며 방명록과 혼합하지 않는다.
- 작성자/관련 글 API가 실패해도 본문 기능을 유지한다. 이전 요청 결과가 최신 상세에 덮어쓰지 않도록 기존 요청 번호 검사를 유지한다.
- `/home`, `/admin`, 로그인/Redis/Kakao 흐름은 이번 상세 변경에서 바꾸지 않았다.

## 실제 검증 결과

모두 통과:

1. 브라우저 fixture: 3단 배치, 실제 응답 형태의 작성자/인장/사진, 차량·인장 없음, 보조 조회 실패, HTML 문자열 안전 표시, 추천/북마크/복사/신고, 댓글/답글/삭제, 게시글 수정/삭제 취소·확정, 비로그인 동작.
2. 실제 로그인 브라우저: A회원→A회원 글, A회원→B회원 글, 관리자→B회원 글, 비로그인→B회원 글. 네 카테고리마다 동일 작성자 정보/차량/인장과 새로고침 확인. B회원 차량은 실제 등록증 제출/관리자 승인 API로 인증한 임시 검사 차량.
3. 실제 HTTP/브라우저: 추천·북마크 viewer별 구분, 댓글·답글 저장, 다른 회원/관리자의 타인 글 변경 403, 비로그인 댓글 401, 관련 글 canonical 링크.
4. canonical: 네 카테고리 직접 URL 접근, 새로고침, 뒤로가기, `#post-{id}` 호환, 다른 category 경로의 canonical 교정, 없는 글 404 UI와 작성자 잔상 없음.
5. PostgreSQL 격리 스키마 검사: 회원 통계/차량/인장/민감정보 제외, 관련 글 필터, 게시글·댓글·답글·추천·북마크·신고·차량/정비기록·소유권·삭제 연쇄.
6. 기존 `/home` 실제 회귀: 비로그인/차량 없음/차량 보유/관리자, 자기 차량과 자기 활동, 등록/사진 수정/정비기록/삭제, 관리자 인증 승인, `/garage` 호환, 로그아웃·새로고침·늦은 응답 차단.

실제 검사에 사용한 임시 계정, 차량, 글, 댓글, 등록증, 세션은 정리했다. 사용자의 기존 데이터는 변경하지 않았다. 서비스는 계속 실행 상태로 둔다.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node scripts/post-detail-browser.cjs
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node scripts/post-detail-live.cjs
scripts/run-board-system.sh scripts/community-system.mjs
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node scripts/home-garage-browser.cjs
```

## 남은 제약

프로필 이미지/소개, 사용자 지정 대표 차량, 범용 인장 획득/대표 지정은 현재 지원하지 않는다. 관련 차종 검색은 정규화된 차종 id가 아닌 기존 모델 텍스트 부분 일치다. 이번 범위는 데스크톱이며 새 반응형 작업은 하지 않았다.
