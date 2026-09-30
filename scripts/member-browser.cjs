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
    if (pathname==='/') {res.setHeader('Content-Type','text/html');res.end('<main>REV.CC main destination fixture</main>');return;}
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
      let signupRequests=0;
      let member={id:7,username:'rev-driver',nickname:'드라이버',email:'member@example.test',joinedAt:null,status:'ACTIVE',role:'USER',suspendedUntil:null,kakaoOnly:false};
      await page.route('**/api/**',async route=>{
        const request=route.request(),url=new URL(request.url()),p=url.pathname;
        let data={};
        if (p==='/api/auth/check-username') {
          if(url.searchParams.get('username')==='slow') await new Promise(r=>setTimeout(r,200));
          data={available:url.searchParams.get('username')!=='taken'};
        }
        else if (p==='/api/auth/login' || p==='/api/auth/me') data={id:7,username:'rev-driver',role:'USER'};
        else if (p==='/api/auth/signup') { signupRequests++; data={id:8}; }
        else if (p==='/api/auth/password-reset/request') {
          const username=request.postDataJSON().username;
          if(username==='missing' || username==='mismatch' || username==='limited') {
            const limited=username==='limited';
            await route.fulfill({status:limited?429:400,contentType:'application/json',body:JSON.stringify({code:limited?'RATE_LIMITED':username==='missing'?'USERNAME_NOT_FOUND':'IDENTITY_MISMATCH',message:limited?'요청이 많습니다. 잠시 후 다시 시도해주세요.':username==='missing'?'등록되지 않은 아이디입니다.':'아이디와 이메일 정보가 일치하지 않습니다.'})});return;
          }
          assert.equal(username,'rev-driver');
          assert.equal(request.postDataJSON().email,'member@example.test');
          data={code:'CODE_SENT',message:'인증번호를 발송했습니다.'};
        }
        else if (p==='/api/board/me') data={id:1,username:'admin',role:'ADMIN'};
        else if (p==='/api/admin/members') data={items:[member,{...member,id:8,username:'rev-second'}],total:2,page:1,pageSize:20};
        else if (p==='/api/admin/members/8') data={...member,id:8,username:'rev-second'};
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
      await page.goto(base+'/signup');
      await page.locator('#username').fill('new-member');
      await page.locator('#password').fill('valid-password');
      await page.locator('#password-confirm').fill('valid-password');
      await page.locator('#terms').check(); await page.locator('#privacy').check();
      await page.locator('#auth-submit').click();
      assert.equal(signupRequests,0);
      assert.match(await page.locator('#auth-message').textContent(),/중복확인/);
      await page.locator('#check-username').click();
      await page.locator('#username-status').filter({hasText:'사용 가능한'}).waitFor();
      await page.locator('#username').fill('changed-member');
      assert.equal(await page.locator('#username-status').textContent(),'');
      await page.locator('#auth-submit').click(); assert.equal(signupRequests,0);
      await page.locator('#username').fill('slow'); await page.locator('#check-username').click();
      await page.locator('#username').fill('changed-while-checking');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#username-status').textContent(),'');
      await page.locator('#username').fill('taken'); await page.locator('#check-username').click();
      await page.locator('#username-status').filter({hasText:'이미 사용 중인'}).waitFor();
      await page.locator('#auth-submit').click(); assert.equal(signupRequests,0);
      await page.locator('#username').fill('new-member'); await page.locator('#check-username').click();
      await page.locator('#username-status').filter({hasText:'사용 가능한'}).waitFor();
      await page.locator('#auth-submit').click(); await page.waitForURL('**/login?**joined=1');
      assert.equal(signupRequests,1);
      await page.goto(base+'/login');
      assert.equal(await page.locator('#check-username').isVisible(),false);
      await page.getByRole('link',{name:'비밀번호를 잊으셨나요?'}).click();
      for(const [username,message] of [['missing','등록되지 않은 아이디입니다.'],['mismatch','아이디와 이메일 정보가 일치하지 않습니다.'],['limited','요청이 많습니다. 잠시 후 다시 시도해주세요.']]) {
        await page.locator('#reset-username').fill(username);
        await page.locator('#reset-email').fill('member@example.test');
        await page.locator('#email-form button').click();
        await page.locator('#auth-message').filter({hasText:message}).waitFor();
        assert.equal(await page.locator('#code-form').isVisible(),false);
        assert.equal(await page.locator('#reset-username').evaluate(n=>n.readOnly),false);
        assert.equal(await page.locator('#reset-email').evaluate(n=>n.readOnly),false);
      }
      await page.locator('#reset-username').fill('rev-driver');
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
      await page.locator('#username').fill('rev-driver');
      await page.locator('#password').fill('new-password');
      await page.locator('#auth-submit').click();
      await page.waitForURL(base+'/');
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
      assert.equal(await page.locator('#member-form input[type="password"], #member-form input[name*="password" i]').count(),0);
      assert.equal(await page.locator('#member-dialog').getAttribute('aria-modal'),'true');
      assert.equal(await page.locator('#member-dialog').getAttribute('aria-labelledby'),'member-title');
      await page.locator('#member-close').click();
      await page.waitForFunction(()=>!document.querySelector('#member-dialog').open && selectedMember===null);
      assert.equal(await page.locator('[data-member-id="7"]').evaluate(n=>document.activeElement===n),true);
      for(const [id,method] of [[8,'overlay'],[7,'escape'],[8,'button']]) {
        await page.locator(`[data-member-id="${id}"]`).click();
        await page.locator('#member-dialog').waitFor({state:'visible'});
        assert.match(await page.locator('#member-title').textContent(),new RegExp('#'+id));
        await page.locator('#member-form [name="nickname"]').click();
        assert.equal(await page.locator('#member-dialog').evaluate(n=>n.open),true);
        const box=await page.locator('#member-dialog').boundingBox();
        await page.mouse.click(box.x+box.width/2,box.y+10);
        assert.equal(await page.locator('#member-dialog').evaluate(n=>n.open),true);
        if(method==='overlay') await page.mouse.click(2,2);
        else if(method==='escape') await page.keyboard.press('Escape');
        else await page.locator('#member-close').click();
        await page.waitForFunction(()=>!document.querySelector('#member-dialog').open && selectedMember===null);
        assert.equal(await page.locator(`[data-member-id="${id}"]`).evaluate(n=>document.activeElement===n),true);
        assert.equal(await page.locator('#member-form [name="nickname"]').inputValue(),'');
      }
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('PASS: desktop/mobile username checks, invalidation, stale response, signup guard, reset flow, member detail/save/email, no JS errors or page overflow');
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
