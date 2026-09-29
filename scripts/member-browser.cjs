// UI fixture test: no production DB or real email is accessed.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../assignment-frontend');
(async () => {
  const server=http.createServer(async (req,res) => {
    let pathname=new URL(req.url,'http://localhost').pathname;
    if (['/login','/signup'].includes(pathname)) pathname='/auth/index.html';
    if (pathname==='/password-reset') pathname='/auth/reset.html';
    if (pathname==='/admin') pathname='/admin/index.html';
    const file=path.resolve(root,'.'+pathname);
    if (!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    try {const data=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}
  }).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const browser=await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for (const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      let member={id:7,username:'rev-driver',nickname:'드라이버',email:'member@example.test',joinedAt:null,status:'ACTIVE',role:'USER',suspendedUntil:null,kakaoOnly:false};
      await page.route('**/api/**',async route=>{
        const request=route.request(),url=new URL(request.url()),p=url.pathname;
        let data={};
        if (p==='/api/board/me') data={id:1,username:'admin',role:'ADMIN'};
        else if (p==='/api/admin/members') data={items:[member],total:1,page:1,pageSize:20};
        else if (p==='/api/admin/members/7') {if(request.method()==='PATCH') member={...member,...request.postDataJSON()}; data=member;}
        else if (p.endsWith('/actions')) data=[{adminId:1,action:'UPDATE:NICKNAME',createdAt:new Date().toISOString()}];
        else if (p.endsWith('/password-reset') || p.endsWith('/request')) data={message:'재설정 가능한 계정이면 인증번호를 발송했습니다.'};
        else if (p.endsWith('/verify')) data={resetToken:'fixture-token'};
        else if (p.endsWith('/complete')) data={message:'비밀번호가 변경되었습니다. 다시 로그인해주세요.'};
        else if (p.endsWith('/overview')) data={totalUsers:1,totalVehicles:0,totalPosts:0,pendingReports:0};
        else if (p.endsWith('/badges') || p.endsWith('/vehicle-verifications')) data=[];
        else data={items:[],total:0,page:1,pageSize:20};
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto(base+'/login');
      await page.getByRole('link',{name:'비밀번호를 잊으셨나요?'}).click();
      await page.locator('#reset-email').fill('member@example.test');
      await page.locator('#email-form button').click();
      await page.locator('#reset-code').fill('123456');
      await page.locator('#code-form button').click();
      await page.locator('#new-password').fill('new-password');
      await page.locator('#new-confirm').fill('new-password');
      await page.screenshot({path:`/tmp/revcc-reset-${width}.png`,fullPage:true});
      await page.locator('#password-form button').click();
      await page.waitForURL('**/login?reset=1');
      assert.match(await page.locator('#auth-message').textContent(),/비밀번호가 변경되었습니다/);
      await page.goto(base+'/admin');
      await page.locator('button[data-panel="members"]').click();
      await page.getByRole('button',{name:'rev-driver',exact:true}).click();
      await page.locator('#member-form [name="nickname"]').fill('변경된 닉네임');
      await page.locator('#member-form button[type="submit"]').click();
      await page.locator('#member-message').filter({hasText:'저장했습니다'}).waitFor();
      await page.locator('#member-reset').click();
      await page.locator('#member-message').filter({hasText:'인증번호를 발송'}).waitFor();
      await page.screenshot({path:`/tmp/revcc-members-${width}.png`,fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page should not overflow');
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('PASS: desktop/mobile reset flow, member detail/save/email, no JS errors or page overflow');
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
