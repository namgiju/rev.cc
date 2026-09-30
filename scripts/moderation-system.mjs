// Run: scripts/run-board-system.sh scripts/moderation-system.mjs; isolated schema only, no real member content is changed.
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp } from './src/app.js';
import { applyFlywayMigrations, assertIsolatedDatabase } from './scripts/lib/flyway-migrations.mjs';
assertIsolatedDatabase();
const pool = new pg.Pool(), schema = `moderation_test_${Date.now()}`;
let db, server;
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({options:`-c search_path=${schema}`});
  await applyFlywayMigrations(db);
  await db.query("INSERT INTO users(id,username,role,password) VALUES(1,'owner','USER','test-only'),(2,'reader','USER','test-only'),(3,'manager','ADMIN','test-only')");
  const redis = {get: async key => {
    const id = {a:1,b:2,c:3}[key.at(-1)];
    return id ? JSON.stringify({id,username:'session-name',role:id===3?'ADMIN':'USER'}) : null;
  }};
  server = createApp({db,redis}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base = `http://127.0.0.1:${server.address().port}/api/board`;
  async function req(path, method='GET', data, token='a', status=200) {
    const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Cookie:`REVCC_SESSION=${token.repeat(43)}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const body = await response.json(); assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(body)}`); return body;
  }
  const post = await req('/posts','POST',{title:'원본 제목',content:'원본 게시글',category:'maintenance'},'a',201);
  const path = `/posts/${post.id}`;
  const comment = await req(path+'/comments','POST',{content:'원본 댓글'},'a',201);
  const reply = await req(path+'/comments','POST',{content:'원본 답글',parentId:comment.id},'b',201);
  const own = await req(path+'/comments','POST',{content:'본인 삭제'},'b',201);
  await req(`/comments/${own.id}`,'DELETE',{},'b');
  assert.equal((await db.query('SELECT content FROM board_comments WHERE id=$1',[own.id])).rows[0].content,'삭제된 댓글입니다.');
  await req(`/comments/${comment.id}`,'DELETE',{reason:'forged'},'b',403);
  await req(path,'DELETE',{reason:'forged'},'b',403);
  for (const target of [path,`/comments/${comment.id}`,`/comments/${reply.id}`]) {
    await req(target,'DELETE',{},'',401);
    for (const reason of [undefined,'','   ','x'.repeat(501)]) await req(target,'DELETE',{reason},'c',400);
  }
  assert.equal((await db.query('SELECT * FROM moderation_logs')).rowCount,0);
  await db.query("UPDATE users SET role='USER' WHERE id=3");
  await req(`/comments/${comment.id}`,'DELETE',{reason:'stale role'},'c',403);
  await req('/admin/logs','GET',undefined,'c',403);
  await db.query("UPDATE users SET role='ADMIN' WHERE id=3");
  // Log failure must roll back the delete.
  await db.query(`CREATE FUNCTION reject_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced test failure'; END $$; CREATE TRIGGER reject_log BEFORE INSERT ON moderation_logs FOR EACH ROW EXECUTE FUNCTION reject_log()`);
  await req(`/comments/${comment.id}`,'DELETE',{reason:'rollback'},'c',503);
  assert.equal((await db.query('SELECT deleted FROM board_comments WHERE id=$1',[comment.id])).rows[0].deleted,false);
  await db.query('DROP TRIGGER reject_log ON moderation_logs');
  await req(`/comments/${comment.id}`,'DELETE',{reason:'욕설 및 비방'},'c');
  let comments = await req(path+'/comments');
  assert.equal(comments.find(c=>c.id===comment.id).content,'관리자에 의해 삭제된 댓글입니다.');
  assert.equal(comments.find(c=>c.id===reply.id).parentId,comment.id);
  assert.equal(comments.find(c=>c.id===reply.id).deleted,false);
  await req(`/comments/${reply.id}`,'DELETE',{reason:'답글 사유'},'c');
  await req(`/comments/${reply.id}`,'DELETE',{reason:'중복'},'c',404);
  await req(path,'PUT',{title:'불가',content:'불가'},'c',403);
  await req(path,'DELETE',{reason:'게시글 사유'},'c');
  // 관리자 삭제는 soft delete: 삭제한 관리자 id와 ADMIN 사유를 남긴다(STEP 10-impl-B).
  assert.deepEqual(Object.values((await db.query('SELECT deleted,deleted_by::int AS by,deleted_reason,deleted_at IS NOT NULL AS at FROM board_posts WHERE id=$1',[post.id])).rows[0]),[true,3,'ADMIN',true]);
  assert.equal((await db.query('SELECT parent_id FROM board_comments WHERE id=$1',[reply.id])).rows[0].parent_id,comment.id);
  await req(path,'GET',undefined,'a',404);
  await req(path+'/comments','GET',undefined,'a',404);
  await req(path+'/view','POST',{},'a',404);
  await req(path+'/comments','POST',{content:'불가'},'a',404);
  await req(path+'/like','PUT',{active:true},'a',404);
  await req(path,'PUT',{title:'복구 금지',content:'복구 금지'},'a',403);
  await req(path,'DELETE',{},'a',404);
  for (const scope of ['', '?scope=mine','?scope=commented','?sort=popular&period=week']) assert.equal((await req('/posts'+scope)).length,0);
  assert.equal((await req('/stats/summary')).postCount,0);
  assert.equal((await req('/categories/summary')).find(c=>c.category==='maintenance').postCount,0);
  await req('/admin/logs','GET',undefined,'a',403);
  await req('/admin/logs','GET',undefined,'',401);
  const logs = await req('/admin/logs','GET',undefined,'c');
  assert.equal(logs.total,3);
  assert.deepEqual(logs.items.map(l=>l.action_type),['POST_DELETE','REPLY_DELETE','COMMENT_DELETE']);
  assert.deepEqual(logs.items.map(l=>l.original_content),['원본 게시글','원본 답글','원본 댓글']);
  for (const l of logs.items) {assert.equal(l.post_id,post.id);assert.equal(l.post_title,'원본 제목');assert.equal(l.category,'maintenance');assert.equal(l.admin_username,'manager');assert.ok(l.created_at);assert.ok(l.reason);}
  assert.equal(logs.items[1].target_author_username,'reader');
  assert.equal((await req('/admin/logs?q=욕설','GET',undefined,'c')).total,1);
  assert.equal((await req('/admin/logs?page=2','GET',undefined,'c')).items.length,0);
  const adminPost = await req('/posts','POST',{title:'관리자 본인',content:'own'},'c',201);
  const adminComment = await req(`/posts/${adminPost.id}/comments`,'POST',{content:'own'},'c',201);
  await req(`/comments/${adminComment.id}`,'DELETE',{},'c');
  await req(`/posts/${adminPost.id}`,'DELETE',{},'c');
  const userPost = await req('/posts','POST',{title:'일반 본인',content:'own'},'a',201);
  await req(`/posts/${userPost.id}`,'DELETE',{},'a');
  // 본인 삭제도 행을 지우지 않는다(작성자 id, AUTHOR). 관리자 본인 글 삭제도 작성자 삭제다.
  const ownDeletes = (await db.query('SELECT id,deleted,deleted_by::int AS by,deleted_reason FROM board_posts WHERE id=ANY($1) ORDER BY id',[[adminPost.id,userPost.id]])).rows;
  assert.deepEqual(ownDeletes.map(r=>[r.deleted,r.by,r.deleted_reason]),[[true,3,'AUTHOR'],[true,1,'AUTHOR']]);
  assert.equal((await req('/admin/logs','GET',undefined,'c')).total,3);
  console.log('PASS moderation: owner deletes, USER/guest denial, ADMIN comment/reply/post reason+snapshots, missing/blank/long reason, stale role, rollback, duplicate delete, parent retention, public exclusion, log access/search/pagination, unchanged edit policy and own deletes.');
} finally {
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(db)await db.end();
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
}
