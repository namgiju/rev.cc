// Native Chrome DevTools pipe; no npm/browser download. API fixtures exist only in memory.
const {spawn}=require('node:child_process'), http=require('node:http'), fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../assignment-frontend');
let user={id:3,username:'manager',role:'ADMIN'}, deleted=false, deletes=[], logs=[];
const post={id:31,title:'테스트 글',content:'본문',category:'free',authorId:1,username:'owner',imageIds:[],createdAt:new Date().toISOString(),views:0,likeCount:0,commentCount:2};
let comments=[{id:1,authorId:1,username:'owner',content:'부적절한 댓글',parentId:null,deleted:false},{id:2,authorId:2,username:'reader',content:'답글',parentId:1,deleted:false}];
const server=http.createServer(async(req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(p.startsWith('/api/')) {
    let raw=''; for await (const chunk of req) raw+=chunk; const body=raw?JSON.parse(raw):{};
    if(p==='/api/board/me')return send(user);
    if(p==='/api/board/posts/31' && req.method==='DELETE') {deletes.push(body);deleted=true;return send({ok:true});}
    if(p.startsWith('/api/board/comments/') && req.method==='DELETE') {
      deletes.push(body); const c=comments.find(c=>c.id===Number(p.split('/').at(-1)));
      c.deleted=true;c.content='관리자에 의해 삭제된 댓글입니다.';
      logs.push({id:1,action_type:'COMMENT_DELETE',post_id:31,post_title:post.title,category:'free',target_id:c.id,target_author_username:c.username,admin_username:user.username,reason:body.reason,original_content:'<script>window.xss=true</script>',created_at:new Date().toISOString()});
      return send({ok:true});
    }
    if(p==='/api/board/posts/31')return send(post);
    if(p==='/api/board/posts/31/comments')return send(comments);
    if(p==='/api/board/posts/31/view')return send({views:1});
    if(p==='/api/board/posts')return send([post]);
    if(p==='/api/board/members/1')return send({id:1,username:'owner',vehicles:[],badges:[],posts:[],postCount:1,commentCount:1});
    if(p==='/api/board/admin/logs')return send({items:logs,total:logs.length,page:1,pageSize:20});
    if(p==='/api/board/admin/overview'||p==='/api/admin/overview')return send({totalPosts:1,pendingReports:0,totalUsers:3,totalVehicles:0});
    if(['/api/board/admin/members','/api/board/admin/posts','/api/board/admin/reports'].includes(p))return send({items:[],total:0,page:1,pageSize:20});
    return send([]);
  }
  const file=path.join(root,p.startsWith('/community')?'community/index.html':p==='/admin'?'admin/index.html':p==='/'?'index.html':p);
  try {const data=fs.readFileSync(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}
});
let chrome,profile,seq=0,pending=new Map(),buffer='',session;
function call(method,params={},sid=session){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout '+expression);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 profile=fs.mkdtempSync(path.join(os.tmpdir(),'revcc-moderation-'));
 chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-pipe',`--user-data-dir=${profile}`],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 chrome.stdio[4].on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
 const target=await call('Target.createTarget',{url:'about:blank'});session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const open=async url=>{await call('Page.navigate',{url:base+url});await wait('document.readyState === "complete"');};
 await open('/community/free/31');await wait('document.querySelectorAll(".comment .danger-text").length===2');
 assert.equal(await evaluate('[...document.querySelectorAll(".detail-actions button")].some(b=>b.textContent==="수정")'),false);
 await evaluate('document.querySelector(".comment .danger-text").click()');await wait('!!document.querySelector("dialog[open] textarea[name=reason]")');
 assert.equal(deletes.length,0);
 await evaluate('document.querySelector("dialog[open] textarea").value="   ";document.querySelector("dialog[open] form").requestSubmit()');
 await wait('document.querySelector("dialog[open] [role=alert]").textContent.includes("입력")');assert.equal(deletes.length,0);
 await evaluate('document.querySelector("dialog[open] textarea").value="욕설 및 비방";document.querySelector("dialog[open] form").requestSubmit()');
 await wait('!document.querySelector("dialog[open] textarea[name=reason]")');await wait('document.querySelector(".comment.deleted")?.textContent.includes("관리자에 의해")');
 assert.deepEqual(deletes[0],{reason:'욕설 및 비방'});assert.equal(await evaluate('document.querySelectorAll(".comment.reply").length'),1);
 await evaluate('document.querySelector(".reply .danger-text").click()');await wait('!!document.querySelector("dialog[open] textarea")');
 await evaluate('[...document.querySelectorAll("dialog[open] button")].find(b=>b.textContent==="취소").click()');assert.equal(deletes.length,1);
 await evaluate('[...document.querySelectorAll(".detail-actions button")].find(b=>b.textContent==="삭제").click()');await wait('!!document.querySelector("dialog[open] textarea")');
 await evaluate('document.querySelector("dialog[open] textarea").value="게시글 사유";document.querySelector("dialog[open] form").requestSubmit()');await wait('location.pathname==="/community"');assert.ok(deleted);
 await open('/admin');await wait('document.querySelector("#logs-body")?.textContent.includes("욕설 및 비방")');
 await evaluate('document.querySelector("button[data-panel=logs]").click()');assert.equal(await evaluate('document.querySelector("section[data-panel=logs]").hidden'),false);
 assert.ok(await evaluate('document.querySelector("#logs-body").textContent.includes("manager")'));
 await evaluate('document.querySelector("#logs-body summary").click()');assert.equal(await evaluate('window.xss===true'),false);
 assert.ok(await evaluate('document.querySelector("#logs-body details").open'));
 user={id:2,username:'reader',role:'USER'};await open('/community/free/31');await wait('document.querySelectorAll(".comment").length===2');
 assert.equal(await evaluate('document.querySelectorAll(".detail-actions .danger-text").length'),0);
 assert.equal(await evaluate('document.querySelectorAll(".comment .danger-text").length'),1);
 await evaluate('document.querySelector(".reply .danger-text").click()');await wait('document.querySelector("#confirm-dialog").open');assert.equal(await evaluate('!!document.querySelector("dialog[open] textarea[name=reason]")'),false);
 console.log('PASS browser fixtures: ADMIN delete buttons, no foreign edit, required reason/whitespace, cancellation, successful comment refresh and parent relation, post return route, logs and escaped original, USER owner-only and existing confirmation.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(chrome){chrome.kill();await new Promise(r=>chrome.once('exit',r));}server.closeAllConnections();server.close();if(profile)fs.rmSync(profile,{recursive:true,force:true});});
