// Isolated browser fixtures for discovery UI; real-session coverage is in post-detail-live.cjs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
const base=process.env.REVCC_URL||'http://localhost:8090';let browser;
(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1536,height:1024}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
let user=null,empty=false,memberFail=false,popularFail=false,requests=[];
const posts=Array.from({length:25},(_,i)=>({id:i+1,title:`실제로 열린 글 ${i+1}`,content:'게시글 내용',category:['free','maintenance','parts','drive'][i%4],authorId:8,username:'작성자',createdAt:'2026-09-21T00:00:00Z',imageIds:[],views:10,likeCount:3,commentCount:2}));
await page.route('**/api/**',route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname;requests.push(url.pathname+url.search);
const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
if(p==='/api/board/me')return send(user||{},user?200:401);
if(p==='/api/board/notifications')return send([]);
if(p.startsWith('/api/board/members/')){if(memberFail)return send({},503);const id=Number(p.split('/').pop()),v={id:id*10,manufacturer:'현대',model:`본인 차량 ${id}`,year:2024,verified:true};return send({id,username:'작성자',vehicles:empty?[]:[v],representativeVehicle:empty?null:v,badges:[],postCount:25,commentCount:2,receivedLikes:3});}
if(p==='/api/board/posts'){if(popularFail&&url.searchParams.get('sort')==='popular')return send({},503);let items=posts;if(url.searchParams.get('category'))items=items.filter(x=>x.category===url.searchParams.get('category'));if(url.searchParams.get('q'))items=items.filter(x=>x.title.includes(url.searchParams.get('q')));const size=Number(url.searchParams.get('limit')||20),start=(Number(url.searchParams.get('page')||1)-1)*size;return send(items.slice(start,start+size));}
const match=/\/posts\/(\d+)(.*)/.exec(p);if(match){const post=posts.find(x=>x.id===Number(match[1]));if(match[2]==='/comments')return send([]);if(match[2]==='/view')return send({views:11});return send(post||{},post?200:404);}
return send({});});
const open=async()=>{await page.goto(base+'/community',{waitUntil:'networkidle'});await page.locator('.community-feed-row').first().waitFor();};
await open();assert.equal(await page.locator('#community-my-garage').getAttribute('data-state'),'NOT_AUTHENTICATED');assert.ok(!requests.some(p=>p.startsWith('/api/board/members/')));
const rects=await Promise.all(['#community-left','#community','#community-right'].map(s=>page.locator(s).boundingBox()));assert.ok(rects[0].x+rects[0].width<rects[1].x&&rects[1].x+rects[1].width<rects[2].x);
await page.goto(base+'/community?scope=mine',{waitUntil:'networkidle'});assert.match(await page.locator('#posts').innerText(),/로그인이 필요합니다/);await open();
assert.equal(await page.locator('.community-feed-row').count(),20);await page.locator('#load-more').click();assert.equal(await page.locator('.community-feed-row').count(),25);
for(const category of ['free','maintenance','parts','drive']){await page.locator(`[data-category="${category}"]`).click();await page.waitForFunction(c=>new URL(location.href).searchParams.get('category')===c,category);await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator(`[data-category="${category}"]`).getAttribute('aria-pressed'),'true');}
await page.locator('#reset-filter').click();await page.getByLabel('게시글 검색',{exact:true}).fill('열린 글 25');await page.locator('#search-form button').click();await page.waitForFunction(()=>document.querySelectorAll('.community-feed-row').length===1);await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#search-input').inputValue(),'열린 글 25');
await page.locator('#reset-filter').click();await page.locator('#post-sort').selectOption('popular');assert.ok(requests.some(p=>p.includes('sort=popular')));
for(const role of ['USER','ADMIN']){user={id:role==='USER'?7:9,username:role,role};await open();await page.locator('#community-my-garage strong').waitFor();assert.match(await page.locator('#community-my-garage').innerText(),new RegExp(`본인 차량 ${user.id}`));assert.equal(await page.locator('#admin-link').isVisible(),role==='ADMIN');for(const scope of ['mine','commented','bookmarks']){await page.locator(`[data-community-scope="${scope}"]`).click();assert.ok(requests.some(p=>p.includes(`scope=${scope}`)));}assert.equal(await page.locator('footer').count(),1);}
empty=true;await open();assert.equal(await page.locator('#community-my-garage').getAttribute('data-state'),'EMPTY_GARAGE');assert.equal(await page.locator('#community-my-garage a').getAttribute('href'),'/home');empty=false;
memberFail=true;popularFail=true;await open();assert.equal(await page.locator('#community-my-garage').getAttribute('data-state'),'ERROR');assert.equal(await page.locator('.community-feed-row').count(),20);memberFail=false;popularFail=false;
for(let i=1;i<=7;i++){const post=posts[i-1];await page.goto(`${base}/community/${post.category}/${post.id}`,{waitUntil:'networkidle'});}
await page.reload({waitUntil:'networkidle'});await open();assert.equal(await page.locator('#community-recent-list a').count(),5);assert.equal(await page.locator('#community-recent-list a').first().getAttribute('href'),'/community/parts/7');
await page.locator('#community-popular a').first().click();await page.locator('.detail-title').waitFor();assert.equal(await page.locator('#community-left').isVisible(),false);await page.locator('#post-detail>.text-link').click();await page.locator('.community-feed-row').first().waitFor();
await page.locator('.community-write-link').click();await page.locator('#post-title').fill('기존 작성 폼');assert.equal(await page.locator('#post-title').inputValue(),'기존 작성 폼');
await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:'/tmp/revcc-community-desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
await page.evaluate(()=>localStorage.setItem('revcc:recent-posts:v1','invalid'));await open();assert.equal(await page.locator('#community-recent-list a').count(),0);
assert.deepEqual(errors,[]);console.log('PASS list: three columns, guest/USER/ADMIN, own/empty/error garage, filters/search/reload/scopes/load-more, real-visit recents limit/dedup/corruption, canonical links, composer, footer, narrow width, no JS errors');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>browser?.close());
