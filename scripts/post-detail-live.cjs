// Real Redis sessions + HTTP + browser, with only uniquely named temporary accounts.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const base=process.env.REVCC_URL||'http://localhost:8090';
const run=randomUUID().replaceAll('-','').slice(0,10), accounts=[];
const sql=input=>execFileSync('docker',['compose','exec','-T','postgres','psql','-U','revcc','-d','revcc','-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'}).trim();
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=';
let browser;
async function req(context,path,method='GET',data,status=200){
 const r=await context.request.fetch(base+path,{method,...(data===undefined?{}:{data})});
 assert.equal(r.status(),status,`${method} ${path}: ${await r.text()}`);return r.json();
}
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const errors=[];
 for(const kind of ['a','b','admin']){
  const context=await browser.newContext({viewport:{width:1536,height:1024}});
  const credentials={username:`detail_${run}_${kind}`,password:randomUUID()};
  const u=await req(context,'/api/auth/signup','POST',credentials,201);
  const account={context,id:u.id,username:credentials.username};accounts.push(account);
  if(kind==='admin')sql(`UPDATE users SET role='ADMIN' WHERE id=${u.id} AND username='${credentials.username}';`);
  await req(context,'/api/auth/login','POST',credentials);
  account.vehicle=await req(context,'/api/garage/vehicles','POST',{manufacturer:'Test',model:`Car-${run}-${kind}`,modelYear:2024,licensePlate:'TEST'},201);
  account.page=await context.newPage();account.page.on('pageerror',e=>errors.push(e.message));
 }
 const [a,b,admin]=accounts;
 await req(b.context,`/api/garage/vehicles/${b.vehicle.id}/verification`,'POST',{data:png});
 const verification=(await req(admin.context,'/api/admin/vehicle-verifications')).find(v=>v.vehicleId===b.vehicle.id);
 await req(admin.context,`/api/admin/vehicle-verifications/${verification.id}/approve`,'POST',{});
 const posts=[];
 for(const category of ['free','maintenance','parts','drive']){
  const p=await req(b.context,'/api/board/posts','POST',{title:`${category}-${run}`,content:'실제 HTTP 회귀 검사 게시글',category,vehicle:b.vehicle.model},201);
  posts.push({...p,category});
 }
 const own=await req(a.context,'/api/board/posts','POST',{title:`own-${run}`,content:'A의 글',category:'free'},201);
 const guest=await browser.newContext({viewport:{width:1536,height:1024}}),guestPage=await guest.newPage();
 guestPage.on('pageerror',e=>errors.push(e.message));
 async function check(page,post,author){
  await page.goto(`${base}/community/${post.category}/${post.id}`);
  await page.locator('#post-author .author-stats').waitFor();
  assert.equal(await page.locator('#post-author .author-identity>a').innerText(),author.username);
  assert.equal(await page.locator(`#post-author a[href="#car-${author.vehicle.id}"]`).count(),1);
  for(const other of accounts.filter(u=>u.id!==author.id))assert.equal(await page.locator(`#post-author a[href="#car-${other.vehicle.id}"]`).count(),0);
  assert.equal(await page.locator('#post-author-badges .author-badge').count(),author===b?1:0);
  const hrefs=await page.locator('#post-related a.context-post-row').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  assert.ok(hrefs.every(h=>/^\/community\/(free|maintenance|parts|drive)\/\d+$/.test(h)));
 }
 await check(a.page,{...own,category:'free'},a);
 assert.equal(await a.page.locator('.detail-actions').getByRole('button',{name:'수정',exact:true}).count(),1);
 for(const p of posts){
  for(const page of [a.page,admin.page,guestPage]){
   await check(page,p,b);
   assert.equal(await page.locator('.detail-actions').getByRole('button',{name:'수정',exact:true}).count(),0);
   await page.reload();await page.locator('#post-author .author-stats').waitFor();
   assert.equal(await page.locator('#post-author .author-identity>a').innerText(),b.username);
  }
 }
 console.log('PASS live: A -> A; A/admin/anonymous -> B, four categories, actual author cars/badges, reload and ownership UI');
 const p=posts[0],path=`/api/board/posts/${p.id}`;
 await a.page.goto(`${base}/community/free/${p.id}`);await a.page.locator('#post-author .author-stats').waitFor();
 await a.page.getByRole('button',{name:'♡ 추천 0',exact:true}).click();await a.page.getByRole('button',{name:'♡ 추천 1',exact:true}).waitFor();
 await a.page.getByRole('button',{name:'북마크',exact:true}).click();await a.page.getByRole('button',{name:'저장됨',exact:true}).waitFor();
 assert.equal((await req(a.context,path)).liked,true);assert.equal((await req(admin.context,path)).liked,false);
 assert.equal((await req(a.context,path)).bookmarked,true);assert.equal((await req(guest,path)).bookmarked,false);
 await a.page.getByLabel('댓글 내용').fill('A의 실제 댓글');await a.page.getByRole('button',{name:'댓글 등록',exact:true}).click();await a.page.locator('.comment').waitFor();
 await a.page.getByRole('button',{name:'답글',exact:true}).click();await a.page.getByLabel('댓글 내용').fill('A의 실제 답글');await a.page.getByRole('button',{name:'댓글 등록',exact:true}).click();await a.page.locator('.comment.reply').waitFor();
 assert.equal((await req(guest,`${path}/comments`)).length,2);
 await req(a.context,path,'PUT',{title:'forbidden',content:'forbidden',category:'free'},403);
 await req(admin.context,path,'DELETE',{},403);
 await req(guest,`${path}/comments`,'POST',{content:'forbidden'},401);
 await a.page.goto(`${base}/community/parts/${p.id}`);await a.page.waitForURL(`**/community/free/${p.id}`);
 await a.page.goto(`${base}/community#post-${p.id}`);await a.page.waitForURL(`**/community/free/${p.id}`);
 await a.page.goto(`${base}/community/drive/${posts[3].id}`);await a.page.locator('#post-author .author-stats').waitFor();
 await a.page.goBack();await a.page.waitForURL(`**/community/free/${p.id}`);await a.page.locator('#post-author .author-stats').waitFor();
 await a.page.goto(`${base}/community/free/2147483647`);await a.page.locator('#post-detail-content').getByText(/없|삭제/).waitFor();
 assert.equal(await a.page.locator('#post-author .author-identity').count(),0);
 await check(guestPage,p,b);
 await guestPage.screenshot({path:'/tmp/revcc-post-detail-live.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS live: like/bookmark viewer isolation, comments/replies, API owner permissions, canonical mismatch/hash/back/404, public related links; no JS errors');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 try{
  const ids=accounts.map(a=>a.id);
  if(ids.length){const owners=`SELECT id FROM users WHERE id IN (${ids.join(',')}) AND username LIKE 'detail_${run}_%'`;
   sql(`BEGIN; DELETE FROM board_posts WHERE author_id IN (${owners}); DELETE FROM vehicle_verifications WHERE vehicle_id IN (SELECT id FROM owner_vehicles WHERE owner_id IN (${owners})); DELETE FROM owner_vehicles WHERE owner_id IN (${owners}); DELETE FROM community_images WHERE owner_id IN (${owners}); DELETE FROM users WHERE id IN (${owners}); COMMIT;`);
  }
  for(const a of accounts)await req(a.context,'/api/auth/logout','POST',{});
 }catch(e){console.error('Cleanup failed',e);process.exitCode=1;}
 await browser?.close();console.log('Temporary test data and sessions cleaned.');
});
