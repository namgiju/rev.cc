#!/usr/bin/env bash
# nginx의 클라이언트 IP 신뢰 경계와 STEP 9 하드닝을 실제 요청으로 확인한다.
#  - 클라이언트가 보낸 X-Forwarded-For·CF-Connecting-IP·Forwarded 등으로 core/board가 보는 IP를 바꿀 수 없다
#  - cloudflared 고정 주소(172.16.238.2)에서 온 요청만 CF-Connecting-IP로 실제 IP를 복원한다
#  - HSTS는 cloudflared 경유 + X-Forwarded-Proto: https일 때만 붙는다
#  - limit_req: 사용자(복원된 IP)별 버킷, 인증 zone/전체 zone, 429 JSON 응답, 보안 헤더 유지
#  - server_tokens off, nginx -t, 설정의 신뢰 주소와 docker-compose.prod.yml의 cloudflared 주소 일치
# 현재 소스의 nginx 이미지와, core/board/frontend 대신 받은 헤더를 그대로 돌려주는 stub을 임시 네트워크에 띄운다.
# 임시 네트워크는 운영 tunnel 네트워크와 같은 대역을 쓰므로 운영 스택이 떠 있는 호스트에서는 실행하지 않는다.
# DB·Redis·운영 서비스와 Cloudflare는 사용하지 않는다.
#
# 사용: scripts/nginx-forwarded-check.sh   (NGINX_CONTEXT=<dir>로 다른 nginx 빌드 디렉터리를 검사할 수 있다)
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Windows Git Bash가 컨테이너 경로를 바꾸지 않게 한다.
cd "$(dirname "$0")/.."

TUNNEL_IP=172.16.238.2
CONTEXT="${NGINX_CONTEXT:-./nginx}"
# 설정 파일의 신뢰 주소와 운영 오버레이의 cloudflared 주소가 어긋나면 운영에서 실제 IP 복원·HSTS가 조용히 꺼진다.
grep -q "^set_real_ip_from $TUNNEL_IP;" "$CONTEXT/default.conf" || { echo "FAIL default.conf set_real_ip_from != $TUNNEL_IP"; exit 1; }
grep -q "\"$TUNNEL_IP:https\"" "$CONTEXT/default.conf" || { echo "FAIL default.conf HSTS map != $TUNNEL_IP"; exit 1; }
grep -q "ipv4_address: $TUNNEL_IP" docker-compose.prod.yml || { echo "FAIL docker-compose.prod.yml cloudflared ipv4_address != $TUNNEL_IP"; exit 1; }

ID="revcc-fwdcheck-$$"
IMAGE=revcc-proxy:forwarded-check
cleanup() {
  docker rm -f "$ID-proxy" "$ID-stub" "$ID-tunnel" "$ID-other" "$ID-other2" >/dev/null 2>&1 || true
  docker network rm "$ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -q -t "$IMAGE" "$CONTEXT" >/dev/null
# 운영 tunnel 네트워크와 같은 모양: 고정 주소는 동적 할당 범위(ip_range) 밖에 둔다.
docker network create --subnet 172.16.238.0/28 --ip-range 172.16.238.8/29 "$ID" >/dev/null
# nginx는 core:8080, board:3001, frontend:80으로 프록시한다. stub이 세 이름을 모두 받아 요청 헤더를 JSON으로 돌려준다.
docker run -d --name "$ID-stub" --network "$ID" --network-alias core --network-alias board --network-alias frontend node:22-alpine \
  node -e "const h=require('http');const s=(q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({path:q.url,headers:q.headers}))};for(const p of [8080,3001,80])h.createServer(s).listen(p)" >/dev/null
docker run -d --name "$ID-proxy" --network "$ID" "$IMAGE" >/dev/null
# tunnel: cloudflared 자리(신뢰 주소). other: 그 밖의 모든 발신지(로컬 포트 접속, 다른 컨테이너)를 대표한다.
docker run -d --name "$ID-tunnel" --network "$ID" --ip "$TUNNEL_IP" node:22-alpine sleep 600 >/dev/null
docker run -d --name "$ID-other" --network "$ID" node:22-alpine sleep 600 >/dev/null
# other2: 앞선 검사 요청이 섞이지 않은 새 비신뢰 발신지(rate limit 버킷 검사 전용).
docker run -d --name "$ID-other2" --network "$ID" node:22-alpine sleep 600 >/dev/null
until docker exec "$ID-proxy" wget -q -O /dev/null http://127.0.0.1/health 2>/dev/null; do sleep 1; done
docker exec "$ID-proxy" nginx -t 2>&1 | grep -q "test is successful" || { echo "FAIL nginx -t"; exit 1; }
echo "PASS nginx -t"

# 세 클라이언트에서 같은 검사 코드를 실행한다. ROLE이 신뢰 여부를, PARTS가 실행할 검사를 정한다.
CHECK=$(cat <<'JS'
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
const self = Object.values(networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal).address;
const trusted = process.env.ROLE === 'tunnel';
const base = process.env.PROXY;
const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
const seen = async (path, headers) => (await (await get(path, headers)).json()).headers;
const ipHeaders = ['x-forwarded-for', 'x-real-ip'];
const dropped = ['forwarded', 'cf-connecting-ip', 'true-client-ip', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-prefix', 'x-forwarded-ssl'];
const forgeries = [
  {}, { 'X-Forwarded-For': '198.51.100.1' }, { 'X-Forwarded-For': '198.51.100.1, 198.51.100.2' },
  { 'Forwarded': 'for=198.51.100.3' }, { 'True-Client-IP': '198.51.100.4' }, { 'X-Real-IP': '198.51.100.5' },
  { 'X-Forwarded-Host': 'evil.test', 'X-Forwarded-Port': '1234', 'X-Forwarded-Prefix': '/x', 'X-Forwarded-Ssl': 'on' },
];
const apiPaths = ['/api/auth/login', '/api/board/posts', '/api/parts/listings'];
const run = (part) => (process.env.PARTS ?? "headers,ratelimit").split(",").includes(part);

if (run("headers")) {
// 1) 전달 헤더: 백엔드는 nginx가 정한 IP 하나만 받고, 다른 전달 헤더는 받지 않는다.
for (const path of apiPaths) for (const forged of forgeries) {
  const h = await seen(path, forged);
  const expected = self; // CF-Connecting-IP가 없으면 신뢰 주소여도 연결 주소 그대로다.
  for (const k of ipHeaders) assert.equal(h[k], expected, `${path} ${k} forged=${JSON.stringify(forged)}`);
  for (const k of dropped) assert.equal(h[k], undefined, `${path} ${k} must not reach backend (forged=${JSON.stringify(forged)})`);
}
for (const path of apiPaths) {
  const h = await seen(path, { 'CF-Connecting-IP': '203.0.113.10', 'X-Forwarded-For': '198.51.100.1', 'Forwarded': 'for=198.51.100.3' });
  for (const k of ipHeaders) assert.equal(h[k], trusted ? '203.0.113.10' : self, `${path} ${k} with CF-Connecting-IP`);
  assert.equal(h['cf-connecting-ip'], undefined);
}
// 요청마다 CF-Connecting-IP·X-Forwarded-For를 바꿔도 비신뢰 발신지는 항상 같은 주소로 보인다.
for (let i = 0; i < 5; i++) {
  const h = await seen('/api/auth/login', { 'CF-Connecting-IP': `203.0.113.${20 + i}`, 'X-Forwarded-For': `198.51.100.${20 + i}` });
  assert.equal(h['x-forwarded-for'], trusted ? `203.0.113.${20 + i}` : self);
}
if (trusted) {
  assert.equal((await seen('/api/board/posts', { 'CF-Connecting-IP': '2001:db8::7' }))['x-forwarded-for'], '2001:db8::7', 'IPv6 client');
  assert.equal((await seen('/api/board/posts', { 'CF-Connecting-IP': 'not-an-ip' }))['x-forwarded-for'], self, 'invalid CF-Connecting-IP falls back to peer');
  // realip는 목록이면 마지막 값을 쓴다. Cloudflare는 단일 값만 만들고 클라이언트 값은 엣지에서 거부하므로 목록은 오지 않는다.
  assert.equal((await seen('/api/board/posts', { 'CF-Connecting-IP': '203.0.113.1, 198.51.100.1' }))['x-forwarded-for'], '198.51.100.1', 'list CF-Connecting-IP: last value');
}
console.log(`PASS ${process.env.ROLE}: backends see ${trusted ? 'CF-Connecting-IP' : 'the connecting address ' + self}; forged XFF/CF-Connecting-IP/Forwarded/True-Client-IP/X-Forwarded-Host... ignored and not forwarded`);

// 2) HSTS: cloudflared 경유 + X-Forwarded-Proto: https일 때만.
const hsts = async (headers) => (await get('/', headers)).headers.get('strict-transport-security');
assert.equal(await hsts({}), null, 'no HSTS without X-Forwarded-Proto');
assert.equal(await hsts({ 'X-Forwarded-Proto': 'https' }), trusted ? 'max-age=300' : null, 'HSTS with X-Forwarded-Proto: https');
assert.equal(await hsts({ 'X-Forwarded-Proto': 'https', 'CF-Visitor': '{"scheme":"https"}' }), trusted ? 'max-age=300' : null);
const redirect = await get('/', { 'X-Forwarded-Proto': 'http' });
assert.equal(redirect.status, 301, 'X-Forwarded-Proto: http redirects (P0-2 unchanged)');
assert.equal(redirect.headers.get('strict-transport-security'), null, 'no HSTS on the http redirect');
const apiHsts = (await get('/api/board/posts', { 'X-Forwarded-Proto': 'https' })).headers.get('strict-transport-security');
assert.equal(apiHsts, trusted ? 'max-age=300' : null, 'HSTS on API responses too');
console.log(`PASS ${process.env.ROLE}: HSTS ${trusted ? 'max-age=300 only for X-Forwarded-Proto: https' : 'never sent (even with forged X-Forwarded-Proto: https)'}`);

// 3) server_tokens off + 기존 보안 헤더 유지
const home = await get('/');
assert.equal(home.headers.get('server'), 'nginx', 'Server header without version');
for (const [k, v] of [['x-content-type-options', 'nosniff'], ['referrer-policy', 'same-origin'], ['cache-control', 'no-store']]) assert.equal(home.headers.get(k), v, k);
assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
const notAllowed = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=b' });
assert.equal(notAllowed.status, 415, 'form POST still rejected');
assert.doesNotMatch(await notAllowed.text(), /nginx\/\d/, 'error page without version');
console.log(`PASS ${process.env.ROLE}: Server: nginx (no version), security headers and 415 form block unchanged`);

}
if (run("ratelimit")) {
// 4) rate limit. 신뢰 발신지는 CF-Connecting-IP로 사용자를 나누고, 비신뢰 발신지는 헤더를 바꿔도 한 버킷이다.
const burst = async (n, path, userIp, rotate) => {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const headers = rotate ? { 'CF-Connecting-IP': `203.0.113.${100 + (i % 100)}`, 'X-Forwarded-For': `198.51.100.${i % 250}` }
                           : userIp ? { 'CF-Connecting-IP': userIp } : {};
    const r = await get(path, headers);
    codes.push(r.status);
    if (r.status === 429 && codes.filter(c => c === 429).length === 1) {
      assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
      assert.match((await r.json()).message, /요청이 너무 많습니다/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', 'security headers on nginx 429');
      assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    }
  }
  return { ok: codes.filter(c => c === 200 || c === 302).length, limited: codes.filter(c => c === 429).length };
};
if (trusted) {
  const a = await burst(40, '/api/auth/kakao/login', '203.0.113.201');
  assert.ok(a.ok >= 31 && a.ok <= 32 && a.limited > 0, `auth zone user A: ${JSON.stringify(a)}`);
  const b = await burst(10, '/api/auth/kakao/login', '203.0.113.202');
  assert.deepEqual(b, { ok: 10, limited: 0 }, 'auth zone user B has its own bucket');
  const me = await burst(60, '/api/auth/me', '203.0.113.203');
  assert.deepEqual(me, { ok: 60, limited: 0 }, '/api/auth/me is not in the auth zone');
  const c = await burst(260, '/api/board/posts', '203.0.113.204');
  assert.ok(c.ok >= 201 && c.ok <= 240 && c.limited > 0, `api zone user C: ${JSON.stringify(c)}`);
  const d = await burst(20, '/api/board/posts', '203.0.113.205');
  assert.deepEqual(d, { ok: 20, limited: 0 }, 'api zone user D has its own bucket');
  const noIp = await burst(5, '/api/board/posts', null);
  assert.deepEqual(noIp, { ok: 5, limited: 0 });
  console.log(`PASS tunnel: auth zone ${a.ok} ok/${a.limited} 429 then other user ok, /api/auth/me ${me.ok}/60 ok, api zone ${c.ok} ok/${c.limited} 429 then other user ok`);
} else {
  const r = await burst(40, '/api/auth/kakao/login', null, true);
  assert.ok(r.ok >= 31 && r.ok <= 32 && r.limited > 0, `rotating forged headers stay in one bucket: ${JSON.stringify(r)}`);
  console.log(`PASS other: rotating CF-Connecting-IP/X-Forwarded-For every request -> one bucket (${r.ok} ok, ${r.limited} 429)`);
}
}
JS
)
docker exec -i -e ROLE=other -e PARTS=headers -e PROXY="http://$ID-proxy" "$ID-other" node --input-type=module - <<<"$CHECK"
docker exec -i -e ROLE=other -e PARTS=ratelimit -e PROXY="http://$ID-proxy" "$ID-other2" node --input-type=module - <<<"$CHECK"
docker exec -i -e ROLE=tunnel -e PROXY="http://$ID-proxy" "$ID-tunnel" node --input-type=module - <<<"$CHECK"
echo "PASS all nginx edge checks"
