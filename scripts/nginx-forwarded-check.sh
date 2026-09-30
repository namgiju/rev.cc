#!/usr/bin/env bash
# nginx가 클라이언트가 보낸 X-Forwarded-For를 core/board에 넘기지 않는지 확인한다.
# 현재 소스의 nginx 이미지와, core/board 대신 받은 헤더를 그대로 돌려주는 stub을 임시 네트워크에 띄운다.
# DB·Redis·운영 서비스는 사용하지 않는다.
#
# 사용: scripts/nginx-forwarded-check.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Windows Git Bash가 컨테이너 경로를 바꾸지 않게 한다.
cd "$(dirname "$0")/.."

ID="revcc-fwdcheck-$$"
IMAGE=revcc-proxy:forwarded-check
cleanup() {
  docker rm -f "$ID-proxy" "$ID-stub" >/dev/null 2>&1 || true
  docker network rm "$ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -q -t "$IMAGE" ./nginx >/dev/null
docker network create "$ID" >/dev/null
# nginx는 core:8080, board:3001로 프록시한다. stub이 두 이름을 모두 받아 요청 헤더를 JSON으로 돌려준다.
docker run -d --name "$ID-stub" --network "$ID" --network-alias core --network-alias board node:22-alpine \
  node -e "const h=require('http');const s=(q,r)=>r.end(JSON.stringify({xff:q.headers['x-forwarded-for'],real:q.headers['x-real-ip']}));h.createServer(s).listen(8080);h.createServer(s).listen(3001)" >/dev/null
docker run -d --name "$ID-proxy" --network "$ID" "$IMAGE" >/dev/null
until docker exec "$ID-proxy" wget -q -O /dev/null http://127.0.0.1/health 2>/dev/null; do sleep 1; done

# stub 컨테이너에서 proxy로 요청한다. nginx가 보는 $remote_addr는 stub의 IP다.
docker exec -e PROXY="http://$ID-proxy" "$ID-stub" node --input-type=module -e "
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
const self = Object.values(networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal).address;
for (const path of ['/api/auth/login', '/api/board/posts', '/api/parts/listings']) {
  for (const forged of [undefined, '198.51.100.1', '198.51.100.1, 198.51.100.2']) {
    const r = await fetch(process.env.PROXY + path, { headers: forged ? { 'X-Forwarded-For': forged } : {} });
    const seen = await r.json();
    assert.equal(seen.xff, self, path + ' X-Forwarded-For(forged=' + forged + ')');
    assert.equal(seen.real, self, path + ' X-Real-IP(forged=' + forged + ')');
  }
}
console.log('PASS nginx: client X-Forwarded-For is replaced by the address nginx sees (' + self + ') for core and board');
"
