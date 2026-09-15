#!/usr/bin/env python3
"""Docker 재생성과 Redis TTL을 검증한다. 실행 중인 과제 DB를 잠시 재생성한다.
볼륨은 삭제하지 않고, smoke 테스트가 만든 데이터만 사용한다.
"""
import json
import runpy
import subprocess
import time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
ctx = runpy.run_path(str(root / 'scripts/assignment-smoke.py'))
request = ctx['request']


def compose(*args):
    return subprocess.check_output(['docker', 'compose', *args], cwd=root, text=True).strip()


def sql(query):
    return compose('exec', '-T', 'postgres', 'psql', '-U', 'revcc', '-d', 'revcc', '-Atc', query)


# 두 API는 동일한 Redis TTL을 기준으로 만료되어야 한다.
request('/api/auth/login', ctx['credentials'])
token = next(c.value for c in ctx['jar'] if c.name == 'REVCC_SESSION')
key = 'revcc:session:' + token
ttl = int(compose('exec', '-T', 'redis', 'redis-cli', 'TTL', key))
assert 1700 < ttl <= 1800
assert json.loads(compose('exec', '-T', 'redis', 'redis-cli', 'GET', key)) == request('/api/board/me')
compose('exec', '-T', 'redis', 'redis-cli', 'EXPIRE', key, '1')
time.sleep(1.2)
request('/api/auth/me', expected=401)
request('/api/board/me', expected=401)

# 메모리 세션이 아닌지 core·board를 재시작하여 동일 쿠키로 확인한다.
request('/api/auth/login', ctx['credentials'])
identity = request('/api/auth/me')
compose('restart', 'core', 'board')
for attempt in range(40):
    try:
        assert request('/api/auth/me') == request('/api/board/me') == identity
        break
    except (AssertionError, OSError):
        if attempt == 39:
            raise
        time.sleep(1)

# DB 컨테이너 ID가 바뀌어도 기존 회원 전체와 게시글 데이터가 유지되는지 확인한다.
query = "SELECT json_build_object('users', (SELECT json_agg(row_to_json(u) ORDER BY u.id) FROM users u), 'vehicles', (SELECT json_agg(row_to_json(v) ORDER BY v.id) FROM vehicles v), 'posts', (SELECT json_agg(row_to_json(p) ORDER BY p.id) FROM board_posts p));"
vehicles_before = request('/api/vehicles')
before = sql(query)
# 재시작 자체도 검증한 뒤 컨테이너 재생성으로 볼륨 보존을 한 번 더 확인한다.
compose('restart', 'postgres')
compose('up', '-d', '--wait', 'postgres')
assert sql(query) == before
container_before = compose('ps', '-q', 'postgres')
compose('up', '-d', '--force-recreate', '--wait', 'postgres')
assert compose('ps', '-q', 'postgres') != container_before
assert sql(query) == before
# DB 연결 풀이 재연결한 뒤 HTTP 조회도 다시 정상이어야 한다.
for attempt in range(40):
    try:
        assert request('/api/auth/me') == identity
        assert request('/api/vehicles') == vehicles_before
        assert any(p['id'] == ctx['post']['id'] for p in request('/api/board/posts'))
        break
    except (AssertionError, OSError):
        if attempt == 39:
            raise
        time.sleep(1)
print('PASS: Redis JSON/TTL, sessions after service restart, all DB rows after container recreation')
