const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process"),
  { randomUUID } = require("node:crypto");
const base = "http://localhost:8090",
  accounts = [],
  run = randomUUID().replaceAll("-", "").slice(0, 10);
let browser;
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
(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  for (const role of ["USER", "ADMIN"]) {
    const c = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      credentials = { username: `ops_${run}_${role}`, password: randomUUID() };
    const r = await c.request.post(base + "/api/auth/signup", {
      data: credentials,
    });
    assert.equal(r.status(), 201);
    const u = await r.json();
    accounts.push({ c, id: u.id, username: credentials.username });
    if (role === "ADMIN")
      sql(`UPDATE users SET role='ADMIN' WHERE id=${u.id};`);
    assert.equal(
      (
        await c.request.post(base + "/api/auth/login", { data: credentials })
      ).status(),
      200,
    );
  }
  const [user, admin] = accounts;
  const post = await (
    await user.c.request.post(base + "/api/board/posts", {
      data: {
        title: `review-${run}`,
        content: "operational test",
        category: "free",
      },
    })
  ).json();
  const report = await (
    await user.c.request.post(base + `/api/board/posts/${post.id}/report`, {
      data: { reason: `reason-${run}` },
    })
  ).json();
  const p = await admin.c.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/admin");
  await p.locator("#overview-stats .stat-tile").first().waitFor();
  assert.equal(await p.locator(".mock-badge").count(), 0);
  assert.ok(!(await p.locator("#admin-app").innerText()).includes("예시"));
  await p.locator("[data-panel=members]").first().click();
  await p.locator("#members-controls input").fill(run);
  await p.locator("#members-controls button[type=submit]").click();
  await p.waitForFunction(() =>
    document.querySelector("#members-count").textContent.includes("총 2개"),
  );
  assert.match(
    await p.locator("#members-body").innerText(),
    new RegExp(user.username),
  );
  await p.locator("[data-panel=posts]").first().click();
  await p.locator("#posts-controls input").fill(run);
  await p.locator("#posts-controls button[type=submit]").click();
  await p.waitForFunction(() =>
    document.querySelector("#posts-count").textContent.includes("총 1개"),
  );
  assert.equal(
    await p.locator("#posts-body a").getAttribute("href"),
    `/community/free/${post.id}`,
  );
  await p.locator("[data-panel=reports]").first().click();
  await p.locator("#reports-controls input").fill(run);
  await p.locator("#reports-controls button[type=submit]").click();
  await p.waitForFunction(() =>
    document.querySelector("#reports-count").textContent.includes("총 1개"),
  );
  await p
    .locator("#reports-body")
    .getByRole("button", { name: "검토", exact: true })
    .click();
  await p.locator("#review-form textarea").fill("실제 검토 결과");
  await p.locator("#review-submit").click();
  await p.locator("#review-dialog").waitFor({ state: "hidden" });
  await p.waitForFunction(() =>
    document
      .querySelector("#reports-body")
      .textContent.includes("실제 검토 결과"),
  );
  await p.reload();
  await p.locator("#admin-app").waitFor();
  await p.locator("[data-panel=reports]").first().click();
  assert.equal(
    (
      await (
        await admin.c.request.get(base + `/api/board/admin/reports?q=${run}`)
      ).json()
    ).items[0].status,
    "resolved",
  );
  await p.locator("[data-panel=tags]").first().click();
  await p
    .getByText("자동차등록증 검토를 통해 보유 차량 인증 완료", { exact: true })
    .waitFor();
  await p.locator("[data-panel=vehicles]").first().click();
  assert.equal(
    (
      await admin.c.request.get(base + "/api/admin/vehicle-verifications")
    ).status(),
    200,
  );
  const up = await user.c.newPage();
  await up.goto(base + "/admin");
  await up.locator("#admin-denied").waitFor();
  assert.equal(
    (await user.c.request.get(base + "/api/board/admin/members")).status(),
    403,
  );
  assert.equal(
    (
      await user.c.request.patch(
        base + `/api/board/admin/reports/${report.id}`,
        { data: { status: "dismissed", note: "forged" } },
      )
    ).status(),
    403,
  );
  assert.equal(
    (await (await user.c.request.get(base + "/api/board/reports")).json()).find(
      (r) => r.id === report.id,
    ).status,
    "resolved",
  );
  await p.screenshot({ path: "/tmp/revcc-admin-live.png", fullPage: true });
  sql(`UPDATE users SET role='USER' WHERE id=${admin.id};`);
  await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await p.locator('#admin-denied').waitFor();
  assert.equal(await p.locator('#admin-app').isVisible(),false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS admin browser: live USER/ADMIN, real overview/members/posts/reports/badges, search/canonical links, review save/reload, reporter status, forbidden operations, existing vehicle verification endpoint, no JS errors.",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      for (const a of accounts) {
        await a.c.request.post(base + "/api/auth/logout", { data: {} });
        sql(
          `DELETE FROM board_posts WHERE author_id=${a.id};DELETE FROM users WHERE id=${a.id} AND username='${a.username}';`,
        );
      }
    } finally {
      await browser?.close();
    }
  });
