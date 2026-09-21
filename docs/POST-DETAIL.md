# 게시글 상세 3단 레이아웃

## 분석과 구현 범위

`references/badges/게시판레퍼런스.png`와 인장 레퍼런스의 정보 배치를 참고했다. 실제 파일명은 한글 분해형일 수 있다. 대상은 Next.js가 아닌 `assignment-frontend/community/index.html`의 기존 HTML 상세 페이지다.

기존 `renderPostDetail`, `getPostUrl`, API 호출, 인증 및 권한 처리를 재사용한다. 상세 페이지에만 max-width 1500px, 좌측 230px, 우측 280px, 간격 22px의 grid를 적용한다. 가운데는 남은 폭을 사용한다. 기존 폰트, 밝은 배경, 색상, 테두리, radius, 버튼 및 본문 스타일을 유지했다. 모바일용 미디어쿼리는 추가하지 않았다.

작성자와 관련 글 조회는 본문과 분리된다. 보조 조회가 실패해도 본문, 액션, 댓글은 남는다. 늦게 도착한 이전 요청이 새 상세 정보를 덮지 않도록 요청 순서를 검사한다.

## 파일

수정:

- `assignment-frontend/community/index.html`: 좌/중/우 영역과 보조 스크립트 연결
- `assignment-frontend/css/style.css`: 상세 페이지 전용 3단 구조 및 작성자/관련 콘텐츠 스타일
- `assignment-frontend/js/app.js`: 기존 상세 렌더러에 보조 정보 연결, 액션 아래·댓글 위 인장 영역
- `board-service/src/community.js`: 기존 공개 회원 API에 통계·차량·인증 정보 추가
- `board-service/src/schema.sql`: 가입일 nullable 컬럼을 멱등 추가
- `backend/src/main/java/com/revcc/app/User.java`: 신규 회원 가입 시각 저장
- `scripts/community-system.mjs`: 실제 PostgreSQL을 사용하는 회원 통계/인증/관련 글 회귀 검사 확장
- `scripts/garage-http.py`: 신규 가입일 확인, 기존에 추가된 필수 차량번호를 테스트 입력에 반영

신규:

- `assignment-frontend/js/post-context.js`: 작성자·인장·관련 글 렌더링
- `scripts/post-detail-browser.cjs`: 격리된 브라우저 응답 fixture를 사용하는 UI 회귀 검사
- `docs/POST-DETAIL.md`: 이 문서

## API와 DB

**새 API 경로는 없다.** `GET /api/board/members/:id`의 기존 `id`, `username`, `posts`를 유지하고 다음 필드를 추가했다.

`joinedAt`, `avatarUrl`, `postCount`, `commentCount`, `receivedLikes`, `vehicles`, `representativeVehicle`, `verified`, `badges`

**새 테이블은 없다.** `users.created_at`만 추가했다. 가입일이 기존 DB에 없어서 신규 회원부터 Spring JPA `@PrePersist`로 기록한다. 기존 회원은 NULL을 유지하며 화면에 ‘기록 없음’으로 표시한다. 배포 시각이나 첫 게시글 작성일로 가입일을 추정하지 않는다.

공개 회원 응답에는 비밀번호, 카카오 id, 등록증, 차량번호, 심사 상태/관리자 정보가 포함되지 않는다.

## 왼쪽 사이드바 출처

| 표시 | 데이터 출처 / 기준 |
| --- | --- |
| 프로필 | 실제 프로필 사진 저장 기능이 없어 `avatarUrl: null`. username 첫 글자를 대체 표시한다. 차량 사진을 사용자 사진으로 오인시키지 않는다. |
| 닉네임 | 기존 `users.username` |
| 오너 인증 | `owner_vehicles.verified`가 true인 차량이 하나라도 있는지 |
| 대표 표시 차량 | 인증 차량 우선, 같은 상태에서는 먼저 등록한 차량. 사용자가 직접 선택한 대표 차량이라는 의미는 아니다. |
| 가입일 | `users.created_at`, 기존 이력 없는 회원은 ‘기록 없음’ |
| 게시글 수 | 해당 작성자의 `board_posts` 전체 건수 (최근 30개 목록 크기와 별도 집계) |
| 댓글 수 | 해당 작성자의 `board_comments`, 삭제 댓글 제외, 답글 포함 |
| 받은 추천 | 해당 작성자의 게시글에 연결된 `board_likes` 건수 |
| 보유 차량 | `owner_vehicles`의 실제 모델·연식·닉네임·인증 여부, 사진은 `image_id`와 기존 이미지 API |

## 인장 출처와 미구현 사항

범용 인장 정의/획득/대표 지정 시스템은 아직 없다. 레퍼런스 이미지 속 N, 1K, 초기 멤버 등의 가상 획득 데이터를 저장하거나 사용자에게 부여하지 않는다.

현재 제공하는 것은 기존 차량 인증 상태에서 계산한 **‘인증 오너’ 표시 인장 한 종류**다. 조건은 실제 인증 차량 보유이며, 인증 상태가 해제되거나 해당 차량이 삭제되면 표시도 사라진다. 별도 획득 이력은 만들지 않는다. 인장 전용 이미지가 없으므로 체크 표식과 이름을 사용하며 본문 아래에는 조건을 함께 표시한다. 최대 3개를 표시할 수 있는 구조이나 수를 맞추기 위해 추가 인장을 생성하지 않는다. 인증 차량이 없으면 빈 상태를 표시한다.

향후 여러 인장과 대표 인장 선택을 제공하려면 인장 정의(code/name/description/image), 회원별 실제 획득·회수 이력, 대표 노출 순서와 그 조회/선택 API가 필요하다. 프로필 사진도 회원별 공개 사진 참조와 업로드/수정 API가 필요하다. 이번 레이아웃 작업에서는 이 별도 기능들을 미리 만들지 않았다.

## 오른쪽 데이터 출처

- 차종: 현재 `board_posts.vehicle` 우선, 없으면 작성자의 대표 표시 차량 모델. 둘 다 없으면 연결 차종 없음으로 표시한다.
- 차종 사진: 작성자의 보유 차량 중 모델 문자열이 정확히 일치하는 차량의 기존 사진만 표시한다. 다른 차종 사진은 사용하지 않는다.
- 바로가기: 기존 `/community?vehicle=...` 필터 목록.
- 인기글: 기존 `GET /api/board/posts?vehicle=...&sort=popular&limit=6`. 기존 서버 기준인 추천 수 → 댓글 수 → 최신 id 순서를 사용한다.
- 최신글: 기존 `GET /api/board/posts?category=...&sort=latest&limit=6`.
- 현재 글을 제외하고 최대 5개 표시한다. 모든 글 링크는 기존 `getPostUrl(post)`로 만든 `/community/{category}/{id}` 주소다.
- 기존 차종 필터는 자유 텍스트의 부분 일치 검색이다. 정규화된 차종 id 관계가 없으므로 별칭까지 같은 차종으로 판정하는 기능은 추가하지 않았다.

## 검증

- Spring Docker/Maven 빌드: 테스트 26개 통과.
- Board Docker 빌드: 단위 테스트 4개 통과.
- 실제 PostgreSQL 격리 스키마 및 HTTP: 회원 통계, 가입일 NULL/저장값, 인증/미인증 인장, 차량 목록, 민감 필드 제외, 차종/카테고리 필터, 기존 이미지·본문·조회·추천·북마크·신고·댓글·답글·수정·삭제·소유권 검사 통과. 테스트 스키마는 종료 시 제거한다.
- 실제 Redis 로그인 및 차량 API 회귀 검사: 신규 가입일 기록과 기존 가입/로그인/로그아웃/차량 CRUD 확인, 임시 계정과 차량 정리.
- 브라우저 UI: 3단 위치와 폭, 작성자/인장/차량 없는 상태, canonical 링크, 텍스트 이스케이프, 이미지 표시, 추천·북마크·링크 복사·신고, 댓글·답글·댓글 삭제, 글 수정·삭제 취소/확정, 비로그인 차단, 보조 조회 실패 시 본문 유지 확인. 브라우저 API는 fixture 응답으로 격리하며 운영 DB에는 데이터를 쓰지 않는다. 서버 권한 검증은 앞의 실제 HTTP 검사에서 별도로 확인한다.

재실행:

```sh
docker compose up -d --build --wait
docker compose exec -T board node --input-type=module < scripts/community-system.mjs
python3 scripts/garage-http.py --cleanup-accounts
# 외부에 설치한 Playwright 경로 사용. 프로젝트 dependency 추가는 필요 없다.
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright CHROME_PATH=/path/to/chrome node scripts/post-detail-browser.cjs
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.garage.yml stop
```

작업 완료 시 검증용으로 실행한 서버와 Docker 서비스를 다시 종료했다. 데이터 볼륨은 유지한다.
