// Real HTTP/browser regression for the /home personal garage and legacy /garage redirects.
// Creates uniquely named accounts and removes their posts, vehicles, documents and sessions.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const base = process.env.REVCC_URL || 'http://localhost:8090';
const run = randomUUID().replaceAll('-', '').slice(0,12);
const accounts = [];
const sql = text => execFileSync('docker', ['compose','exec','-T','postgres','psql','-U','revcc','-d','revcc','-At','-v','ON_ERROR_STOP=1'], {input:text, encoding:'utf8'}).trim();
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=';
let browser;
async function request(context, path, method='GET', data, status=200) {
  const response = await context.request.fetch(base+path, {method, ...(data===undefined?{}:{data})});
  assert.equal(response.status(), status, `${method} ${path}: ${await response.text()}`);
  return status===204?null:response.json();
}
async function state(page, expected) {
  await page.waitForFunction(value=>document.querySelector('#home-garage')?.dataset.state===value, expected);
}
async function cars(page, ids) {
  await state(page, ids.length?'HAS_VEHICLE':'EMPTY_GARAGE');
  const actual = await page.locator('#owned-vehicles [data-vehicle-id]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.vehicleId)));
  assert.deepEqual(actual.sort((a,b)=>a-b), [...ids].sort((a,b)=>a-b));
}
(async()=>{
  browser=await chromium.launch({headless:true, ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const errors=[];
  const guest=await browser.newContext();const page=await guest.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  let privateCalls=0;
  page.on('request',req=>{if (/\/api\/(garage\/vehicles|board\/(garage|posts\?scope|notifications))/.test(req.url()))privateCalls++;});
  await page.goto(base);await page.locator('nav[aria-label="주 메뉴"] a[href="/home"]').click();
  await state(page,'NOT_AUTHENTICATED');
  assert.match(await page.locator('#home-garage').innerText(), /내 차고를 이용하려면 로그인이 필요합니다/);
  assert.equal(await page.locator('#home-garage a').getAttribute('href'),'/login');
  assert.equal(await page.locator('#member-content').isVisible(),false);
  for (const path of ['/home','/garage','/garage/','/garage/index.html']) {
    await page.goto(base+path+'?legacy=1#car-1');await state(page,'NOT_AUTHENTICATED');
    assert.equal(new URL(page.url()).pathname,'/home');
    assert.equal(new URL(page.url()).hash,'#car-1');
    assert.equal(new URL(page.url()).search,'?legacy=1');
    await page.reload();await state(page,'NOT_AUTHENTICATED');
  }
  assert.equal(privateCalls,0);
  const redirect=await guest.request.get(base+'/garage?test=1',{maxRedirects:0});
  assert.equal(redirect.status(),302);assert.equal(redirect.headers().location,'/home?test=1');
  await request(guest,'/api/garage/vehicles','GET',undefined,401);
  console.log('PASS: nav -> /home, guest login UI, no private fetch, legacy redirects preserve query/hash and reload');

  for (const kind of ['empty','owner','admin']) {
    const context=await browser.newContext();const credentials={username:`home_garage_${run}_${kind}`,password:randomUUID()};
    const user=await request(context,'/api/auth/signup','POST',credentials,201);
    const account={context,credentials,id:user.id,kind,cars:[]};accounts.push(account);
    if(kind==='admin')sql(`UPDATE users SET role='ADMIN' WHERE id=${user.id} AND username='${credentials.username}';`);
    account.session=await request(context,'/api/auth/login','POST',credentials);
    assert.equal(account.session.role,kind==='admin'?'ADMIN':'USER');
    assert.deepEqual(await request(context,'/api/auth/me'),account.session);
    assert.deepEqual(await request(context,'/api/board/me'),account.session);
    const emptyPage=await context.newPage();await emptyPage.goto(base+'/home');await cars(emptyPage,[]);
    assert.match(await emptyPage.locator('#home-garage').innerText(),/아직 등록된 차량이 없습니다/);
    assert.equal(await emptyPage.locator('#admin-link').isVisible(),kind==='admin');
    assert.equal(await emptyPage.locator('.admin-shell').count(),0);await emptyPage.close();
    if(kind!=='empty')for(let i=0;i<(kind==='owner'?5:1);i++) {
      const car=await request(context,'/api/garage/vehicles','POST',{manufacturer:'Regression',model:`${kind}-${run}-${i}`,modelYear:2024,licensePlate:`TEST-${i}`},201);
      account.cars.push(car.id);
    }
    const vehicles=await request(context,'/api/garage/vehicles');
    assert.ok(vehicles.every(vehicle=>vehicle.userId===user.id));
    account.page=await context.newPage();account.page.on('pageerror',error=>errors.push(error.message));
    await account.page.goto(base+'/home');await cars(account.page,account.cars);
    await account.page.reload();await cars(account.page,account.cars);
    const positions=await account.page.evaluate(()=>({
      nav:document.querySelector('header').getBoundingClientRect().bottom,
      vehicle:document.querySelector('#my-vehicles').getBoundingClientRect().top,
      bottom:document.querySelector('#my-vehicles').getBoundingClientRect().bottom,
      activity:document.querySelector('#member-content').getBoundingClientRect().top,
    }));
    assert.ok(positions.vehicle>=positions.nav && positions.activity>=positions.bottom);
  }
  const [empty,owner,admin]=accounts;
  await request(empty.context,'/api/admin/overview','GET',undefined,403);
  const mine=await request(owner.context,'/api/board/posts','POST',{title:`mine-${run}`,content:'Own post',category:'free'},201);
  const other=await request(admin.context,'/api/board/posts','POST',{title:`other-${run}`,content:'Other post',category:'free'},201);
  await request(owner.context,`/api/board/posts/${other.id}/comments`,'POST',{content:'My comment'},201);
  await request(admin.context,`/api/board/posts/${mine.id}/comments`,'POST',{content:'Reply to owner'},201);
  await owner.page.reload();await cars(owner.page,owner.cars);
  await owner.page.locator('#home-posts a',{hasText:`mine-${run}`}).waitFor();
  assert.equal(await owner.page.locator('#home-posts a',{hasText:`other-${run}`}).count(),0);
  await owner.page.locator('[data-activity="commented"]').click();
  await owner.page.locator('#home-posts a',{hasText:`other-${run}`}).waitFor();
  assert.equal(await owner.page.locator('#home-posts a',{hasText:`mine-${run}`}).count(),0);
  await owner.page.locator('[data-activity="notifications"]').click();
  await owner.page.locator('#home-posts a',{hasText:`mine-${run}`}).waitFor();
  assert.match(await owner.page.locator('#home-posts').innerText(),/님의 댓글/);
  console.log('PASS: own vehicles only, empty owner, top vehicle layout, scoped own/commented posts and real activity notification');

  // Profile, representative vehicle and guestbook share the same ownership policy for both roles.
  await owner.page.locator('#edit-profile').click();
  await owner.page.getByLabel('한 줄 소개').fill('내 자동차 생활');
  await owner.page.locator('[name="avatarImageId"]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await owner.page.locator('[name="coverImageId"]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await owner.page.getByRole('button',{name:'프로필 저장',exact:true}).click();
  await owner.page.locator('#home-profile').getByText('내 자동차 생활').waitFor();
  assert.equal(await owner.page.locator('#home-profile .author-avatar img').count(),1);
  const ownerProfile=await request(owner.context,`/api/board/members/${owner.id}`);
  await request(admin.context,'/api/board/profile','PUT',{bio:'관리자도 동일한 개인 소개'});
  await admin.page.reload();await cars(admin.page,admin.cars);
  assert.match(await admin.page.locator('#home-profile').innerText(),/관리자도 동일한 개인 소개/);
  await request(admin.context,'/api/board/profile/representative-vehicle','PUT',{vehicleId:owner.cars[0]},403);
  await request(empty.context,'/api/board/profile','PUT',{avatarImageId:ownerProfile.avatarImageId},400);
  await owner.page.locator(`[data-vehicle-id="${owner.cars[1]}"]`).getByRole('button',{name:'대표 차량 설정',exact:true}).click();
  await owner.page.locator('#home-garage h2',{hasText:`owner-${run}-1`}).waitFor();
  await owner.page.reload();await cars(owner.page,owner.cars);
  assert.equal((await request(owner.context,`/api/board/members/${owner.id}`)).representativeVehicle.id,owner.cars[1]);
  // Other members leave a message through the existing member dialog; /home remains personal.
  await empty.page.goto(base+`/community#member-${owner.id}`);
  await empty.page.getByLabel('방명록 내용').fill('다음 모임에 뵙겠습니다.');
  await empty.page.getByRole('button',{name:'방명록 등록',exact:true}).click();
  await empty.page.locator('.guestbook-list').getByText('다음 모임에 뵙겠습니다.').waitFor();
  const entry=(await request(owner.context,`/api/board/members/${owner.id}/guestbook`)).items[0];
  assert.equal(entry.authorId,empty.id);
  await request(admin.context,`/api/board/members/${owner.id}/guestbook/${entry.id}`,'DELETE',{},403);
  await owner.page.reload();await owner.page.locator('#home-guestbook').getByText('다음 모임에 뵙겠습니다.').waitFor();
  await owner.page.locator('#home-guestbook').getByRole('button',{name:'삭제',exact:true}).click();
  await owner.page.locator('#confirm-delete').click();
  await owner.page.locator('#home-guestbook').getByText('아직 남겨진 메시지가 없습니다.').waitFor();
  await request(guest,`/api/board/members/${owner.id}/guestbook`,'POST',{content:'denied'},401);
  await request(guest,'/api/board/profile','PUT',{bio:'denied'},401);
  await empty.page.goto(base+'/admin');await empty.page.locator('#admin-denied').waitFor({state:'visible'});
  await empty.page.goto(base+'/home');await cars(empty.page,[]);
  const layout=async p=>p.locator('.personal-garage-grid').evaluate(node=>getComputedStyle(node).gridTemplateColumns);
  assert.equal(await layout(owner.page),await layout(admin.page));
  console.log('PASS: USER/ADMIN empty and identical layout, management NAV/denial, profile images/bio, representative selection/reload, cross-owner rejection, guestbook write/read/delete and permissions');

  // Reuse the existing registration flow; then exercise the migrated management UI.
  await empty.page.locator('#home-garage button',{hasText:'차량 등록하기'}).click();
  const reg=empty.page.locator('#registration-dialog');
  await reg.locator('[name="manufacturer"]').fill('Test');await reg.locator('[name="model"]').fill(`registered-${run}`);
  await reg.locator('[name="modelYear"]').fill('2024');await reg.locator('[name="licensePlate"]').fill('TEST-REG');
  await reg.locator('#vehicle-info-form button[type="submit"]').click();
  await reg.locator('#vehicle-step-document').waitFor({state:'visible'});
  await reg.locator('#vehicle-skip-document').click();
  await state(empty.page,'HAS_VEHICLE');
  let registered=(await request(empty.context,'/api/garage/vehicles'))[0];
  assert.ok(registered);assert.equal(registered.userId,empty.id);
  await empty.page.locator('#home-garage button',{hasText:'수정',exact:true}).click();
  const edit=empty.page.locator('#vehicle-dialog');
  await edit.locator('[name="model"]').fill(`edited-${run}`);
  await edit.locator('[name="bio"]').fill('Edited in /home');
  await edit.locator('#vehicle-image').setInputFiles({name:'car.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await edit.locator('#vehicle-preview img').waitFor();
  await edit.locator('button[type="submit"]').click();
  await empty.page.locator('#detail-content h2',{hasText:`edited-${run}`}).waitFor();
  registered=(await request(empty.context,'/api/garage/vehicles'))[0];
  assert.equal(registered.model,`edited-${run}`);assert.equal(registered.licensePlate,'TEST-REG');
  assert.equal(await empty.page.locator('#detail-content img').count(),1);
  const form=empty.page.locator('#detail-content .record-form');
  await form.locator('[name="title"]').fill('Record from /home');
  await form.locator('[name="date"]').fill('2026-09-21');await form.locator('[name="mileage"]').fill('1200');
  await form.locator('button[type="submit"]').click();
  await empty.page.locator('#detail-content .record h3',{hasText:'Record from /home'}).waitFor();
  await empty.page.locator('#detail-content .record button').click();
  await empty.page.locator('#confirm-delete').click();
  await empty.page.waitForFunction(()=>!document.querySelector('#detail-content .record'));
  await empty.page.locator('#detail-content button',{hasText:'차량 삭제',exact:true}).click();
  await empty.page.locator('#confirm-delete').click();await state(empty.page,'EMPTY_GARAGE');
  assert.deepEqual(await request(empty.context,'/api/garage/vehicles'),[]);
  console.log('PASS: existing registration -> skip document -> edit/photo -> record add/delete -> vehicle delete back to empty');

  const cookie=(await admin.context.cookies()).find(c=>c.name==='REVCC_SESSION').value;
  await admin.page.locator('#home-garage button',{hasText:'오너 인증 신청'}).click();
  await admin.page.locator('#vehicle-document-input').setInputFiles({name:'document.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await admin.page.locator('#vehicle-document-form button[type="submit"]').click();
  await admin.page.locator('#home-garage .status-chip',{hasText:'인증 검토 중'}).waitFor();
  await admin.page.locator('#admin-link').click();await admin.page.locator('#admin-app').waitFor({state:'visible'});
  const submissions=await request(admin.context,'/api/admin/vehicle-verifications');
  const submission=submissions.find(item=>item.vehicleId===admin.cars[0]);assert.ok(submission);
  await request(admin.context,`/api/admin/vehicle-verifications/${submission.id}/approve`,'POST',{});
  await admin.page.locator('nav[aria-label="주 메뉴"] a[href="/home"]').click();await cars(admin.page,admin.cars);
  assert.match(await admin.page.locator('#home-garage').innerText(),/인증 완료/);
  assert.deepEqual(await request(admin.context,'/api/auth/me'),admin.session);
  assert.equal((await admin.context.cookies()).find(c=>c.name==='REVCC_SESSION').value,cookie);
  await admin.page.goto(base+`/garage?legacy=1#car-${admin.cars[0]}`);
  await admin.page.locator('#detail-content .record-form').waitFor();
  assert.equal(new URL(admin.page.url()).pathname,'/home');
  await admin.page.locator('#detail-dialog [data-close]').click();
  console.log('PASS: ADMIN shared screen/permissions/session, actual document submission and approval, legacy vehicle detail link');

  await owner.page.setViewportSize({width:1536,height:1024});
  await owner.page.screenshot({path:'/tmp/revcc-home-desktop.png',fullPage:true});

  // An old response must not repaint vehicles after logout.
  let release,captured;
  const blocked=new Promise(resolve=>{release=resolve;});const capture=new Promise(resolve=>{captured=resolve;});
  await admin.page.route('**/api/garage/vehicles',async route=>{const response=await route.fetch();captured();await blocked;await route.fulfill({response});});
  await admin.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await capture;
  await admin.page.locator('#logout').click();await state(admin.page,'NOT_AUTHENTICATED');
  const late=admin.page.waitForResponse(response=>response.url().endsWith('/api/garage/vehicles'));release();await late;
  await admin.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await state(admin.page,'NOT_AUTHENTICATED');
  assert.equal(await admin.page.locator('[data-vehicle-id]').count(),0);
  assert.equal(await admin.page.locator('#home-posts').innerText(),'');
  await admin.page.unroute('**/api/garage/vehicles');
  await admin.page.reload();await state(admin.page,'NOT_AUTHENTICATED');
  await request(owner.context,'/api/auth/logout','POST',{});
  await owner.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await state(owner.page,'NOT_AUTHENTICATED');
  await empty.page.route('**/api/garage/vehicles',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await empty.page.reload();await state(empty.page,'ERROR');
  await empty.page.unroute('**/api/garage/vehicles');
  await empty.page.locator('#home-garage button').click();await state(empty.page,'EMPTY_GARAGE');
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop, logout/reload, cross-tab revocation, late-response guard, error/retry; no browser JS errors');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  try {
    const ids=accounts.map(account=>account.id);
    if(ids.length) {
      // Delete shared test posts first, then documents (reviewed_by FK), then vehicles/images/users.
      const owners=`SELECT id FROM users WHERE id IN (${ids.join(',')}) AND username LIKE 'home_garage_${run}_%'`;
      sql(`BEGIN; DELETE FROM board_posts WHERE author_id IN (${owners}); DELETE FROM vehicle_verifications WHERE vehicle_id IN (SELECT id FROM owner_vehicles WHERE owner_id IN (${owners})); DELETE FROM owner_vehicles WHERE owner_id IN (${owners}); DELETE FROM community_images WHERE owner_id IN (${owners}); DELETE FROM users WHERE id IN (${owners}); COMMIT;`);
    }
    for(const account of accounts)await request(account.context,'/api/auth/logout','POST',{});
  } catch(error){console.error('Cleanup failed:',error.message);process.exitCode=1;}
  await browser?.close();
  console.log(process.exitCode?'Test failed; see errors above.':'Cleanup complete: temporary accounts/data/sessions removed.');
});
