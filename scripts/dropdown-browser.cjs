// /parts 커스텀 드롭다운 실제 브라우저 검사. 임시 계정/매물은 항상 정리한다.
// 실행: PLAYWRIGHT_MODULE=... CHROME_PATH=... node scripts/dropdown-browser.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"),
  { randomUUID } = require("node:crypto");
const base = process.env.REVCC_URL || "http://localhost:8090",
  run = randomUUID().replaceAll("-", "").slice(0, 10);
const sql = (input) =>
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "revcc", "-d", "revcc", "-At", "-v", "ON_ERROR_STOP=1"],
    { input, encoding: "utf8" },
  ).trim();
let browser, user;
const errors = [];
const dd = (page, scope, n) => page.locator(`${scope} .rev-dd`).nth(n);
const trigger = (page, scope, n) => dd(page, scope, n).locator(".rev-dd-trigger");
const menu = (page, scope, n) => dd(page, scope, n).locator(".rev-dd-menu");
const opened = (page) => page.locator(".rev-dd-menu.is-open").count();

// 화면에 실제로 보이는 네이티브 select가 남았는지 전수 검사한다.
async function nativeAudit(page, label) {
  const leaks = await page.evaluate(() =>
    [...document.querySelectorAll("select")]
      .filter((s) => {
        const r = s.getBoundingClientRect(),
          style = getComputedStyle(s);
        const shown = style.display !== "none" && style.visibility !== "hidden";
        // 숨김 처리된 원본(1px, 투명, 클릭 불가, aria-hidden)만 허용
        const hiddenOriginal =
          s.classList.contains("rev-dd-native") &&
          r.height <= 1 &&
          style.opacity === "0" &&
          style.pointerEvents === "none" &&
          s.getAttribute("aria-hidden") === "true" &&
          !!s.closest(".rev-dd")?.querySelector(":scope > .rev-dd-trigger");
        return shown && !hiddenOriginal && r.width > 0;
      })
      .map((s) => s.name || s.id || "(unnamed)"),
  );
  assert.deepEqual(leaks, [], `${label}: 노출된 네이티브 select`);
}

(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  const credentials = { username: `dd_${run}`, password: randomUUID() };
  const created = await context.request.fetch(base + "/api/auth/signup", { method: "POST", data: credentials });
  assert.equal(created.status(), 201);
  user = await created.json();
  await context.request.fetch(base + "/api/auth/login", { method: "POST", data: credentials });
  const listing = await (
    await context.request.fetch(base + "/api/parts/listings", {
      method: "POST",
      data: {
        title: `DD-${run}`,
        description: "드롭다운 검사",
        price: 1000,
        category: "brakes",
        status: "reserved",
        vehicle: "테스트 차량",
        region: "성남",
        contact: "dd@example.test",
        imageIds: [],
      },
    })
  ).json();

  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await p.goto(base + "/parts?category=brakes&sort=price-low");
  await p.locator(`[data-listing-id="${listing.id}"]`).waitFor();

  // 1. 초기값: URL 쿼리가 커스텀 드롭다운 표시에 반영된다.
  const F = "#market-filters";
  assert.equal(await trigger(p, F, 0).innerText(), "브레이크");
  assert.equal(await trigger(p, F, 1).innerText(), "전체 상태");
  assert.equal(await trigger(p, F, 2).innerText(), "낮은 가격순");
  assert.equal(await p.locator(`${F} .rev-dd`).count(), 3);
  // 지역/적용 차종은 직접 입력 필드로 유지된다.
  assert.equal(await p.locator(`${F} input[name="region"]`).count(), 1);
  assert.equal(await p.locator(`${F} input[name="vehicle"]`).count(), 1);
  await nativeAudit(p, "필터");

  // 2. 열림/닫힘: 클릭, ESC, 바깥 클릭, 다른 드롭다운 열면 기존 것 닫힘
  await trigger(p, F, 1).click();
  assert.equal(await opened(p), 1);
  assert.equal(await trigger(p, F, 1).getAttribute("aria-expanded"), "true");
  const selectedText = await menu(p, F, 1).locator(".is-selected").innerText();
  assert.equal(selectedText, "전체 상태");
  // 트리거 바로 아래에 붙어서 열린다.
  const t = await trigger(p, F, 1).boundingBox(),
    m = await menu(p, F, 1).boundingBox();
  assert.ok(m.y >= t.y + t.height && m.y - (t.y + t.height) <= 8, "메뉴가 입력창 바로 아래");
  assert.ok(Math.abs(m.x - t.x) <= 1, "왼쪽 정렬");
  await p.keyboard.press("Escape");
  assert.equal(await opened(p), 0);
  await trigger(p, F, 1).click();
  await p.mouse.click(700, 900);
  assert.equal(await opened(p), 0, "바깥 클릭으로 닫힘");
  await trigger(p, F, 1).click();
  await trigger(p, F, 2).click();
  assert.equal(await opened(p), 1, "다른 드롭다운을 열면 기존 것이 닫힘");
  assert.ok(await menu(p, F, 2).evaluate((e) => e.classList.contains("is-open")));
  await p.keyboard.press("Escape");

  // 3. 마우스 선택 → change → 기존 필터 로직(requestSubmit, query parameter) 유지
  await trigger(p, F, 1).click();
  await menu(p, F, 1).getByRole("option", { name: "예약중", exact: true }).click();
  await p.waitForFunction(() => location.search.includes("status=reserved"));
  await p.locator(`[data-listing-id="${listing.id}"]`).waitFor();
  assert.equal(await trigger(p, F, 1).innerText(), "예약중");
  assert.equal(await p.locator(`${F} select[name="status"]`).inputValue(), "reserved");

  // 4. 키보드: Enter로 열기, 방향키/Home/End, Enter 선택
  await trigger(p, F, 2).focus();
  await p.keyboard.press("Enter");
  assert.equal(await opened(p), 1);
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => location.search.includes("sort=price-high") || location.search.includes("sort=popular"));
  assert.equal(await opened(p), 0);
  assert.equal(await p.evaluate(() => document.activeElement.className), "rev-dd-trigger", "닫힌 뒤 포커스 복귀");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("End");
  await p.keyboard.press("Home");
  assert.equal(await menu(p, F, 2).locator(".is-active").innerText(), "최신순");
  await p.keyboard.press("Escape");
  await trigger(p, F, 0).focus();
  await p.keyboard.press("Enter");
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => location.search.includes("category=other"));
  assert.equal(await trigger(p, F, 0).innerText(), "기타");
  await p.keyboard.press("Tab");
  assert.equal(await opened(p), 0);

  // 5. 필터 초기화 시 커스텀 표시도 함께 초기화
  await p.getByRole("button", { name: "필터 초기화" }).click();
  await p.waitForFunction(() => !location.search);
  assert.equal(await trigger(p, F, 0).innerText(), "전체 매물");
  assert.equal(await trigger(p, F, 1).innerText(), "전체 상태");
  assert.equal(await trigger(p, F, 2).innerText(), "최신순");

  // 6. 판매글 등록/수정 폼
  await p.locator("#market-new").click();
  const E = "#market-form";
  assert.equal(await p.locator(`${E} .rev-dd`).count(), 3);
  assert.equal(await trigger(p, E, 0).innerText(), "휠 / 타이어");
  assert.equal(await trigger(p, E, 1).innerText(), "판매중");
  assert.equal(await trigger(p, E, 2).innerText(), "직접 입력");
  await nativeAudit(p, "등록 폼");
  await trigger(p, E, 0).click();
  assert.equal(await menu(p, E, 0).locator(".rev-dd-option").count(), 9);
  await p.keyboard.press("Escape");
  assert.equal(await p.locator("#market-editor").evaluate((d) => d.open), true, "ESC는 드롭다운만 닫고 다이얼로그는 유지");
  await trigger(p, E, 0).click();
  await menu(p, E, 0).getByRole("option", { name: "엔진 / 구동계", exact: true }).click();
  assert.equal(await p.locator(`${E} select[name="category"]`).inputValue(), "engine");
  await p.locator("#market-editor .dialog-bar button").click();

  // 7. 상세 → 수정: 저장된 값이 드롭다운에 채워지고, 상태 변경 드롭다운 동작
  await p.goto(base + `/parts#listing-${listing.id}`);
  await p.getByRole("button", { name: "판매글 수정", exact: true }).waitFor();
  await nativeAudit(p, "상세");
  const D = "#market-detail-content";
  assert.equal(await trigger(p, D, 0).innerText(), "예약중");
  assert.equal(await trigger(p, D, 0).getAttribute("aria-label"), "판매 상태 변경");
  await p.getByRole("button", { name: "판매글 수정", exact: true }).click();
  assert.equal(await trigger(p, E, 0).innerText(), "브레이크");
  assert.equal(await trigger(p, E, 1).innerText(), "예약중");
  await nativeAudit(p, "수정 폼");
  await p.locator("#market-editor .dialog-bar button").click();
  // 폼을 새로 열면 reset 값으로 돌아간다.
  await p.locator("#market-detail [data-market-close]").click();
  await p.locator("#market-new").click();
  assert.equal(await trigger(p, E, 0).innerText(), "휠 / 타이어");
  assert.equal(await trigger(p, E, 1).innerText(), "판매중");
  await p.locator("#market-editor .dialog-bar button").click();

  // 8. 화면 아래쪽에서는 위로 뒤집혀 잘리지 않고, 좁은 화면에서도 화면 안에 표시
  await p.setViewportSize({ width: 390, height: 640 });
  await p.goto(base + "/parts");
  await p.locator("#market-filters").waitFor();
  for (const n of [0, 1, 2]) {
    await trigger(p, F, n).scrollIntoViewIfNeeded();
    await trigger(p, F, n).click();
    const box = await menu(p, F, n).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 640, `모바일 ${n} 화면 안`);
    await p.keyboard.press("Escape");
  }
  await p.setViewportSize({ width: 1536, height: 420 });
  await p.locator("#market-new").click();
  await trigger(p, E, 0).scrollIntoViewIfNeeded();
  await trigger(p, E, 0).click();
  const small = await menu(p, E, 0).boundingBox();
  assert.ok(small.y >= 0 && small.y + small.height <= 420, "낮은 화면에서도 메뉴가 잘리지 않음");
  await p.keyboard.press("Escape");
  await p.locator("#market-editor .dialog-bar button").click();
  await nativeAudit(p, "모바일");

  assert.deepEqual(errors, []);
  console.log("PASS dropdown: 필터 3종/등록·수정 3종/상태 변경 1종 전부 커스텀, 네이티브 select 노출 없음, 키보드·바깥클릭·ESC·단일 열림·화면 안 배치");
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (user)
        sql(
          `BEGIN; DELETE FROM parts_listings WHERE seller_id=${user.id}; DELETE FROM users WHERE id=${user.id} AND username='dd_${run}'; COMMIT;`,
        );
    } catch (e) {
      console.error("Cleanup failed:", e);
      process.exitCode = 1;
    }
    await browser?.close();
    console.log("Temporary dropdown account/data cleaned.");
  });
