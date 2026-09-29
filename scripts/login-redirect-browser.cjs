// Uses real auth/site-nav/home assets and isolated API fixtures; never accesses Neon or SMTP.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'), fs=require('node:fs/promises'), path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../assignment-frontend');
(async()=>{
  const server=http.createServer(async(req,res)=>{
    let pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/login') pathname='/auth/index.html';
    if(pathname==='/home') pathname='/home/index.html';
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
    try { const data=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data); }
    catch {res.writeHead(404).end();}
  }).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  let assertions=0;
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
      let authenticated=false,role='USER',sessionChecks=0;
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',async route=>{
        const req=route.request(),u=new URL(req.url());
        if(u.origin!==base) throw new Error('External navigation blocked by test');
        if(req.resourceType()==='document' && authenticated && u.pathname!=='/login') {
          await route.fulfill({contentType:'text/html',body:'<main>Authenticated destination fixture</main>'});return;
        }
        if(!u.pathname.startsWith('/api/')) {await route.continue();return;}
        let status=200,data={};
        if(u.pathname==='/api/auth/login') {
          if(req.postDataJSON().password==='wrong') {status=401;data={message:'아이디 또는 비밀번호가 올바르지 않습니다.'};}
          else authenticated=true;
        } else if(u.pathname==='/api/auth/me' || u.pathname==='/api/board/me') {
          if(u.pathname==='/api/auth/me')sessionChecks++;
          status=authenticated?200:401;data=authenticated?{id:1,username:'test-member',role}:{message:'로그인이 필요합니다.'};
        } else data=[];
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      });
      const login=async(password='valid')=>{
        await page.locator('#username').fill('test-member');await page.locator('#password').fill(password);await page.locator('#auth-submit').click();
      };
      const scenarios=[['/login','/','USER'],['/login?reset=1','/','USER'],['/login','/','ADMIN'],
        ['/login?next=%2Fhome','/home','USER'],['/login?next=%2Fhome','/home','ADMIN'],
        ['/login?next='+encodeURIComponent('/community?category=drive#write-post'),'/community?category=drive#write-post','USER']];
      for(const unsafe of ['https://example.com','//example.com','/\\example.com','javascript:alert(1)','/%2Fexample.com','/unknown','/home\n']) scenarios.push(['/login?next='+encodeURIComponent(unsafe),'/','USER']);
      for(const [entry,destination,accountRole] of scenarios) {
        authenticated=false;role=accountRole;const before=sessionChecks;
        await page.goto(base+entry);await login();await page.waitForURL(base+destination);
        assert.equal(sessionChecks,before+1);assert.equal(new URL(page.url()).origin,base);assertions++;
      }
      // The real garage's signed-out UI uses site-nav.js to attach next=/home.
      authenticated=false;role='USER';await page.goto(base+'/home');
      await page.locator('#home-login').click();
      await page.waitForURL(base+'/login?next=%2Fhome');
      await login();await page.waitForURL(base+'/home');assertions++;
      authenticated=false;await page.goto(base+'/login');await login('wrong');
      await page.locator('#auth-message').filter({hasText:'아이디 또는 비밀번호가 올바르지 않습니다.'}).waitFor();
      assert.equal(page.url(),base+'/login');assert.equal(await page.locator('#auth-submit').isEnabled(),true);assertions++;
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log(`PASS: ${assertions} login redirect/failure scenarios, desktop/mobile, USER/ADMIN, reset login, real garage return link, internal query/hash preservation, external redirect rejection`);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
