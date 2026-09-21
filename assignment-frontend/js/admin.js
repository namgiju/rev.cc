// 관리자 화면. 화면에서 메뉴/버튼을 숨기는 것과 별개로 실제 데이터는
// /api/admin/overview, /api/admin/vehicle-verifications 호출 시 서버(AdminController)가
// role을 다시 검증한다. 차량 인증 관리를 뺀 나머지 패널은 실제 운영 API가 아직 없어
// 예시(MOCK) 데이터로만 구성한다.
const $ = (selector) => document.querySelector(selector);

async function api(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.message || `요청 실패 (${response.status})`), {
      status: response.status,
    });
  return data;
}

async function coreApiPost(path) {
  // nginx가 CSRF 방지를 위해 Content-Type: application/json이 없는 POST를 차단하므로
  // 바디가 없어도 이 헤더와 빈 JSON 바디를 함께 보낸다.
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.message || `요청 실패 (${response.status})`), { status: response.status });
  return data;
}

function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function statTile(label, value, isMock) {
  const tile = el("div", "", "stat-tile");
  const eyebrow = el("p", label + (isMock ? " (예시)" : ""), "eyebrow");
  tile.append(eyebrow, el("strong", String(value)));
  return tile;
}

function statusChip(text, kind) {
  return el("span", text, `status-chip ${kind}`);
}

function row(cells) {
  const tr = document.createElement("tr");
  cells.forEach((cell) => {
    const td = document.createElement("td");
    if (cell instanceof Node) td.append(cell);
    else td.textContent = cell;
    tr.append(td);
  });
  return tr;
}

// 아래 예시 데이터는 실제 회원/게시글이 아니라 화면 구성을 보여주기 위한 샘플이다.
const mockMembers = [
  { username: "avante_owner", role: "USER", joinedAt: "2026-03-02", posts: 12, status: ["활동중", "ok"] },
  { username: "winding_kim", role: "USER", joinedAt: "2026-05-18", posts: 4, status: ["활동중", "ok"] },
  { username: "tuning_master", role: "USER", joinedAt: "2026-06-30", posts: 27, status: ["정지", "blocked"] },
];
const mockPosts = [
  { title: "아반떼 N 서킷 주행기", author: "avante_owner", board: "현대 N", reports: 0, status: ["게시중", "ok"] },
  { title: "타이어 편마모 문의", author: "winding_kim", board: "자유 이야기", reports: 2, status: ["검토 대기", "pending"] },
  { title: "불법 튜닝 부품 판매", author: "tuning_master", board: "부품 이야기", reports: 5, status: ["숨김", "blocked"] },
];
const mockReports = [
  { post: "불법 튜닝 부품 판매", reporter: "avante_owner", reason: "불법 개조 부품 홍보", status: ["대기", "pending"] },
  { post: "타이어 편마모 문의", reporter: "winding_kim", reason: "광고성 댓글", status: ["처리완료", "ok"] },
];
const mockTags = [
  { tag: "오너 인증", kind: "인장", usage: 41, status: ["운영중", "ok"] },
  { tag: "REV '26", kind: "시즌 배지", usage: 12, status: ["운영중", "ok"] },
  { tag: "와인딩", kind: "관심사 태그", usage: 8, status: ["검토 대기", "pending"] },
];

function renderMockTables() {
  $("#members-body").replaceChildren(
    ...mockMembers.map((m) => row([m.username, m.role, m.joinedAt, String(m.posts), statusChip(...m.status)])),
  );
  $("#posts-body").replaceChildren(
    ...mockPosts.map((p) => row([p.title, p.author, p.board, String(p.reports), statusChip(...p.status)])),
  );
  $("#reports-body").replaceChildren(
    ...mockReports.map((r) => row([r.post, r.reporter, r.reason, statusChip(...r.status)])),
  );
  $("#tags-body").replaceChildren(
    ...mockTags.map((t) => row([t.tag, t.kind, String(t.usage), statusChip(...t.status)])),
  );
}

const verificationStatusChip = {
  PENDING: ["검토 중", "pending"],
  APPROVED: ["승인됨", "ok"],
  REJECTED: ["거절됨", "blocked"],
};

async function renderVehicleVerifications() {
  const items = await api("/api/admin/vehicle-verifications");
  const body = $("#vehicles-body");
  body.innerHTML = "";
  if (!items.length) {
    body.append(row(["신청된 인증이 없어요.", "", "", "", "", "", "", ""]));
    return;
  }
  items.forEach((item) => {
    const docLink = el("a", "이미지 보기");
    docLink.href = `/api/garage/vehicle-verifications/${item.id}/document`;
    docLink.target = "_blank";
    docLink.rel = "noopener";
    const [chipText, chipKind] = verificationStatusChip[item.status] || [item.status, "pending"];
    const actions = el("div");
    if (item.status === "PENDING") {
      const approve = el("button", "승인", "secondary");
      approve.type = "button";
      const reject = el("button", "거절", "danger");
      reject.type = "button";
      approve.addEventListener("click", () => decide(item.id, "approve"));
      reject.addEventListener("click", () => decide(item.id, "reject"));
      actions.append(approve, document.createTextNode(" "), reject);
    } else {
      actions.append(el("span", "-"));
    }
    body.append(row([
      item.username, item.licensePlate, `${item.manufacturer} ${item.model}`, String(item.modelYear),
      new Date(item.requestedAt).toLocaleDateString("ko-KR"), docLink, statusChip(chipText, chipKind), actions,
    ]));
  });
}

async function decide(id, action) {
  try {
    await coreApiPost(`/api/admin/vehicle-verifications/${id}/${action}`);
    await renderVehicleVerifications();
  } catch (e) {
    $("#notice").textContent = e.message || "처리하지 못했어요.";
  }
}

function setupTabs() {
  const buttons = [...document.querySelectorAll(".admin-nav button")];
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("active", b === button));
      document.querySelectorAll("[data-panel].admin-panel").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== button.dataset.panel;
      });
    });
  });
}

async function initialize() {
  let user;
  try {
    user = await api("/api/board/me");
  } catch (e) {
    location.replace("/api/auth/kakao/login");
    return;
  }
  if (user.role !== "ADMIN") {
    $("#admin-denied").hidden = false;
    return;
  }
  $("#admin-user").textContent = `${user.username} 님`;
  $("#logout").hidden = false;
  $("#logout").addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } finally {
      location.href = "/";
    }
  });

  const overview = await api("/api/admin/overview");
  $("#overview-stats").replaceChildren(
    statTile("총 회원 수", overview.totalUsers, false),
    statTile("총 등록 차량 수", overview.totalVehicles, false),
    statTile("게시글 수", 143, true),
    statTile("신고 대기", 1, true),
  );
  renderMockTables();
  setupTabs();
  $("#admin-app").hidden = false;
  try {
    await renderVehicleVerifications();
  } catch (e) {
    $("#vehicles-body").replaceChildren(row(["차량 인증 목록을 불러오지 못했어요.", "", "", "", "", "", "", ""]));
  }
}

initialize().catch(() => {
  $("#notice").textContent = "관리자 정보를 불러오지 못했어요.";
});
