#!/usr/bin/env python3
"""Real HTTP checks for My Garage; deletes its vehicles/sessions in finally.
Run: python3 scripts/garage-http.py
Optional: REVCC_URL=http://localhost:3000 to include the Next.js API proxy.
Only test accounts are retained unless --cleanup-accounts is passed (local Docker).
"""
import http.cookiejar
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get('REVCC_URL', 'http://localhost:8090').rstrip('/')

def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def request(agent, method, path, body=None, expected=200):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method,
        headers={'Content-Type': 'application/json'} if data is not None else {})
    try:
        response = agent.open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    payload = json.loads(raw) if raw else None
    assert response.status == expected, (method, path, response.status, payload)
    return payload

anonymous, owner, other = client(), client(), client()
run_id = uuid.uuid4().hex[:12]
accounts = []
vehicle_ids = []
catalog = request(anonymous, 'GET', '/api/vehicles')
body = dict(manufacturer='Hyundai', model='Avante N', modelYear=2024, trim='N',
    transmission='DCT', color='Performance Blue', nickname='기주의 아반떼 N', description='My Garage HTTP check')
try:
    for index, agent in enumerate([owner, other]):
        credentials = dict(username=f'garage_check_{run_id}_{index}', password=uuid.uuid4().hex)
        user = request(agent, 'POST', '/api/auth/signup', credentials, 201)
        accounts.append((user['id'], credentials['username']))
        request(agent, 'POST', '/api/auth/signup', credentials, 409)
        request(agent, 'POST', '/api/auth/login', dict(credentials, password='wrong'), 401)
        request(agent, 'POST', '/api/auth/login', credentials)
        assert request(agent, 'GET', '/api/auth/me')['id'] == user['id']
        assert request(agent, 'GET', '/api/board/me')['id'] == user['id']
    request(anonymous, 'POST', '/api/garage/vehicles', body, 401)
    request(anonymous, 'GET', '/api/garage/vehicles', expected=401)
    request(owner, 'POST', '/api/garage/vehicles', dict(body, modelYear=1800), 400)
    request(owner, 'POST', '/api/garage/vehicles', dict(body, manufacturer=' '), 400)
    first = request(owner, 'POST', '/api/garage/vehicles', dict(body, userId=accounts[1][0]), 201)
    vehicle_ids.append(first['id'])
    second = request(owner, 'POST', '/api/garage/vehicles', dict(body, nickname='두 번째 차량'), 201)
    vehicle_ids.append(second['id'])
    assert first['userId'] == accounts[0][0]
    assert {v['id'] for v in request(owner, 'GET', '/api/garage/vehicles')} == set(vehicle_ids)
    assert request(other, 'GET', '/api/garage/vehicles') == []
    profile = request(anonymous, 'GET', f"/api/vehicles/{first['id']}")
    assert all(profile[k] == v for k, v in body.items())
    assert profile['username'] == accounts[0][1]
    assert profile['createdAt'] and profile['updatedAt']
    assert 'password' not in profile and 'user' not in profile
    route = f"/api/garage/vehicles/{first['id']}"
    request(other, 'PUT', route, dict(body, userId=accounts[0][0]), 403)
    request(other, 'DELETE', route, expected=403)
    request(anonymous, 'PUT', route, body, 401)
    request(anonymous, 'DELETE', route, expected=401)
    updated = request(owner, 'PUT', route, dict(body, nickname='수정한 차량', userId=accounts[1][0]))
    assert updated['nickname'] == '수정한 차량' and updated['userId'] == accounts[0][0]
    assert updated['createdAt'] == first['createdAt']
    assert updated['updatedAt'] > first['updatedAt']
    # Existing HTML garage shares this very same row.
    legacy = request(anonymous, 'GET', f"/api/board/garage/{first['id']}")
    assert legacy['ownerId'] == accounts[0][0] and legacy['year'] == 2024
    assert legacy['bio'] == body['description']
    request(owner, 'DELETE', route, expected=204)
    vehicle_ids.remove(first['id'])
    request(anonymous, 'GET', f"/api/vehicles/{first['id']}", expected=404)
    assert len(request(owner, 'GET', '/api/garage/vehicles')) == 1
    assert request(anonymous, 'GET', '/api/vehicles') == catalog
    request(owner, 'DELETE', f"/api/garage/vehicles/{second['id']}", expected=204)
    vehicle_ids.clear()
    request(owner, 'POST', '/api/auth/logout', {})
    request(owner, 'GET', '/api/auth/me', expected=401)
    request(owner, 'GET', '/api/garage/vehicles', expected=401)
    request(owner, 'GET', '/api/board/me', expected=401)
    print('PASS: signup/login/me/logout, shared Redis session, anonymous blocking, multiple vehicles, own list, public profile, owner update/delete, forged userId ignored, foreign changes denied, validation, legacy catalog and HTML garage compatibility.')
finally:
    for vehicle_id in vehicle_ids:
        request(owner, 'DELETE', f'/api/garage/vehicles/{vehicle_id}', expected=204)
    for agent in [owner, other]:
        request(agent, 'POST', '/api/auth/logout', {})
    if '--cleanup-accounts' in sys.argv and accounts:
        ids = ','.join(str(int(user_id)) for user_id, _ in accounts)
        subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'revcc', '-d', 'revcc',
            '-v', 'ON_ERROR_STOP=1', '-c', f"DELETE FROM users WHERE id IN ({ids}) AND username LIKE 'garage_check_{run_id}_%';"], check=True, stdout=subprocess.DEVNULL)
