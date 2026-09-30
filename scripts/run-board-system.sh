#!/usr/bin/env bash
# board 수동 시스템 테스트(*-system.mjs)를 임시 PostgreSQL에서 실행한다. 운영/Neon DB에는 연결하지 않는다.
# 각 스크립트는 격리 스키마를 만들고 core의 Flyway 마이그레이션(V*.sql)을 버전 순서대로 적용한 뒤 끝나면 지운다.
#
# 사용: scripts/run-board-system.sh                          # 5개 전부
#       scripts/run-board-system.sh scripts/market-system.mjs  # 일부만
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Windows Git Bash가 컨테이너 경로를 바꾸지 않게 한다.

cd "$(dirname "$0")/.."
ROOT=$(pwd -W 2>/dev/null || pwd) # docker -v에는 Windows에서 C:/... 형식이 필요하다.
SCRIPTS=("$@")
[ ${#SCRIPTS[@]} -gt 0 ] || SCRIPTS=(scripts/admin-system.mjs scripts/community-system.mjs scripts/market-system.mjs scripts/moderation-system.mjs scripts/withdrawn-member-system.mjs)

ID="revcc-systest-$$"
cleanup() {
  docker rm -f "$ID-node" "$ID-pg" >/dev/null 2>&1 || true
  docker network rm "$ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$ID" >/dev/null
docker run -d --name "$ID-pg" --network "$ID" \
  -e POSTGRES_USER=revcc -e POSTGRES_PASSWORD=revcc -e POSTGRES_DB=revcc_systest postgres:16 >/dev/null
# 초기화 중에는 TCP를 열지 않으므로 TCP 접속이 되면 준비된 것이다.
until docker exec "$ID-pg" psql -h 127.0.0.1 -U revcc -d revcc_systest -Atc "SELECT 1" >/dev/null 2>&1; do sleep 1; done

# board 소스 사본 + 마이그레이션 + helper를 /app에 두고 의존성을 한 번만 설치한다.
docker run -d --name "$ID-node" --network "$ID" \
  -e PGHOST="$ID-pg" -e PGUSER=revcc -e PGPASSWORD=revcc -e PGDATABASE=revcc_systest \
  -e REVCC_SYSTEM_TEST_DB=isolated \
  -v "$ROOT/board-service:/board:ro" \
  -v "$ROOT/backend/src/main/resources/db/migration:/migrations:ro" \
  -v "$ROOT/scripts/lib:/lib-src:ro" \
  node:22-alpine sleep infinity >/dev/null
docker exec "$ID-node" sh -c "mkdir -p /app/scripts && cp -r /board/. /app && rm -rf /app/node_modules \
  && cp -r /migrations /app/db-migration && cp -r /lib-src /app/scripts/lib && cd /app && npm ci --silent"

status=0
for script in "${SCRIPTS[@]}"; do
  echo "=== $script"
  docker exec -i -w /app "$ID-node" node --input-type=module < "$script" || status=1
done
exit $status
