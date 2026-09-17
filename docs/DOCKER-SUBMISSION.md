# Docker 과제 제출 및 교수님 시연

## 1. 이미지 빌드 (프로젝트 루트)

아래 네 프로그램 이미지는 Apple Silicon에서는 linux/arm64로 빌드된다.
Java 23, Node 22, Nginx, PostgreSQL, Redis의 ARM 이미지를 사용하고 amd64를 강제하지 않는다.

```sh
docker build -t revcc-core:assignment ./backend
docker build -t revcc-board:assignment ./board-service
docker build -t revcc-frontend:assignment ./assignment-frontend
docker build -t revcc-proxy:assignment ./nginx
docker pull postgres:16
docker pull redis:7-alpine
```

## 2. 실행 방법 두 가지

일반 실행:

```sh
docker compose up -d --build --wait
docker ps
docker network inspect revcc-network
```

개별 `docker run` 과제 시연:

```sh
# Compose 컨테이너만 삭제. PostgreSQL named volume은 유지된다.
docker compose down
sh scripts/assignment-run.sh
python3 scripts/assignment-smoke.py
```

[scripts/assignment-run.sh](../scripts/assignment-run.sh)에 **6개 docker run 명령 전체**와
네트워크 생성·볼륨 생성·서비스 준비 대기 명령이 들어 있다.
`--network revcc-network`, `--network-alias`, `-e`, `-v`, `-p` 사용 이유를 주석으로 설명했다.
수동 실행 컨테이너는 Compose 관리 대상이 아니므로 Compose로 돌아올 때:

```sh
docker stop revcc-proxy revcc-frontend revcc-board revcc-core revcc-redis revcc-postgres
docker rm revcc-proxy revcc-frontend revcc-board revcc-core revcc-redis revcc-postgres
# 볼륨은 삭제하지 않는다. Compose가 네트워크를 올바른 label로 다시 생성하도록 비어 있는 네트워크만 삭제한다.
docker network rm revcc-network
docker compose up -d --wait
```

접속: http://localhost:8090. 다른 포트는 `REVCC_PORT=8091`로 지정한다.

## 3. 컨테이너·네트워크·내부 확인

```sh
docker ps
docker network inspect revcc-network
docker exec revcc-proxy nginx -t
docker exec revcc-frontend ls /usr/share/nginx/html
docker exec revcc-core java -version
docker exec revcc-board node --version
docker exec revcc-redis redis-cli ping
docker exec revcc-postgres psql -U revcc -d revcc -c '\dt'
docker volume inspect revcc-site_revcc_pg
docker image inspect revcc-core:assignment --format '{{.Os}}/{{.Architecture}}'
```

`revcc-network`의 Containers 항목에 정확히 6개 서비스가 나와야 한다.
외부 공개 포트는 revcc-proxy의 8090만 존재한다.

## 4. 로그인과 Redis 공유 세션 시연

브라우저에서는 아이디/비밀번호 폼 대신 "카카오로 로그인" 버튼만 제공한다.
버튼을 누르면 카카오 인증 후 Spring Boot가 세션을 만들고, Spring Boot와 Express
사용자 이름이 함께 표시된다. 카카오 로그인은 `docs/DOCKER-SUBMISSION.md`의
카카오 디벨로퍼스 설정(Redirect URI: `http://localhost:8090/api/auth/kakao/callback`)이
끝나 있어야 동작한다.

아이디/비밀번호 기반 회원가입·로그인 API 자체는 그대로 남아 있어 터미널에서는
아래처럼 같은 쿠키 파일로 시연할 수 있다. 가입 아이디는 매 시연마다 바꾼다.

```sh
curl -i http://localhost:8090/api/auth/signup -H 'Content-Type: application/json' \
  -d '{"username":"presentation-owner","password":"demo-password-123"}'
curl -i -c /tmp/revcc-demo.cookies http://localhost:8090/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"presentation-owner","password":"demo-password-123"}'
curl -b /tmp/revcc-demo.cookies http://localhost:8090/api/auth/me
curl -b /tmp/revcc-demo.cookies http://localhost:8090/api/board/me
```

두 응답의 id와 username이 동일하다. 로그인 응답의 Set-Cookie는 HttpOnly 속성을 가진다.
쿠키 파일은 인증 정보이므로 제출물에 포함하지 않는다.

```sh
# SCAN 출력 중 방금 로그인한 세션 키를 복사하여 아래 <session-key>에 넣는다.
docker exec revcc-redis redis-cli --scan --pattern 'revcc:session:*'
docker exec revcc-redis redis-cli GET '<session-key>'
docker exec revcc-redis redis-cli TTL '<session-key>'
```

GET 결과는 사용자 JSON, TTL은 남은 초다. JWT 검증으로 대신하는 방식이 아니라 Redis에
실제 서버 세션이 존재하며 Express도 그 JSON을 직접 읽는다.

```sh
curl -b /tmp/revcc-demo.cookies http://localhost:8090/api/board/posts \
  -H 'Content-Type: application/json' \
  -d '{"title":"Avante N 브레이크 패드","content":"호환 부품 정보를 공유합니다."}'
curl http://localhost:8090/api/board/posts
curl -b /tmp/revcc-demo.cookies http://localhost:8090/api/auth/logout \
  -H 'Content-Type: application/json' -d '{}'
# 로그아웃 전 쿠키를 재사용해도 두 API 모두 401이어야 한다.
curl -i -b /tmp/revcc-demo.cookies http://localhost:8090/api/auth/me
curl -i -b /tmp/revcc-demo.cookies http://localhost:8090/api/board/me
```

## 5. PostgreSQL 영속성

```sh
docker exec revcc-postgres psql -U revcc -d revcc -c 'SELECT id, username FROM users;'
docker exec revcc-postgres psql -U revcc -d revcc -c 'SELECT * FROM vehicles;'
docker exec revcc-postgres psql -U revcc -d revcc -c 'SELECT id, title, author_id FROM board_posts;'
docker restart revcc-postgres
# DB 준비가 된 후 위 SELECT를 반복하여 같은 데이터가 남아 있는지 확인한다.
docker exec revcc-postgres pg_isready -U revcc -d revcc
```

Compose 실행에서는 `python3 scripts/assignment-system.py`가 실제 세션 JSON·TTL,
양쪽 서버 재시작, DB 재시작과 재생성, 회원/차량/게시글 전체 데이터 일치, API 복구를 검사한다.
`docker compose down -v`나 `docker volume rm`은 사용하지 않는다.

## 6. Docker Hub 제출

Docker Hub 계정 `giju1`에 4개 이미지를 모두 push 완료했다 (Apple Silicon에서 빌드한
linux/arm64 단일 플랫폼 이미지).

```sh
docker login
export REVCC_HUB=giju1
for component in proxy frontend core board; do
  docker tag "revcc-${component}:assignment" "$REVCC_HUB/revcc-${component}:assignment"
  docker push "$REVCC_HUB/revcc-${component}:assignment"
done
```

제출 링크:

- https://hub.docker.com/r/giju1/revcc-proxy
- https://hub.docker.com/r/giju1/revcc-frontend
- https://hub.docker.com/r/giju1/revcc-core
- https://hub.docker.com/r/giju1/revcc-board

PostgreSQL과 Redis는 공식 `postgres:16`, `redis:7-alpine` 이미지를 사용한다.
다른 ARM 컴퓨터에서는 pull 후 로컬 태그를 맞추면 동일한 run 스크립트를 사용할 수 있다:

```sh
for component in proxy frontend core board; do
  docker pull "$REVCC_HUB/revcc-${component}:assignment"
  docker tag "$REVCC_HUB/revcc-${component}:assignment" "revcc-${component}:assignment"
done
```

교수님 PC가 x86이라면 단일 ARM 이미지 대신 아래 멀티 플랫폼 빌드로 게시한다:

```sh
docker buildx create --name revcc-multi --use
docker buildx build --platform linux/amd64,linux/arm64 -t "$REVCC_HUB/revcc-core:assignment" --push ./backend
docker buildx build --platform linux/amd64,linux/arm64 -t "$REVCC_HUB/revcc-board:assignment" --push ./board-service
docker buildx build --platform linux/amd64,linux/arm64 -t "$REVCC_HUB/revcc-frontend:assignment" --push ./assignment-frontend
docker buildx build --platform linux/amd64,linux/arm64 -t "$REVCC_HUB/revcc-proxy:assignment" --push ./nginx
```

멀티 플랫폼 원격 게시 및 x86 실행은 아직 검증하지 않았다. 이 환경에서의 검증은 Apple Silicon ARM 실행이며,
Docker Hub에 올라간 이미지도 현재는 linux/arm64 단일 플랫폼이다. 교수님 PC가 x86이라면 위
buildx 멀티 플랫폼 빌드로 다시 게시해야 한다.

참고: [Docker 사용자 정의 bridge](https://docs.docker.com/engine/network/drivers/bridge/),
[공식 멀티 플랫폼 빌드 안내](https://docs.docker.com/build/building/multi-platform/).
