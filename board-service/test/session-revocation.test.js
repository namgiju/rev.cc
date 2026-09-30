import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('DB session version and suspension apply to board and garage including legacy cookies', async t => {
  let current = { version: 0, status: 'ACTIVE' };
  let session = { id: 1, username: 'member', role: 'USER' };
  const app = createApp({ redis: { get: async () => JSON.stringify(session) }, db: { query: async () => ({ rows: current ? [current] : [] }) } });
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const get = path => fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:{Cookie:`REVCC_SESSION=${'a'.repeat(43)}`}});
  assert.equal((await get('/api/board/me')).status,200);
  current.version=1;
  assert.equal((await get('/api/board/me')).status,401);
  assert.equal((await get('/api/board/garage/mine')).status,401);
  session.version=1;
  assert.equal((await get('/api/board/me')).status,200);
  current.status='SUSPENDED';
  assert.equal((await get('/api/board/me')).status,401);
  current.suspended_until='2000-01-01';
  assert.equal((await get('/api/board/me')).status,200);
  current.status='DISABLED';
  assert.equal((await get('/api/board/me')).status,401);
  // 탈퇴(WITHDRAWN)는 세션 버전이 같아도(상태만 바뀐 경우) 거부한다. 탈퇴 처리는 버전도 올린다.
  current={ version: 1, status: 'WITHDRAWN' };
  assert.equal((await get('/api/board/me')).status,401);
  assert.equal((await get('/api/board/garage/mine')).status,401);
  assert.equal((await get('/api/parts/listings?scope=mine')).status,401);
  current=null;
  assert.equal((await get('/api/board/me')).status,401);
});
