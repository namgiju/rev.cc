# REV.CC 커뮤니티 기능

HTML 화면은 `assignment-frontend/`, API는 `board-service/`에서 제공합니다.
Next.js `frontend/`와 대문 영역은 이 작업에서 수정하지 않았습니다.

## 사용 흐름

- 로그인 후 이야기 작성: 게시판 분류, 차종, 제목, 내용과 사진 최대 3장을 등록합니다.
- 목록: 실제 카테고리·차종·키워드 검색, 최신순·인기순, 20개 단위 더 보기를 제공합니다.
- 제목 클릭: 상세 화면에서 사진, 조회 수, 추천, 북마크, 댓글과 한 단계 답글을 확인합니다.
- 작성자: 본인 글 수정·삭제, 본인 댓글 삭제가 가능합니다. 삭제한 댓글의 답글은 유지됩니다.
- 내 활동: 내 글, 댓글 남긴 글, 북마크, 내 차고, 신고 접수 내역을 확인합니다.
- 알림: 내 글 또는 내 댓글에 다른 회원이 댓글·답글을 작성하면 알림이 저장됩니다.
  알림창을 열면 읽음 처리됩니다. 페이지 로드·창 포커스·알림창 열기에서 갱신합니다.
- 내 차고: 차량 사진·차종·연식·트림·소개를 등록·수정·삭제합니다.
  정비·튜닝·부품 기록에 날짜, 주행거리와 비용을 남길 수 있습니다.
- 작성자 이름 클릭: 공개 차고와 최근 글 30개를 확인합니다.
- 상세 링크: `/#post-ID`, `/#car-ID`, `/#member-ID` 주소로 바로 열 수 있습니다.

사진은 JPG/PNG/WebP, 장당 최대 3MB입니다. 업로드는 로그인한 회원만 가능하고
본인이 올린 사진만 게시글·차량에 첨부할 수 있습니다. 사진은 PostgreSQL BYTEA로
저장하여 컨테이너 재생성과 무관하게 기존 DB 볼륨에 보존합니다.
`schema.sql`은 기존 테이블을 보존하는 재실행 가능한 마이그레이션입니다.

인기순은 추천 수 → 댓글 수 → 최신 글 순입니다. 조회 수는 같은 탭의 페이지 로드 중
각 글을 처음 열 때 증가하는 열람 횟수이며, 고유 방문자 수는 아닙니다.
신고는 DB에 접수하고 본인 접수 내역을 보여줍니다. 별도 운영자 처리 화면은 없으며
운영자는 `community_reports`를 조회할 수 있습니다. 부품 호환 조회는 기존 예시
데이터를 유지하고, 실제 사용한 부품 정보는 회원이 차량 기록으로 남깁니다.

## API

모든 아래 경로는 `/api/board` 기준입니다. 변경 요청은 JSON입니다.
기존 Spring 로그인과 동일한 `REVCC_SESSION` 쿠키로 인증합니다.

| 경로 | 메서드 | 내용 |
| --- | --- | --- |
| `/posts` | GET, POST | 목록·검색·작성 |
| `/posts/:id` | GET, PUT, DELETE | 상세·본인 글 수정·삭제 |
| `/posts/:id/view` | POST | 열람 횟수 증가 |
| `/posts/:id/like`, `/posts/:id/bookmark` | PUT | `{active: true/false}` 지정, 중복 등록 방지 |
| `/posts/:id/comments` | GET, POST | 댓글 조회·등록, 답글은 `parentId` 지정 |
| `/comments/:commentId` | DELETE | 본인 댓글 삭제 표시 |
| `/images`, `/images/:id` | POST, GET | `{data: dataURL}` 업로드·사진 조회 |
| `/notifications`, `/notifications/read` | GET, PUT | 내 알림·읽음 처리 |
| `/posts/:id/report`, `/reports` | POST, GET | `{reason}` 신고 접수·내 신고 내역 |
| `/garage` | GET, POST | 차고 목록·차량 등록 |
| `/garage/:id` | GET, PUT, DELETE | 차량·기록 상세, 본인 차량 수정·삭제 |
| `/garage/:id/records` | POST | 본인 차량 기록 추가 |
| `/garage/:id/records/:recordId` | DELETE | 본인 차량 기록 삭제 |
| `/members/:id` | GET | 공개 회원명과 최근 글 |

목록 쿼리: `q`, `category` (`free`, `maintenance`, `parts`, `drive`), `vehicle`,
`sort` (`latest`, `popular`), `scope` (`mine`, `bookmarks`, `commented`), `page`, `limit`.
개인 활동 필터는 로그인이 필요합니다. 기존 호출 호환을 위해 응답은 배열이며,
`limit` 미지정 시 최대 100개, 화면에서는 20개씩 요청합니다.

## 실행·검증

```sh
docker compose up -d --build --wait
npm test --prefix board-service
docker compose exec -T board node --input-type=module < scripts/community-system.mjs
```

통합 검사는 별도 PostgreSQL 스키마에서 실제 SQL·HTTP 동작을 검사하고 `finally`에서
스키마를 삭제합니다. 운영 게시판에 테스트 글을 남기지 않습니다. 인증은 이 검사에서
두 명의 테스트 세션을 주입하며, 실제 로그인·쿠키와 화면 연결은 별도 브라우저 검사로 확인했습니다.

기존 `assignment-smoke.py`, `assignment-system.py`는 여전히 테스트 글을 남기는 기존
과제 시연용 검사입니다. 일반 기능 검증에는 위 `community-system.mjs`를 사용합니다.

## 기존 테스트 글 정리

2026-09-20: 작성자 패턴, 제목, 본문이 자동 테스트와 정확히 일치하는 기존 글 9개를
`board_test_posts_archive` 테이블에 백업한 후 공개 게시판에서 삭제했습니다.
기존 계정은 삭제하지 않았습니다. 이번 브라우저 검사에서 만든 임시 계정과 데이터도
검사 후 정리했습니다.
