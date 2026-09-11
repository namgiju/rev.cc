# REV.CC starter

자동차 오너 커뮤니티 MVP 초안입니다.

## 포함된 것
- `prototype/index.html`: 브라우저에서 바로 열어볼 수 있는 정적 UI 시안
- `frontend/`: Next.js 기반 프론트엔드 스타터
- `backend/`: Java 25 + Spring Boot REST API 스타터
- `docker-compose.yml`: PostgreSQL 개발 DB

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
docker compose up -d
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
1. User/Vehicle Entity + PostgreSQL 저장
2. Garage CRUD
3. Spring Security 인증
4. 게시글/댓글
5. 이미지 업로드(R2/S3)
6. 부품장터
7. 신고/차단/관리자
8. 테스트/CI-CD/배포
