# My Garage 구현 및 검증

## 기존 구조 분석

- Spring Boot 3.5 / Java 23, `com.revcc.app` 패키지. 회원은 JPA `User` / `UserRepository`, 기존 차량 카탈로그는 JdbcTemplate `VehicleRepository`를 사용한다.
- PostgreSQL 스키마는 Spring의 `ddl-auto: update`와 Express의 멱등 SQL 초기화로 관리한다. 별도 마이그레이션 라이브러리는 추가하지 않았다.
- `SharedSessionService`가 Redis `revcc:session:<token>`에 회원 id와 username을 저장한다. TTL은 1,800초이며 `REVCC_SESSION` HttpOnly 쿠키로 Spring과 Express가 같은 세션을 조회한다.
- 기존 회원가입, 로그인, 로그아웃, `/api/auth/me`, Kakao 인증을 유지한다. 차량 API도 이 세션 서비스를 재사용한다.
- 기존 `GET /api/vehicles`는 `vehicles` 테이블의 공용 카탈로그 목록이다. 소유 차량 테이블은 HTML 커뮤니티에서 이미 사용하는 `owner_vehicles`이며, 두 테이블의 id는 별개다.
- 기존 테이블: `users`, `vehicles`, `owner_vehicles`, `vehicle_records`, `community_images`, `board_posts`, `comments`, `likes`, `bookmarks`, `notifications`, `reports`, `board_test_posts_archive`.
- 기존 Docker 구성은 nginx proxy, HTML frontend, Spring core, Express board, PostgreSQL, Redis의 6개 서비스다. nginx가 기존 API 경로를 각 서비스로 전달한다.
- `frontend/`는 Next.js App Router 프로젝트다. 기존 첫 화면은 로컬 상태 기반 프로토타입이다. 새 차고 화면은 실제 서버 인증을 사용하며, 첫 화면에는 차고 이동 링크만 연결했다. 기존 HTML 대문은 이 작업에서 변경하지 않았다.

## 데이터 및 권한

새 JPA `Vehicle`은 기존 `owner_vehicles`를 재사용한다. `User`와 지연 로딩 1:N 관계를 가지며 Entity 대신 DTO를 반환한다.

| API 필드 | DB 컬럼 |
| --- | --- |
| id | id (기존 SERIAL 유지) |
| userId | owner_id |
| manufacturer, model, trim, transmission, color, nickname | 동일 이름 |
| modelYear | year |
| description | bio |
| createdAt, updatedAt | created_at, updated_at |

제조사, 변속기, 색상, 닉네임, 수정 시각 컬럼만 추가했다. 기존 행의 누락된 문자열은 빈 문자열로 보존하며 제조사 등을 임의로 추정하지 않는다. 기존 차량을 새 화면에서 수정할 때는 필수 제조사를 입력해야 한다. 기존 사진 참조 및 정비 기록 관계도 유지한다. 신규 DB에서 Spring이 먼저 테이블을 만드는 경우에도 Express 초기화가 사진 외래 키를 보완한다.

제조사와 모델, 1900~2100 범위 연식은 필수다. 선택 문자열은 생략하면 빈 문자열로 저장한다. 생성 및 수정 시각은 PostgreSQL과 일치하도록 마이크로초 정밀도를 사용한다.

| API | 권한 / 결과 |
| --- | --- |
| POST `/api/garage/vehicles` | 로그인 필수, 201 및 Location |
| GET `/api/garage/vehicles` | 로그인 필수, 본인 차량만 반환 |
| GET `/api/vehicles/{vehicleId}` | 공개 프로필, 소유자 username 포함 |
| PUT `/api/garage/vehicles/{vehicleId}` | 소유자만 수정 |
| DELETE `/api/garage/vehicles/{vehicleId}` | 소유자만 삭제, 204 |

사용자 id는 Redis 세션에서만 얻는다. 요청의 userId로 소유자를 지정하거나 변경할 수 없다. 미로그인은 401, 타인의 차량 변경은 403, 없는 차량은 404, 입력 오류는 400이다. 기존 `GET /api/vehicles` 카탈로그 API는 그대로 유지된다.

이번 API와 Next.js 화면에는 사진, 튜닝/정비 기록, 판매, 팔로우, 좋아요, 피드, 모임을 추가하지 않았다. 기존 HTML에서 이미 제공하던 기능은 유지하며 향후 소유 차량 id로 연결할 수 있다.

## 화면과 실행

- `/garage`: 실제 로그인/회원가입, 내 차량 목록, 등록 버튼
- `/garage/new`: 8개 차량 정보 입력 후 생성한 프로필로 이동
- `/vehicles/{vehicleId}`: 공개 차량 프로필 및 소유자 username
- `/garage/{vehicleId}/edit`: 소유자의 차량 수정
- 프로필에서 소유자만 수정/삭제 버튼을 볼 수 있다. 실제 권한은 서버에서도 검사한다.

기존 HTML 사이트와 Next.js 차고를 함께 실행:

```sh
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.garage.yml up -d --build --wait
```

HTML은 http://localhost:8090, Next.js 차고는 http://localhost:3000/garage 이다. 선택 구성 파일이 기존 6개 서비스에 `garage-ui`를 추가한다. 중지할 때도 같은 `-f` 옵션을 사용한다.

로컬 Next 개발은 기존 Docker API가 실행 중인 상태에서:

```sh
cd frontend
npm ci
npm run dev
```

Next.js는 동일 출처 `/api/*` 요청을 기본 `http://localhost:8090`으로 전달한다. Docker 이미지에서는 빌드 인자 `REVCC_API_ORIGIN=http://proxy`를 사용한다. 목적지를 변경하면 다시 빌드해야 한다. 새 프로젝트 의존성은 추가하지 않았다.

## 검증 결과

- Backend Docker/Maven 빌드 성공, 기존 테스트 포함 14개 통과.
- Next.js 프로덕션 빌드 및 Docker 이미지 빌드 성공.
- Express 기존 단위 테스트 4개와 격리 DB를 사용하는 커뮤니티 HTTP 회귀 검사 통과.
- 실제 HTTP로 8090 및 Next.js 프록시 3000 양쪽에서 회원가입/로그인/me/로그아웃, Redis 공유 세션, 비로그인 등록 차단, 복수 차량 등록, 본인 목록, 공개 상세, 본인 수정/삭제, 타인 수정/삭제 차단, userId 위조 무시, 입력 검증, 기존 카탈로그 및 HTML 차고 호환 확인.
- 실제 브라우저에서 회원가입, 등록, 공개 상세, 수정 후 새로고침, 목록 이동, 삭제 취소/확정, 로그아웃 확인. 입력한 HTML은 텍스트로 표시된다.
- 별도 PostgreSQL 스키마에서 Spring 신규 테이블 생성, Express 초기화 2회 실행, 기존 형식 차량 삽입, 사진/기록 외래 키와 회원 삭제 cascade 확인.
- 검증 과정에서 만든 계정과 차량, 임시 스키마 및 컨테이너는 정리했다.

재실행 가능한 HTTP 검사(실행 중인 Docker 및 로컬 Python 3 필요):

```sh
python3 scripts/garage-http.py --cleanup-accounts
REVCC_URL=http://localhost:3000 python3 scripts/garage-http.py --cleanup-accounts
python3 scripts/garage-schema-check.py
```

HTTP 검사는 고유 이름의 테스트 계정과 차량을 만들고 정리한다. `--cleanup-accounts`는 로컬 Docker PostgreSQL에서 해당 테스트 계정만 삭제하므로 로컬 스택 검증에 사용한다.
