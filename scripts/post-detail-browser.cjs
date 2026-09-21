// Browser-only fixtures: no test users, vehicles, posts or badges are written to the DB.
// Requires Playwright externally; see docs/POST-DETAIL.md.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const base = process.env.REVCC_URL || "http://localhost:8090";
let browser;
(async () => {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1660, height: 1100 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  global.debugPage = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let user = { id: 2, username: "독자" },
    authorFail = false,
    noVehicle = false,
    deleted = false;
  let post = {
    id: 31,
    title: "아반떼 N 타이어 교체 후기",
    content:
      "주말 주행을 앞두고 타이어를 교체했습니다.\n<script>window.injected=true</script>",
    authorId: 1,
    username: "테스트 오너",
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: null,
    category: "maintenance",
    vehicle: "아반떼 N",
    imageIds: [9],
    views: 12,
    likeCount: 0,
    liked: false,
    bookmarked: false,
    ownerVehicle: "아반떼 N",
  };
  let comments = [];
  let reported = false;
  let mutations = [];
  const vehicle = {
    id: 7,
    model: "아반떼 N",
    year: 2024,
    trim: "DCT",
    manufacturer: "Hyundai",
    nickname: "주말의 N",
    imageId: 9,
    verified: true,
  };
  const member = () => ({
    id: 1,
    username: "테스트 오너",
    joinedAt: null,
    avatarUrl: null,
    postCount: 3,
    commentCount: comments.filter((c) => c.authorId === 1 && !c.deleted).length,
    receivedLikes: post.likeCount,
    vehicles: noVehicle ? [] : [vehicle],
    representativeVehicle: noVehicle ? null : vehicle,
    verified: !noVehicle,
    badges: noVehicle
      ? []
      : [
          {
            code: "verified-owner",
            name: "인증 오너",
            description: "자동차등록증 검토를 통해 보유 차량 인증 완료",
            imageUrl: null,
          },
        ],
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url()),
      p = url.pathname,
      m = req.method();
    let body = {};
    try {
      body = req.postDataJSON() || {};
    } catch {}
    const send = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (p === "/api/board/me")
      return send(user || { message: "login" }, user ? 200 : 401);
    if (p === "/api/board/notifications") return send([]);
    if (p === "/api/board/images/9")
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FoAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    if (p === "/api/board/members/1")
      return send(
        authorFail ? { message: "Unavailable" } : member(),
        authorFail ? 503 : 200,
      );
    if (p === "/api/board/posts")
      return send([
        { ...post, id: 32, title: "같은 차종의 다음 이야기", imageIds: [] },
        post,
      ]);
    if (p === "/api/board/posts/31/view") {
      post.views++;
      return send({ views: post.views });
    }
    if (p === "/api/board/posts/31/comments") {
      if (m === "POST") {
        comments.push({
          id: comments.length + 1,
          content: body.content,
          parentId: body.parentId || null,
          authorId: user.id,
          username: user.username,
          createdAt: new Date().toISOString(),
          deleted: false,
        });
        return send(comments.at(-1), 201);
      }
      return send(comments);
    }
    if (p.startsWith("/api/board/comments/")) {
      const c = comments.find((c) => c.id === Number(p.split("/").pop()));
      c.deleted = true;
      c.content = "삭제된 댓글입니다.";
      return send({ ok: true });
    }
    if (p.endsWith("/like")) {
      post.liked = body.active;
      post.likeCount = body.active ? 1 : 0;
      return send({ ok: true });
    }
    if (p.endsWith("/bookmark")) {
      post.bookmarked = body.active;
      return send({ ok: true });
    }
    if (p.endsWith("/report")) {
      reported = true;
      return send({ id: 1 }, 201);
    }
    if (p === "/api/board/posts/31") {
      if (m === "PUT") {
        mutations.push(m);
        Object.assign(post, body, { updatedAt: new Date().toISOString() });
      }
      if (m === "DELETE") {
        deleted = true;
        mutations.push(m);
        return send({ ok: true });
      }
      return send(deleted ? { message: "없음" } : post, deleted ? 404 : 200);
    }
    return send({ message: "Unexpected " + p }, 404);
  });
  const open = async () => {
    await page.goto(base + "/community/maintenance/31", {
      waitUntil: "networkidle",
    });
    await page.locator("#post-author .author-stats").waitFor();
  };
  await open();
  assert.equal(
    await page.locator("#post-author-badges .author-badge").count(),
    1,
  );
  assert.equal(await page.locator("#post-author .author-badge").count(), 1);
  assert.ok(
    (await page.locator("#post-author").innerText()).includes("기록 없음"),
  );
  assert.equal(
    await page
      .locator('#post-related a[href="/community/maintenance/32"]')
      .count(),
    2,
  );
  const boxes = await Promise.all(
    ["#post-author", "#post-detail-content", "#post-related"].map((s) =>
      page.locator(s).boundingBox(),
    ),
  );
  assert.ok(
    boxes[0].x + boxes[0].width < boxes[1].x &&
      boxes[1].x + boxes[1].width < boxes[2].x,
  );
  assert.equal(boxes[0].width, 270);
  assert.equal(boxes[2].width, 310);
  assert.ok(boxes[1].width >= 800);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator(".detail-gallery img").count(), 1);
  assert.equal(
    await page
      .locator(".detail-actions")
      .getByRole("button", { name: "수정", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "♡ 추천 0", exact: true }).click();
  await page.getByRole("button", { name: "♡ 추천 1", exact: true }).waitFor();
  await page.getByRole("button", { name: "북마크", exact: true }).click();
  await page.getByRole("button", { name: "저장됨", exact: true }).waitFor();
  await page.getByRole("button", { name: "링크 복사", exact: true }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    base + "/community/maintenance/31",
  );
  await page.getByRole("button", { name: "신고", exact: true }).click();
  await page.getByLabel("신고 사유").fill("테스트 신고 사유");
  await page.getByRole("button", { name: "신고 접수" }).click();
  assert.ok(reported);
  await page.locator("#panel-dialog").waitFor({ state: "hidden" });
  await page.getByLabel("댓글 내용").fill("주행 후기가 궁금해요.");
  await page.getByRole("button", { name: "댓글 등록" }).click();
  await page.locator(".comment").first().waitFor();
  await page.getByRole("button", { name: "답글", exact: true }).click();
  await page.getByLabel("댓글 내용").fill("답글 테스트");
  await page.getByRole("button", { name: "댓글 등록" }).click();
  await page.locator(".comment.reply").waitFor();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: "/tmp/revcc-post-detail-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".comment.reply")
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  await page.locator("#confirm-delete").click();
  await page.locator(".comment.reply.deleted").waitFor();
  user = { id: 1, username: "테스트 오너" };
  await open();
  await page
    .locator(".detail-actions")
    .getByRole("button", { name: "수정", exact: true })
    .click();
  await page.locator("#post-title").fill("수정한 타이어 후기");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await page.waitForURL("**/community/maintenance/31");
  await page.getByRole("heading", { name: "수정한 타이어 후기" }).waitFor();
  assert.ok(mutations.includes("PUT"));
  authorFail = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("작성자 정보를 불러오지 못했어요.").waitFor();
  assert.equal(await page.locator(".detail-actions button").count(), 5);
  assert.equal(await page.locator(".comment-form").count(), 1);
  authorFail = false;
  noVehicle = true;
  post.vehicle = "";
  post.ownerVehicle = null;
  await open();
  assert.equal(
    await page.locator("#post-author-badges .author-badge").count(),
    0,
  );
  await page.getByText("연결된 차종이 없어요.").waitFor();
  user = null;
  await open();
  await page.getByRole("button", { name: "♡ 추천 1", exact: true }).click();
  await page
    .locator("#notice")
    .getByText(/로그인 후/)
    .waitFor();
  user = { id: 1, username: "테스트 오너" };
  await open();
  await page
    .locator(".detail-actions")
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  await page.locator("#confirm-cancel").click();
  assert.equal(deleted, false);
  await page
    .locator(".detail-actions")
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  await page.locator("#confirm-delete").click();
  await page.waitForURL("**/community?category=maintenance");
  assert.equal(deleted, true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS browser: three columns, real-shape author fields/badge/empty states, canonical links, text escaping, image, like/bookmark/copy/report, comment/reply/delete, edit/delete/cancel, anonymous gate, sidebar failure isolation. API responses are isolated browser fixtures; no DB writes.",
  );
})()
  .catch(async (e) => {
    console.error(e);
    if (global.debugPage) {
      console.log(await global.debugPage.locator("body").innerText());
      await global.debugPage.screenshot({
        path: "/tmp/revcc-detail-failure.png",
        fullPage: true,
      });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
