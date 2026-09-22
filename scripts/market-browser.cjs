// End-to-end real accounts, Redis cookies and HTTP. Temporary data is always cleaned.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"),
  { randomUUID } = require("node:crypto");
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
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=",
  "base64",
);
let browser;
// 네이티브 select 팝업 대신 REV.CC 커스텀 드롭다운(트리거 클릭 → 항목 클릭)으로 선택한다.
async function pick(page, select, text) {
  const dd = select.locator("xpath=ancestor::div[contains(@class,'rev-dd')][1]");
  await dd.locator(".rev-dd-trigger").click();
  await dd.getByRole("option", { name: text, exact: true }).click();
  assert.equal(await dd.locator(".rev-dd-trigger").innerText(), text);
}
async function pickIndex(select, index) {
  const dd = select.locator("xpath=ancestor::div[contains(@class,'rev-dd')][1]");
  await dd.locator(".rev-dd-trigger").click();
  await dd.locator(".rev-dd-option").nth(index).click();
}
async function req(context, path, method = "GET", data, status = 200) {
  const r = await context.request.fetch(base + path, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  assert.equal(r.status(), status, `${method} ${path}: ${await r.text()}`);
  return r.json();
}
(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const errors = [];
  const guest = await browser.newContext({
      viewport: { width: 1536, height: 1024 },
    }),
    guestPage = await guest.newPage();
  guestPage.on("pageerror", (e) => errors.push(e.message));
  await guestPage.goto(base + "/parts");
  await guestPage.waitForFunction(
    () =>
      document.querySelector("#market-my-garage")?.dataset.state ===
      "NOT_AUTHENTICATED",
  );
  assert.equal(await guestPage.locator("#compatibility").count(), 0);
  assert.equal(await guestPage.locator("footer").count(), 1);
  await guestPage.locator("#market-new").click();
  assert.match(await guestPage.locator("#notice").innerText(), /로그인 후/);
  for (const kind of ["seller", "buyer", "admin"]) {
    const context = await browser.newContext({
        viewport: { width: 1536, height: 1024 },
      }),
      credentials = {
        username: `market_${run}_${kind}`,
        password: randomUUID(),
      };
    const user = await req(
      context,
      "/api/auth/signup",
      "POST",
      credentials,
      201,
    );
    const account = { context, id: user.id, username: credentials.username };
    accounts.push(account);
    if (kind === "admin")
      sql(
        `UPDATE users SET role='ADMIN' WHERE id=${user.id} AND username='${credentials.username}';`,
      );
    await req(context, "/api/auth/login", "POST", credentials);
    account.page = await context.newPage();
    account.page.on("pageerror", (e) => errors.push(e.message));
    await account.page.goto(base + "/parts");
    await account.page.waitForFunction(
      () =>
        document.querySelector("#market-my-garage")?.dataset.state ===
        "EMPTY_GARAGE",
    );
    assert.equal(
      await account.page.locator("#admin-link").isVisible(),
      kind === "admin",
    );
  }
  const [seller, buyer, admin] = accounts;
  for (const account of [seller, admin]) {
    const car = await req(
      account.context,
      "/api/garage/vehicles",
      "POST",
      {
        manufacturer: "Test",
        model: `Own-${account.id}`,
        modelYear: 2024,
        licensePlate: "TEST",
      },
      201,
    );
    account.car = car;
    await req(
      account.context,
      "/api/board/profile/representative-vehicle",
      "PUT",
      { vehicleId: car.id },
    );
    await account.page.reload();
    await account.page.locator("#market-my-garage strong").waitFor();
    assert.match(
      await account.page.locator("#market-my-garage").innerText(),
      new RegExp(car.model),
    );
  }
  const p = seller.page;
  await p.locator("#market-new").click();
  const form = p.locator("#market-form");
  await form.locator('[name="title"]').fill(`Wheel-${run}`);
  await form.locator('[name="description"]').fill("실제 브라우저 등록 검사");
  await form.locator('[name="price"]').fill("120000");
  await pick(p, form.locator('[name="category"]'), "휠 / 타이어");
  assert.equal(await form.locator('[name="category"]').inputValue(), "wheels");
  await p.waitForFunction(
    () => document.querySelector("#market-own-vehicle").options.length > 1,
  );
  await pickIndex(p.locator("#market-own-vehicle"), 1);
  assert.match(await form.locator('[name="vehicle"]').inputValue(), /Own-/);
  await form.locator('[name="region"]').fill("성남");
  await form.locator('[name="contact"]').fill("market-test@example.test");
  await p
    .locator("#market-images")
    .setInputFiles({ name: "part.png", mimeType: "image/png", buffer: png });
  await p.locator("#market-image-previews img").waitFor();
  await p.locator("#market-save").click();
  await p.waitForURL(/#listing-\d+$/);
  await p.locator("#market-detail-content h2").waitFor();
  const id = Number(new URL(p.url()).hash.split("-").pop()),
    path = `/api/parts/listings/${id}`;
  assert.equal((await req(seller.context, path)).sellerId, seller.id);
  assert.equal(
    await p.locator("#market-detail-content .detail-gallery img").count(),
    1,
  );
  assert.match(
    await p.locator("#market-detail-content .market-specs").innerText(),
    new RegExp(seller.car.model),
  );
  const bulk = [];
  for (let i = 0; i < 13; i++)
    bulk.push(
      await req(
        buyer.context,
        "/api/parts/listings",
        "POST",
        {
          title: `bulk-${run}-${i}`,
          description: "페이지 검사",
          price: 10000 + i,
          category: "other",
          status: "selling",
          vehicle: "판매자 입력",
          region: "서울",
          contact: "buyer@example.test",
          imageIds: [],
        },
        201,
      ),
    );
  await p.locator("#market-detail [data-market-close]").click();
  await p.locator("#market-query").fill(`bulk-${run}`);
  await p.locator('#market-filters button[type="submit"]').click();
  await p.waitForFunction(
    () => document.querySelectorAll("#market-list .market-card").length === 12,
  );
  await p
    .locator("#market-pagination")
    .getByRole("button", { name: "다음", exact: true })
    .click();
  await p.waitForFunction(
    () => document.querySelectorAll("#market-list .market-card").length === 1,
  );
  await p.reload();
  await p.waitForFunction(
    () => document.querySelectorAll("#market-list .market-card").length === 1,
  );
  await p.locator("#market-reset").click();
  await p.locator(`#market-popular a[href="/parts#listing-${id}"]`).click();
  await p.locator("#market-detail-content h2").waitFor();
  for (const item of bulk.slice(0, 6)) {
    await guestPage.goto(base + `/parts#listing-${item.id}`);
    await guestPage.locator("#market-detail-content h2").waitFor();
  }
  assert.equal(await guestPage.locator("#market-recent a").count(), 5);

  await guestPage.goto(base + `/parts#listing-${id}`);
  await guestPage.locator(".market-contact").waitFor();
  assert.match(
    await guestPage.locator(".market-contact").innerText(),
    /로그인 후/,
  );
  assert.equal((await req(guest, path)).contact, undefined);
  await buyer.page.goto(base + `/parts#listing-${id}`);
  await buyer.page.locator(".market-contact").waitFor();
  assert.match(
    await buyer.page.locator(".market-contact").innerText(),
    /market-test@example.test/,
  );
  assert.equal(
    await buyer.page
      .getByRole("button", { name: "판매글 수정", exact: true })
      .count(),
    0,
  );
  await buyer.page.locator("#market-detail-content .market-favorite").click();
  await buyer.page
    .locator('#market-detail-content .market-favorite[aria-pressed="true"]')
    .waitFor();
  await buyer.page.locator("#market-detail [data-market-close]").click();
  await buyer.page.locator('[data-market-scope="favorites"]').click();
  await buyer.page.locator(`[data-listing-id="${id}"]`).waitFor();
  assert.equal((await req(admin.context, path)).favorited, false);
  await req(admin.context, path + "/status", "PATCH", { status: "sold" }, 403);
  await req(admin.context, path, "DELETE", {}, 403);
  await p.getByRole("button", { name: "판매글 수정", exact: true }).click();
  await form.locator('[name="title"]').fill(`Edited-${run}`);
  await form.locator('[name="price"]').fill("95000");
  await p.locator("#market-save").click();
  await p
    .locator("#market-detail-content h2", { hasText: `Edited-${run}` })
    .waitFor();
  const own = () => p.locator('#market-detail-content select[aria-label="판매 상태 변경"]');
  await pick(p, own(), "예약중");
  await p.getByRole("button", { name: "상태 저장", exact: true }).click();
  await p.locator("#market-detail-content>.market-status.reserved").waitFor();
  await pick(p, own(), "판매완료");
  await p.getByRole("button", { name: "상태 저장", exact: true }).click();
  await p.locator("#market-detail-content>.market-status.sold").waitFor();
  await p.locator("#market-detail [data-market-close]").click();
  await p.locator("#market-query").fill(`Edited-${run}`);
  await p.locator('#market-filters button[type="submit"]').click();
  await p.locator(`[data-listing-id="${id}"]`).waitFor();
  await pick(p, p.locator('#market-filters [name="status"]'), "판매중");
  await p.locator("#market-list>.empty").waitFor();
  await pick(p, p.locator('#market-filters [name="status"]'), "판매완료");
  await p.locator(`[data-listing-id="${id}"]`).waitFor();
  await p.reload();
  await p.locator(`[data-listing-id="${id}"]`).waitFor();
  assert.equal(
    await p.locator("#market-recent a").first().getAttribute("href"),
    `/parts#listing-${id}`,
  );
  await p.screenshot({ path: "/tmp/revcc-market-desktop.png", fullPage: true });
  const positions = await Promise.all(
    [".market-navigation", ".market-main", ".market-sidebar"].map((selector) =>
      p.locator(selector).boundingBox(),
    ),
  );
  assert.ok(
    positions[0].x + positions[0].width < positions[1].x &&
      positions[1].x + positions[1].width < positions[2].x,
  );
  await buyer.page.goto(base + `/parts#listing-${id}`);
  await buyer.page.locator(".market-contact").waitFor();
  await req(buyer.context, "/api/auth/logout", "POST", {});
  await buyer.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await buyer.page.waitForFunction(
    () =>
      document.querySelector("#market-my-garage")?.dataset.state ===
      "NOT_AUTHENTICATED",
  );
  await buyer.page
    .locator(".market-contact")
    .getByText("연락 방법은 로그인 후 확인할 수 있습니다.")
    .waitFor();
  assert.doesNotMatch(
    await buyer.page.locator("#market-detail-content").innerText(),
    /market-test@example.test/,
  );
  await p.goto(base + `/parts#listing-${id}`);
  await p.getByRole("button", { name: "판매글 삭제", exact: true }).click();
  await p.locator("#confirm-delete").click();
  await p.waitForFunction(() => !location.hash);
  await req(guest, path, "GET", undefined, 404);
  assert.equal(
    (await req(seller.context, "/api/parts/listings?scope=mine")).total,
    0,
  );
  await guestPage.goto(base + `/parts#listing-${id}`);
  await guestPage.reload();
  await guestPage
    .locator("#market-detail-content")
    .getByText("삭제되었거나 없는 매물입니다.")
    .waitFor();
  await guestPage.goto(base + "/parts");
  await guestPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await guestPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS live marketplace: guest/USER/ADMIN, real own garage/empty states, create/photo/own-car input, edit/status/delete, favorites, seller contact visibility and cross-tab logout, ownership, filter/reload/recent/404, three columns and small-screen width, footer",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const ids = accounts.map((a) => a.id);
      if (ids.length) {
        const owners = `SELECT id FROM users WHERE id IN (${ids.join(",")}) AND username LIKE 'market_${run}_%'`;
        sql(
          `BEGIN; DELETE FROM parts_listings WHERE seller_id IN (${owners}); DELETE FROM owner_vehicles WHERE owner_id IN (${owners}); DELETE FROM community_images WHERE owner_id IN (${owners}); DELETE FROM users WHERE id IN (${owners}); COMMIT;`,
        );
      }
      for (const a of accounts)
        await req(a.context, "/api/auth/logout", "POST", {});
    } catch (e) {
      console.error("Cleanup failed:", e);
      process.exitCode = 1;
    }
    await browser?.close();
    console.log("Temporary marketplace accounts/data/sessions cleaned.");
  });
