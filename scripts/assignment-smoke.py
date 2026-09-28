#!/usr/bin/env python3
"""Nginx 경유 실제 HTTP 검증. 매 실행 고유 계정/게시글을 만들고 결과를 출력한다."""
import json
import os
import uuid
import urllib.request
import urllib.error
import http.cookiejar

base = os.environ.get('REVCC_URL', 'http://localhost:8090')
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def request(path, data=None, expected=200, cookie=None):
    headers = {'Content-Type': 'application/json'}
    if cookie:
        headers['Cookie'] = cookie
    req = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
    try:
        response = client.open(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    payload = response.read()
    assert response.code == expected, (path, response.code, payload.decode())
    return json.loads(payload) if payload else None


request('/api/auth/me', expected=401)
request('/api/board/me', expected=401)
request('/api/board/posts', {'title': 'blocked', 'content': 'blocked'}, expected=401)
assert len(request('/api/vehicles')) == 2
username = 'smoke_' + uuid.uuid4().hex[:12]
credentials = {'username': username, 'password': 'assignment-test-123'}
user = request('/api/auth/signup', credentials, 201)
request('/api/auth/signup', credentials, 409)
request('/api/auth/signup', {'username': '', 'password': ''}, 400)
request('/api/auth/login', {**credentials, 'password': 'wrong'}, 401)
request('/api/auth/login', credentials)
assert any(c.name == 'REVCC_SESSION' and c.has_nonstandard_attr('HttpOnly') for c in jar)
core = request('/api/auth/me')
assert core == request('/api/board/me') == {'id': user['id'], 'username': username, 'role': 'USER'}
old_cookie = 'REVCC_SESSION=' + next(c.value for c in jar if c.name == 'REVCC_SESSION')
request('/api/auth/login', credentials)
request('/api/board/me', expected=401, cookie=old_cookie)
post = request('/api/board/posts', {'title': 'Docker integration test', 'content': '<script>alert(1)</script>', 'authorId': -1}, 201)
assert post['authorId'] == user['id']
assert any(p['id'] == post['id'] for p in request('/api/board/posts'))
request('/api/board/posts', {'title': ' ', 'content': 'x'}, 400)
assert request('/api/parts/compatibility?vehicleId=1')['parts'][0]['id'] == 1
assert request('/api/parts/compatibility?vehicleId=2')['parts'][0]['id'] == 2
request('/api/parts/compatibility?vehicleId=999', expected=400)
active_cookie = 'REVCC_SESSION=' + next(c.value for c in jar if c.name == 'REVCC_SESSION')
request('/api/auth/logout', {})
request('/api/auth/me', expected=401, cookie=active_cookie)
request('/api/board/me', expected=401, cookie=active_cookie)
print(json.dumps({'result': 'PASS', 'username': username, 'userId': user['id'], 'postId': post['id']}, ensure_ascii=False))
