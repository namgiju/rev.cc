// Real HTTP/Redis/PG + browser; only uniquely named disposable members and posts.
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
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=",
  "base64",
);
let browser;
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
  const guest = await browser.newContext(),
    gp = await guest.newPage();
  await gp.goto(base + "/community#write-post");
  await gp.locator("#editor-login").waitFor();
  assert.equal(await gp.locator("#post-form").isVisible(), false);
  for (const role of ["USER", "ADMIN"]) {
    const context = await browser.newContext({
        viewport: { width: 1536, height: 1024 },
      }),
      credentials = {
        username: `editor_${run}_${role.toLowerCase()}`,
        password: randomUUID(),
      };
    const u = await req(context, "/api/auth/signup", "POST", credentials, 201);
    const a = { context, id: u.id, credentials, role };
    accounts.push(a);
    if (role === "ADMIN")
      sql(`UPDATE users SET role='ADMIN' WHERE id=${a.id};`);
    await req(context, "/api/auth/login", "POST", credentials);
    a.page = await context.newPage();
    a.page.on("pageerror", (e) => errors.push(e.message));
    let creates = 0;
    a.page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        new URL(r.url()).pathname === "/api/board/posts"
      )
        creates++;
    });
    await a.page.goto(base + "/community?category=maintenance#write-post");
    await a.page
      .getByText("등록된 차량이 없습니다.", { exact: true })
      .waitFor();
    assert.equal(
      await a.page.locator("[name=category]").inputValue(),
      "maintenance",
    );
    assert.equal(
      await a.page.locator("#admin-link").isVisible(),
      role === "ADMIN",
    );
    await a.page.locator("#post-title").fill(`empty-garage-${run}-${role}`);
    await a.page.locator("#post-content").fill("차량 없이 작성할 수 있습니다.");
    await a.page.getByRole("button", { name: "등록하기", exact: true }).click();
    await a.page.waitForURL(/\/community\/maintenance\/\d+$/);
    const withoutCar = Number(new URL(a.page.url()).pathname.split("/").pop());
    assert.equal(
      (await req(context, `/api/board/posts/${withoutCar}`)).vehicleId,
      null,
    );
    await a.page.goto(base + "/community?category=maintenance#write-post");
    await a.page
      .getByText("등록된 차량이 없습니다.", { exact: true })
      .waitFor();
    a.car = await req(
      context,
      "/api/garage/vehicles",
      "POST",
      {
        manufacturer: "Test",
        model: `Editor-${run}-${role}`,
        modelYear: 2024,
        licensePlate: "TEST",
      },
      201,
    );
    a.second = await req(
      context,
      "/api/garage/vehicles",
      "POST",
      {
        manufacturer: "Test",
        model: `Second-${run}-${role}`,
        modelYear: 2023,
        licensePlate: "TEST",
      },
      201,
    );
    await a.page.reload();
    await a.page
      .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
      .waitFor();
    assert.equal(await a.page.locator("[name=vehicleId]").inputValue(), "");
    assert.equal(await a.page.locator("[name=vehicleId] option").count(), 3);
    let prompts = 0;
    const dismiss = (d) => {
      prompts++;
      void d.dismiss();
    };
    a.page.on("dialog", dismiss);
    await a.page.getByRole("button", { name: "취소", exact: true }).click();
    await a.page.waitForURL("**/community?category=maintenance");
    assert.equal(prompts, 0);
    a.page.off("dialog", dismiss);
    await a.page.route(
      "**/api/board/garage/mine",
      (r) =>
        r.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"message":"test unavailable"}',
        }),
      { times: 1 },
    );
    await a.page.goto(base + "/community#write-post");
    await a.page
      .getByRole("button", { name: "다시 확인", exact: true })
      .waitFor();
    await a.page.locator("#post-title").fill("재시도에도 유지");
    await a.page
      .getByRole("button", { name: "다시 확인", exact: true })
      .click();
    await a.page
      .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
      .waitFor();
    assert.equal(
      await a.page.locator("#post-title").inputValue(),
      "재시도에도 유지",
    );
    a.page.once("dialog", (d) => d.accept());
    await a.page.getByRole("button", { name: "취소", exact: true }).click();
    await a.page.waitForURL("**/community");
    for (const category of ["free", "maintenance", "parts", "drive"]) {
      await a.page.goto(`${base}/community?category=${category}#write-post`);
      await a.page
        .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
        .waitFor();
      assert.equal(
        await a.page.locator("[name=category]").inputValue(),
        category,
      );
      await a.page.locator("#post-title").fill(`${role}-${category}-${run}`);
      await a.page
        .locator("#post-content")
        .fill("본문 <script>window.BAD=true</script>\n두 번째 줄");
      if (category !== "free") {
        await a.page
          .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
          .click();
        await a.page
          .getByRole("option", {
            name: `Test ${a.car.model} (2024)`,
            exact: true,
          })
          .click();
      }
      if (category === "maintenance") {
        await a.page.locator("#post-images").setInputFiles([
          { name: "one.png", mimeType: "image/png", buffer: png },
          { name: "two.png", mimeType: "image/png", buffer: png },
        ]);
        await a.page.getByText("사진 업로드 완료", { exact: true }).waitFor();
        assert.equal(await a.page.locator("#image-previews img").count(), 2);
        await a.page
          .getByRole("button", { name: "첨부 사진 제거" })
          .first()
          .click();
        assert.equal(await a.page.locator("#image-previews img").count(), 1);
        await a.page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: "instant" }),
        );
        if (role === "USER")
          await a.page.screenshot({
            path: "/tmp/revcc-post-editor-desktop.png",
            fullPage: true,
          });
      }
      const before = creates;
      if (category === "free")
        await a.page.evaluate(() => {
          const f = document.querySelector("#post-form");
          f.requestSubmit();
          f.requestSubmit();
        });
      else
        await a.page
          .getByRole("button", { name: "등록하기", exact: true })
          .click();
      await a.page.waitForURL(new RegExp(`/community/${category}/[0-9]+$`));
      await a.page.locator(".detail-title").waitFor();
      const id = Number(new URL(a.page.url()).pathname.split("/").pop());
      a.post = id;
      assert.equal(creates, before + 1);
      const post = await req(context, `/api/board/posts/${id}`);
      assert.equal(post.authorId, a.id);
      assert.equal(post.vehicleId, category === "free" ? null : a.car.id);
      if (category === "maintenance") {
        assert.equal(post.imageIds.length, 1);
        await a.page
          .locator(".detail-actions")
          .getByRole("button", { name: "수정", exact: true })
          .click();
        await a.page
          .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
          .waitFor();
        assert.equal(await a.page.locator("#image-previews img").count(), 1);
        await a.page
          .getByRole("button", { name: "수정 저장", exact: true })
          .click();
        await a.page.waitForURL(`**/community/maintenance/${id}`);
        assert.deepEqual(
          (await req(context, `/api/board/posts/${id}`)).imageIds,
          post.imageIds,
        );
      }
      assert.equal(await a.page.evaluate(() => window.BAD), undefined);
      if (category !== "free") {
        await a.page
          .getByRole("heading", { name: "이 글에 연결된 차량" })
          .waitFor();
        assert.equal(post.linkedVehicle.model, a.car.model);
      }
    }
    await a.page
      .locator(".detail-actions")
      .getByRole("button", { name: "수정", exact: true })
      .click();
    await a.page
      .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
      .waitFor();
    assert.equal(
      await a.page.locator("[name=vehicleId]").inputValue(),
      String(a.car.id),
    );
    await a.page.reload();
    await a.page
      .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
      .waitFor();
    assert.equal(
      await a.page.locator("[name=vehicleId]").inputValue(),
      String(a.car.id),
    );
    await a.page.locator("#post-title").fill(`edited-${run}-${role}`);
    await a.page
      .getByRole("combobox", { name: "게시판 선택", exact: true })
      .click();
    await a.page
      .getByRole("option", { name: "부품 이야기", exact: true })
      .click();
    await a.page
      .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
      .click();
    await a.page
      .getByRole("option", { name: "연결하지 않음", exact: true })
      .click();
    await a.page
      .getByRole("button", { name: "수정 저장", exact: true })
      .click();
    await a.page.waitForURL(`**/community/parts/${a.post}`);
    assert.equal(
      (await req(context, `/api/board/posts/${a.post}`)).vehicleId,
      null,
    );
    await a.page.goto(base + "/community#write-post");
    await a.page.locator("#post-title").fill("취소 테스트");
    a.page.once("dialog", (d) => d.dismiss());
    await a.page.getByRole("button", { name: "취소", exact: true }).click();
    assert.equal(
      await a.page.locator("#post-title").inputValue(),
      "취소 테스트",
    );
    a.page.once("dialog", (d) => d.accept());
    await a.page.getByRole("button", { name: "취소", exact: true }).click();
    await a.page.waitForURL("**/community");
    assert.equal(await a.page.locator("#site-footer").count(), 1);
  }
  const [user, admin] = accounts;
  for (const a of accounts) {
    const other = a === user ? admin : user;
    const body = {
      title: "forged",
      content: "forged",
      vehicleId: other.car.id,
    };
    await req(a.context, "/api/board/posts", "POST", body, 403);
    await req(a.context, `/api/board/posts/${a.post}`, "PUT", body, 403);
    await req(
      a.context,
      `/api/board/posts/${other.post}`,
      "PUT",
      { title: "forged", content: "forged" },
      403,
    );
  }
  await user.page.goto(base + "/community#write-post");
  await user.page.locator("#post-title").fill("private draft");
  await user.page.locator("#logout").click();
  await user.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await user.page.locator("#editor-login").waitFor();
  assert.equal(await user.page.locator("#post-title").inputValue(), "");
  await admin.page.goto(`${base}/community/parts/${admin.post}#write-post`);
  await admin.page
    .getByRole("combobox", { name: "내 차량 연결 (선택)", exact: true })
    .waitFor();
  await admin.page.locator("#post-title").fill("private edit");
  await req(admin.context, "/api/auth/logout", "POST", {});
  await admin.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await admin.page.locator("#editor-login").waitFor();
  assert.equal(await admin.page.locator("#post-title").inputValue(), "");
  await admin.page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await admin.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS editor: guest gate; USER/ADMIN same editor; no/own/multiple vehicles; 4 categories each; real image upload/remove; canonical create/edit/category change; edit reload; owner API enforcement; plain text XSS; cancel confirmation; logout clearing; NAV/Footer.",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (accounts.length) {
        const owners = `SELECT id FROM users WHERE id IN (${accounts.map((a) => a.id).join(",")}) AND username LIKE 'editor_${run}_%'`;
        sql(
          `BEGIN; DELETE FROM board_posts WHERE author_id IN (${owners}); DELETE FROM owner_vehicles WHERE owner_id IN (${owners}); DELETE FROM community_images WHERE owner_id IN (${owners}); DELETE FROM users WHERE id IN (${owners}); COMMIT;`,
        );
      }
      for (const a of accounts)
        await req(a.context, "/api/auth/logout", "POST", {});
    } catch (e) {
      console.error("Cleanup failed", e);
      process.exitCode = 1;
    }
    await browser?.close();
  });
