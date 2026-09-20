# REV.CC starter

My Garage 구현 구조와 검증 결과: [docs/MY-GARAGE.md](docs/MY-GARAGE.md)

기존 HTML 사이트와 Next.js 차고를 함께 실행:

```sh
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.garage.yml up -d --build --wait
# HTML: http://localhost:8090
# My Garage: http://localhost:3000/garage
```

## Docker 과제 (`docker-assignment`)

6개 컨테이너 실행, Redis 공유 로그인, API 및 테스트 설명: [ASSIGNMENT.md](ASSIGNMENT.md)

```sh
docker compose up -d --build --wait
# http://localhost:8090
```

로컬에서는 `docker-compose.override.yml`이 자동 적용되어 `assignment-frontend/`의
HTML/CSS/JS를 직접 제공합니다. 파일 저장 후 브라우저를 새로고침하면 변경 사항이
반영되며, 다시 빌드할 필요가 없습니다. 이미지에 포함된 화면을 확인하려면
`docker compose -f docker-compose.yml up -d`로 실행합니다.


자동차 오너 커뮤니티 MVP 초안입니다.

## 포함된 것
- `prototype/index.html`: 브라우저에서 바로 열어볼 수 있는 정적 UI 시안
- `frontend/`: Next.js 기반 프론트엔드 스타터
- `backend/`: Java 23 + Spring Boot REST API 스타터
- `docker-compose.yml`: HTML, API, PostgreSQL, Redis, nginx 서비스

## 핵심 서비스 방향
- Garage: 차량 프로필, 차량 인증, 튜닝/정비 기록
- Community: 게시글/댓글 + 차량 인장
- Parts: 차량 기반 중고부품 장터
- Drive: 합법적 드라이브/오너 모임

## 빠른 미리보기
`prototype/index.html`을 브라우저로 열면 됩니다.

## 풀스택 실행
### DB
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

### Spring Boot
```bash
cd backend
mvn spring-boot:run
```
API: `http://localhost:8080/api/vehicles`

### Next.js
```bash
cd frontend
npm install
npm run dev
```
웹: `http://localhost:3000`

## 다음 구현 우선순위
User/Vehicle 저장, Redis 세션 인증, My Garage CRUD는 구현되어 있습니다.
차량 기반 게시글/부품 거래/모임 연결 등 후속 범위는 별도로 결정합니다.
