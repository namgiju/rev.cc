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

### 운영 배포 (docker-compose.prod.yml)

위의 `docker compose up -d --build --wait`는 **로컬 개발용**이다. `-f` 없이 실행하면 Compose가
`docker-compose.override.yml`(로컬 HTML 직접 마운트)을 자동으로 병합하고,
`docker-compose.prod.yml`의 운영 하드닝은 전혀 적용되지 않는다.
운영 서버에서는 반드시 파일을 명시해 override가 병합되지 않게 한다:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait
```

prod 오버레이가 적용하는 것:

- 운영 DB는 Neon이다. 로컬 `postgres` 서비스와 `revcc_pg` 볼륨은 병합 결과에서 제거되어 만들어지지 않는다
  (`!reset`/`!override` 사용, Docker Compose 2.24 이상 필요). core/board는 `.env`의 `DB_HOST`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD`만 쓰며, 하나라도 없으면 기동 자체가 실패한다.
- 네트워크를 역할별로 나눈다(과제용 기본 compose의 단일 `revcc-network`는 그대로다).
  `edge`(proxy·frontend, internal), `app`(proxy·core·board, 외부 통신 가능), `data`(core·board·redis, internal).
  frontend와 proxy는 redis에 닿지 않고, redis와 frontend는 외부로 나가지 못한다.
  core/board는 `app`을 통해 Neon·Kakao·SMTP로 나간다.
- 모든 서비스가 `restart: unless-stopped`다. 프로세스가 죽거나 호스트가 재부팅되면 다시 올라오고,
  `docker compose stop`/`down`으로 멈춘 것은 올리지 않는다. healthcheck가 unhealthy인 것만으로는 재시작하지 않는다.
- DB 커넥션 풀: core 10 + board 10(평시 최대 20, 재배포 중 겹쳐도 40). 연결을 5초 안에 못 얻거나
  쿼리가 15초 안에 끝나지 않으면 요청은 503으로 끝난다. 조정 변수는 `.env.example` 참고.
- `REDIS_PASSWORD`, `KAKAO_REDIRECT_URI`가 없으면 기동 자체가 실패한다(로컬 Redis 기본 비밀번호, `localhost:8090` 콜백 차단).
  `REDIS_PASSWORD`는 영문·숫자로 만든다(예: `openssl rand -hex 32`).
- core가 `SPRING_PROFILES_ACTIVE=prod`로 실행되어 세션 쿠키가 항상 `Secure`로 나간다.
  따라서 앞단(Cloudflare 등)에서 HTTPS로 종단해야 로그인이 동작한다.
- 외부 진입은 Cloudflare Named Tunnel 하나뿐이다: 사용자 → rev.cc(Cloudflare DNS·HTTPS) → Named Tunnel →
  `cloudflared` 컨테이너 → proxy → frontend/core/board. proxy의 호스트 포트(`REVCC_PORT`)는 게시하지 않는다
  (Docker가 게시한 포트는 ufw 등 호스트 방화벽을 우회해 열리므로 Cloudflare를 거치지 않는 경로가 된다).
  `cloudflared`는 proxy와 둘만 있는 `tunnel` 네트워크의 고정 주소 172.16.238.2를 쓰고, nginx는 이 주소에서 온
  요청만 `CF-Connecting-IP`로 실제 사용자 IP를 복원한다(rate limit·로그가 사용자별로 동작). `CLOUDFLARE_TUNNEL_TOKEN`이
  없으면 기동 자체가 실패한다.
- nginx(모든 구성 공통): `server_tokens off`, `/api` rate limit 안전망(IP당 초당 20·순간 200, 로그인·가입·아이디 확인·
  비밀번호 재설정·카카오는 IP당 분당 30·순간 30, 초과 시 JSON 429), upstream 응답 대기 30초, HSTS(`max-age=300`,
  Cloudflare를 거친 HTTPS 요청에만).

#### Cloudflare Named Tunnel 준비 (Dashboard에서 1회)

1. Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel → **Cloudflared** 선택, 이름 지정.
2. 설치 명령에 나오는 토큰(`--token` 뒤의 긴 값)을 운영 `.env`의 `CLOUDFLARE_TUNNEL_TOKEN`에 넣는다(비밀번호처럼 취급).
   설치 명령 자체는 실행하지 않는다 — compose의 `cloudflared` 서비스가 같은 일을 한다.
3. Public Hostname: `rev.cc`(경로 비움) → Service `HTTP`, URL `proxy:80`. DNS CNAME은 Cloudflare가 만든다.
   기존에 rev.cc를 서버 IP로 가리키던 A/AAAA 레코드가 있으면 지운다.
4. SSL/TLS → Edge Certificates에서 **Always Use HTTPS**를 켠다(nginx도 `X-Forwarded-Proto: http`면 301로 보낸다).
   Cloudflare의 HSTS 설정은 켜지 않는다(nginx가 보낸다. 둘 다 켜면 값이 겹친다).
5. Rules → Transform Rules의 **Remove visitor IP headers**를 켜지 않는다(켜면 `CF-Connecting-IP`가 사라져
   모든 사용자가 rate limit 버킷 하나를 공유한다).

운영 반영 후 확인:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps          # cloudflared가 healthy
docker compose -f docker-compose.yml -f docker-compose.prod.yml port proxy 80 # 게시된 포트가 없어야 한다(오류)
curl -sI https://rev.cc/ | grep -i strict-transport-security                  # max-age=300
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs proxy | tail   # 첫 칸이 실제 사용자 IP(172.16.238.2가 아님)
```

nginx IP 신뢰 경계·rate limit·HSTS 동작은 `scripts/nginx-forwarded-check.sh`로 로컬에서 확인할 수 있다
(운영 스택이 떠 있지 않은 PC에서 실행).

적용 여부는 실행 전에 병합 결과로 확인할 수 있다:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --services   # postgres가 없고 cloudflared가 있어야 한다
docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -E 'SPRING_PROFILES_ACTIVE|KAKAO_REDIRECT_URI'
```

`config` 전체 출력에는 `.env`의 비밀번호가 그대로 찍히므로 공유하거나 로그에 남기지 않는다.

기본(과제) compose의 Redis도 인증을 요구한다. `REDIS_PASSWORD`를 정하지 않으면 로컬 기본값 `revcc-local-redis`를 쓴다.
컨테이너 밖에서 `docker-compose.dev.yml`의 Redis(127.0.0.1:6379)에 Spring/Node를 직접 붙일 때는
같은 값을 `REDIS_PASSWORD` 환경변수로 넘겨야 한다.

`-f docker-compose.yml -f docker-compose.prod.yml`로 올렸다면 이후 `ps`, `logs`, `down` 등도
같은 `-f` 조합으로 실행해야 같은 설정을 대상으로 한다.

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
