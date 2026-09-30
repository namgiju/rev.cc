// Real HTTP/browser check of the STEP 10-impl-C withdrawal UI on /home against a running stack (REVCC_URL).
// Never point this at production: it creates accounts and withdraws them (withdrawn accounts cannot be removed).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const base = process.env.REVCC_URL || 'http://localhost:8090';
const run = randomUUID().replaceAll('-', '').slice(0, 10);
async function request(context, path, method = 'GET', data, status = 200) {
  const response = await context.request.fetch(base + path, { method, ...(data === undefined ? {} : { data }) });
  assert.equal(response.status(), status, `${method} ${path}: ${await response.text()}`);
  return response.json().catch(() => null);
}
async function account(browser, name, email) {
  const context = await browser.newContext();
  const credentials = { username: `wd_${run}_${name}`, password: `pw-${randomUUID()}` };
  await request(context, '/api/auth/signup', 'POST', email ? { ...credentials, email } : credentials, 201);
  await request(context, '/api/auth/login', 'POST', credentials);
  return { context, credentials };
}
async function openWithdraw(page) {
  await page.goto(base + '/home');
  await page.waitForFunction(() => !document.querySelector('#withdraw-account').hidden);
  await page.locator('#withdraw-account').click();
  await page.waitForFunction(() => document.querySelector('#panel-dialog').open && document.querySelector('#panel-title').textContent === '회원 탈퇴');
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const errors = [];
  try {
    // 1. 일반 계정: 안내 → 틀린 비밀번호는 화면에 사유 표시(탈퇴 안 됨) → 맞는 비밀번호 + 동의 → 로그아웃 상태로 홈 이동.
    const user = await account(browser, 'local', `wd-${run}@example.com`);
    const post = await request(user.context, '/api/board/posts', 'POST', { title: `탈퇴 브라우저 ${run}`, content: '남는 글' }, 201);
    const page = await user.context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await openWithdraw(page);
    const text = await page.locator('#panel-content').innerText();
    for (const phrase of ['30일', '탈퇴한 회원', '자동차등록증', '판매중 매물은 비공개']) assert.ok(text.includes(phrase), phrase);
    const form = page.locator('#panel-content form');
    await form.locator('input[type=password]').fill('wrong-password');
    await form.locator('input[type=checkbox]').check();
    await form.locator('button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#panel-content .danger-text')?.textContent.includes('비밀번호가 올바르지 않습니다'));
    await request(user.context, '/api/auth/me');
    await form.locator('input[type=password]').fill(user.credentials.password);
    await Promise.all([page.waitForURL(url => new URL(url).pathname === '/'), form.locator('button[type=submit]').click()]);
    await request(user.context, '/api/auth/me', 'GET', undefined, 401);
    await request(user.context, '/api/board/me', 'GET', undefined, 401);
    const kept = await request(user.context, `/api/board/posts/${post.id}`);
    assert.deepEqual([kept.username, kept.authorId], ['탈퇴한 회원', null]);
    await request(user.context, '/api/auth/login', 'POST', user.credentials, 401);
    console.log('PASS: local account withdrawal UI (notice, wrong password shown, success -> signed out at /), post kept as 탈퇴한 회원');

    // 2. 예약중 매물이 있으면 폼 없이 사유만 보여 준다.
    const seller = await account(browser, 'seller');
    await request(seller.context, '/api/parts/listings', 'POST', { title: '예약 휠', description: 'd', price: 1, category: 'wheels', status: 'reserved', vehicle: 'v', region: 'r', contact: 'c' }, 201);
    const sellerPage = await seller.context.newPage(); sellerPage.on('pageerror', e => errors.push(e.message));
    await openWithdraw(sellerPage);
    assert.match(await sellerPage.locator('#panel-content').innerText(), /예약중인 매물이 1개/);
    assert.equal(await sellerPage.locator('#panel-content form').count(), 0);
    await request(seller.context, '/api/auth/me');

    // 3. 카카오 계정(서버 응답 method=KAKAO)은 준비 중 안내만, 탈퇴 버튼이 없다(가짜 성공 없음).
    await sellerPage.route('**/api/auth/withdraw', route => route.request().method() === 'GET'
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ method: 'KAKAO', admin: false, reservedListings: 0, available: true }) })
      : route.abort());
    await sellerPage.locator('#panel-dialog [data-close]').click();
    await sellerPage.locator('#withdraw-account').click();
    await sellerPage.waitForFunction(() => document.querySelector('#panel-content')?.innerText.includes('카카오 재인증'));
    assert.equal(await sellerPage.locator('#panel-content form').count(), 0);
    console.log('PASS: reserved listing and Kakao accounts see the reason without a withdraw form');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
