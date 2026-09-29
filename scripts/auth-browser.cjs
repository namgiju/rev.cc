// Live Spring/PostgreSQL/Redis validation with unique disposable accounts.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const base = process.env.REVCC_URL || "http://localhost:8090",
  run = randomUUID().replaceAll("-", "").slice(0, 10),
  accounts = [];
const sql = (input) =>
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "revcc",
      "-d",
      "revcc",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input, encoding: "utf8" },
  ).trim();
const redis = (...args) =>
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "redis", "redis-cli", "--raw", ...args],
    { encoding: "utf8" },
  ).trim();
let browser;
(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  const request = async (path, data, status = 200) => {
    const r = await context.request.post(base + path, { data });
    assert.equal(r.status(), status);
    return r;
  };
  await page.goto(base + "/login");
  await page.getByRole("heading", { name: "Welcome back," }).waitFor();
  assert.equal(await page.locator("nav,footer").count(), 0);
  assert.equal(
    await page.locator("#auth-kakao").getAttribute("href"),
    "/api/auth/kakao/login",
  );
  await page.screenshot({
    path: "/tmp/revcc-login-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "회원가입 →", exact: true }).click();
  await page.waitForURL("**/signup?next=*");
  await page.reload();
  await page.getByRole("heading", { name: "Join REV.CC" }).waitFor();
  await page.getByRole("link", { name: "로그인 →", exact: true }).click();
  await page.goBack();
  await page.getByRole("heading", { name: "Join REV.CC" }).waitFor();
  for (const role of ["USER", "ADMIN"]) {
    const username = `auth_${run}_${role.toLowerCase()}`,
      password = randomUUID();
    await page.goto(base + "/signup");
    await page.locator("#username").fill(username);
    await page.locator("#check-username").click();
    await page.getByText("사용 가능한 아이디입니다.", { exact: true }).waitFor();
    await page.locator("#password").fill(password);
    await page.locator("#password-confirm").fill("mismatch");
    await page.locator("#terms").check();
    await page.locator("#privacy").check();
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await page.getByText("비밀번호 확인이 일치하지 않습니다.").waitFor();
    await page.locator("#password-confirm").fill(password);
    await page
      .getByRole("button", { name: "비밀번호 표시", exact: true })
      .click();
    assert.equal(await page.locator("#password").getAttribute("type"), "text");
    await page
      .getByRole("button", { name: "비밀번호 숨기기", exact: true })
      .click();
    const registered = page.waitForResponse(
      (r) =>
        r.url() === base + "/api/auth/signup" &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    assert.equal((await registered).status(), 201);
    const result = {
      id: Number(sql(`SELECT id FROM users WHERE username='${username}';`)),
    };
    assert.ok(result.id);
    accounts.push({ id: result.id, username, context });
    await page.waitForURL("**/login?*joined=1");
    await page
      .getByText("회원가입이 완료되었습니다. 새 계정으로 로그인해주세요.")
      .waitFor();
    assert.equal(
      sql(
        `SELECT password LIKE '$2%' AND password<>'${password}' FROM users WHERE id=${result.id};`,
      ),
      "t",
    );
    if (role === "ADMIN")
      sql(`UPDATE users SET role='ADMIN' WHERE id=${result.id};`);
    await page.goto(base + "/signup");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.locator("#password-confirm").fill(password);
    await page.locator("#terms").check();
    await page.locator("#privacy").check();
    await page.locator("#check-username").click();
    await page.getByText("이미 사용 중인 아이디입니다.", { exact: true }).waitFor();
    await request("/api/auth/signup", { username, password }, 409);
    await page.goto(base + "/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill("wrong");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByText("아이디 또는 비밀번호가 올바르지 않습니다.").waitFor();
    const known = await request(
        "/api/auth/login",
        { username, password: "wrong" },
        401,
      ),
      unknown = await request(
        "/api/auth/login",
        { username: `missing_${run}`, password: "wrong" },
        401,
      );
    assert.deepEqual(await known.json(), await unknown.json());
    await page.locator("#password").fill(password);
    let logins = 0;
    const count = (r) => {
      if (r.method() === "POST" && r.url() === base + "/api/auth/login")
        logins++;
    };
    page.on("request", count);
    await page.evaluate(() => {
      const f = document.querySelector("#auth-form");
      f.requestSubmit();
      f.requestSubmit();
    });
    await page.waitForURL(base + "/");
    page.off("request", count);
    assert.equal(logins, 1);
    const me = await (await context.request.get(base + "/api/auth/me")).json();
    assert.equal(me.id, result.id);
    assert.equal(me.role, role);
    const board = await (
      await context.request.get(base + "/api/board/me")
    ).json();
    assert.equal(board.id, result.id);
    const cookie = (await context.cookies()).find(
      (c) => c.name === "REVCC_SESSION",
    );
    assert.ok(cookie.httpOnly);
    assert.equal(cookie.sameSite, "Lax");
    assert.match(cookie.value, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(
      !(await page.evaluate(() => document.cookie)).includes("REVCC_SESSION"),
    );
    const session = JSON.parse(redis("GET", "revcc:session:" + cookie.value));
    assert.equal(session.id, result.id);
    assert.equal(session.role, role);
    const ttl = Number(redis("TTL", "revcc:session:" + cookie.value));
    assert.ok(ttl > 0 && ttl <= 1800);
    await page.reload();
    assert.equal(
      (await (await context.request.get(base + "/api/auth/me")).json()).id,
      result.id,
    );
    await request("/api/auth/login", { username, password });
    assert.equal(redis("EXISTS", "revcc:session:" + cookie.value), "0");
    const rotated = (await context.cookies()).find(
      (c) => c.name === "REVCC_SESSION",
    );
    assert.notEqual(rotated.value, cookie.value);
    const outsider = await browser.newContext();
    assert.equal(
      (await outsider.request.get(base + "/api/auth/me")).status(),
      401,
    );
    await outsider.close();
    await request("/api/auth/logout", {});
    assert.equal(redis("EXISTS", "revcc:session:" + rotated.value), "0");
    assert.equal(
      (await context.request.get(base + "/api/auth/me")).status(),
      401,
    );
    assert.equal(
      (await context.request.get(base + "/api/board/me")).status(),
      401,
    );
    await page.goto(base + "/community?category=drive#write-post");
    await page.locator("#editor-login a").click();
    await page.waitForURL("**/login?next=*");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.waitForURL("**/community?category=drive#write-post");
    await page.locator("#post-form").waitFor();
    await request("/api/auth/logout", {});
    await page.goto(
      base + "/login?next=" + encodeURIComponent("https://example.com"),
    );
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.waitForURL(base + "/");
    await request("/api/auth/logout", {});
  }
  for (const data of [
    { username: "", password: "x" },
    { username: "a".repeat(101), password: "x" },
    { username: `long_${run}`, password: "가".repeat(25) },
  ])
    await request("/api/auth/signup", data, 400);
  await page.goto(base + "/signup");
  await page.screenshot({
    path: "/tmp/revcc-signup-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/revcc-signup-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(await page.locator(".auth-visual").isVisible(), false);
  await page.goto(base + "/login");
  await page.screenshot({
    path: "/tmp/revcc-login-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const oauth = await context.request.get(base + "/api/auth/kakao/login", {
    maxRedirects: 0,
  });
  assert.equal(oauth.status(), 302);
  assert.equal(
    new URL(oauth.headers().location).origin,
    "https://kauth.kakao.com",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS auth: signup/duplicate/server validation/BCrypt, generic failures, USER/ADMIN default login -> main, /me parity, HttpOnly cookie, Redis TTL/rotation/revocation/isolation, logout, local return/editor resume/open redirect protection, navigation/reload/back, password toggle, duplicate submit, desktop/mobile, Kakao authorize endpoint.",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      for (const a of accounts) {
        await a.context.request.post(base + "/api/auth/logout", { data: {} });
        sql(`DELETE FROM users WHERE id=${a.id} AND username='${a.username}';`);
      }
      sql(`DELETE FROM users WHERE username LIKE 'auth_${run}_%';`);
    } catch (e) {
      console.error("Cleanup failed");
      process.exitCode = 1;
    }
    await browser?.close();
  });
