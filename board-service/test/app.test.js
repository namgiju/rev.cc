import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, sessionUser } from '../src/app.js';

// 서버 간 직렬화 계약과 작성자 위조 방지를 외부 DB 없이 검증한다.
const token = 'a'.repeat(43);
const user = { id: 7, username: 'tester' };
const redis = { get: async key => key === `revcc:session:${token}` ? JSON.stringify(user) : null };
test('shared JSON cookie, missing token and invalid token', async () => {
  assert.deepEqual(await sessionUser(redis, `other=x; REVCC_SESSION=${token}`), user);
  assert.equal(await sessionUser(redis), null);
  assert.equal(await sessionUser(redis, 'REVCC_SESSION=invalid'), null);
  assert.equal(await sessionUser({ get: async () => '{bad' }, `REVCC_SESSION=${token}`), null);
});
test('authenticated author is taken from Redis; invalid and unauthenticated posts rejected', async t => {
  let parameters;
  const app = createApp({ redis, db: { query: async (sql, values) => { parameters = values; return { rows: [{ id: 1, authorId: values[2] }] }; } } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/board/posts`;
  const post = (body, cookie = '') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  assert.equal((await post({ title: 'x', content: 'y' })).status, 401);
  assert.equal((await post({ title: '', content: 'y' }, `REVCC_SESSION=${token}`)).status, 400);
  const result = await post({ title: 'hello', content: 'world', authorId: 99 }, `REVCC_SESSION=${token}`);
  assert.equal(result.status, 201);
  assert.equal((await result.json()).authorId, 7);
  assert.deepEqual(parameters, ['hello', 'world', 7]);
});
