#!/bin/sh
# Compose 없이 개별 docker run으로 동일한 6개 서비스를 시연한다.
# 먼저 docker compose down으로 기존 컨테이너만 내린다. -v는 사용하지 않는다.
set -eu
cd "$(dirname "$0")/.."

# 기존 컨테이너를 자동 삭제하지 않고 충돌을 먼저 검사한다.
for service in proxy frontend core board redis postgres; do
    if docker container inspect "revcc-$service" >/dev/null 2>&1; then
        echo "revcc-$service already exists. Run docker compose down first (without -v)." >&2
        exit 1
    fi
done
docker network inspect revcc-network >/dev/null 2>&1 || docker network create --driver bridge revcc-network
docker volume inspect revcc-site_revcc_pg >/dev/null 2>&1 || docker volume create revcc-site_revcc_pg

# --network-alias는 프로그램 설정에 쓰인 postgres/redis/core 등의 DNS 이름을 제공한다.
# 영구 데이터는 이전 Compose와 정확히 동일한 named volume에 저장한다.
docker run -d --name revcc-postgres --network revcc-network --network-alias postgres \
    -e POSTGRES_DB=revcc -e POSTGRES_USER=revcc -e "POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-revcc}" \
    -v revcc-site_revcc_pg:/var/lib/postgresql/data postgres:16
docker run -d --name revcc-redis --network revcc-network --network-alias redis redis:7-alpine

# 고정 sleep만 쓰면 느린 PC에서 실패할 수 있으므로 실제 응답을 반복 확인한다.
wait_for() {
    attempts=0
    until "$@" >/dev/null 2>&1; do
        attempts=$((attempts + 1))
        if [ "$attempts" -ge 90 ]; then echo "Service readiness timeout: $*" >&2; exit 1; fi
        sleep 1
    done
}
wait_for docker exec revcc-postgres pg_isready -U revcc -d revcc
wait_for docker exec revcc-redis redis-cli ping

docker run -d --name revcc-core --network revcc-network --network-alias core \
    -e SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/revcc \
    -e POSTGRES_USER=revcc -e "POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-revcc}" \
    -e REDIS_HOST=redis -e "SESSION_COOKIE_SECURE=${SESSION_COOKIE_SECURE:-false}" revcc-core:assignment
wait_for docker exec revcc-core curl -fsS http://localhost:8080/api/vehicles

docker run -d --name revcc-board --network revcc-network --network-alias board \
    -e PGHOST=postgres -e PGDATABASE=revcc -e PGUSER=revcc \
    -e "PGPASSWORD=${POSTGRES_PASSWORD:-revcc}" -e REDIS_URL=redis://redis:6379 revcc-board:assignment
wait_for docker exec revcc-board node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

docker run -d --name revcc-frontend --network revcc-network --network-alias frontend revcc-frontend:assignment
# -p는 Nginx에만 사용한다. 나머지 서비스는 Docker 네트워크 내부에서만 접근한다.
docker run -d --name revcc-proxy --network revcc-network --network-alias proxy \
    -p "${REVCC_PORT:-8090}:80" revcc-proxy:assignment
wait_for docker exec revcc-proxy wget -qO- http://127.0.0.1/health
echo "Ready: http://localhost:${REVCC_PORT:-8090}"
