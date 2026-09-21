// 로그인한 회원의 홈 화면. 기존 랜딩 화면(js/app.js)과는 별도 스크립트로 두어
// 기존 커뮤니티 화면의 동작을 건드리지 않는다. 세션은 기존 Redis 쿠키를 그대로 재사용한다.
const $ = (selector) => document.querySelector(selector);
const dateText = (value) =>
  new Date(value).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
const dateTimeText = (value) =>
  new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

async function api(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.message || `요청 실패 (${response.status})`), {
      status: response.status,
    });
  return data;
}

function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

// 랜딩 화면의 글/차량 상세로 이동했다가 닫으면 /home으로 돌아오게 표시해 둔다.
function markReturnToHome(link) {
  link.addEventListener("click", () => sessionStorage.setItem("revcc-return-to", "/home"));
  return link;
}

function notify(message) {
  const notice = $("#notice");
  notice.textContent = message;
  setTimeout(() => {
    if (notice.textContent === message) notice.textContent = "";
  }, 7000);
}

function pillEl(text, kind) {
  return el("span", text, kind ? `pill ${kind}` : "pill");
}

const verifiedVehicle = (vehicles) => vehicles.find((v) => v.verified);

// 실제 데이터로 계산되는 태그(차량, 오너 인증, 관리자)와, 아직 취향 태그 기능이 없어
// 예시로만 붙이는 태그(pill-mock)를 명확히 구분한다. 오너 인증 pill은 차량이 있다고
// 붙는 게 아니라 실제로 verified=true인 차량이 있을 때만 붙는다.
function renderTags(user, vehicles) {
  const container = $("#home-tags");
  container.innerHTML = "";
  const verified = verifiedVehicle(vehicles);
  if (vehicles.length) container.append(pillEl(`🚗 ${vehicles[0].nickname || vehicles[0].model}`, "pill-blue"));
  if (verified) container.append(pillEl("✅ 오너 인증", "pill-green"));
  if (user.role === "ADMIN") container.append(pillEl("🛡️ 관리자", "pill-green"));
  container.append(pillEl("⛰️ 와인딩", "pill-mock"));
  container.append(pillEl("🛠️ DIY", "pill-mock"));
}

function renderPosts(posts) {
  const target = $("#home-posts");
  target.innerHTML = "";
  if (!posts.length) {
    target.append(el("p", "아직 등록된 이야기가 없어요.", "empty"));
    return;
  }
  posts.slice(0, 6).forEach((post) => {
    const row = el("div", "", "post-row");
    const titleCell = el("div", "", "post-row-title");
    const link = el("a", post.title);
    // 게시글 상세는 이제 실제 페이지라 뒤로가기가 그냥 동작한다. return-to 표시가 필요 없다.
    link.href = getPostUrl(post);
    titleCell.append(link);
    const authorCell = el("span", post.username, "post-row-author");
    row.append(
      titleCell,
      authorCell,
      el("span", dateText(post.createdAt), "num"),
      el("span", String(post.views), "num"),
      el("span", String(post.likeCount), "num"),
    );
    target.append(row);
  });
}

const statusChip = {
  PENDING: ["오너 인증 검토 중", "pending"],
  APPROVED: ["오너 인증 완료", "ok"],
  REJECTED: ["인증이 승인되지 않았어요", "blocked"],
};

function renderGarage(vehicles) {
  const target = $("#home-garage");
  target.innerHTML = "";
  if (!vehicles.length) {
    target.append(emptyGarageCard());
    return;
  }
  vehicles.forEach((vehicle) => {
    const row = el("div", "", "mini-vehicle-row");
    const top = el("div", "", "mini-vehicle-top");
    const link = markReturnToHome(el("a", `${vehicle.manufacturer} ${vehicle.model} (${vehicle.modelYear})`));
    link.href = `/garage#car-${vehicle.id}`;
    const info = el("div");
    info.append(link, el("small", vehicle.licensePlate || "차량번호 미등록"));
    top.append(info);
    const [chipText, chipKind] = statusChip[vehicle.verificationStatus] || ["오너 인증 전", "pending"];
    top.append(el("span", chipText, `status-chip ${vehicle.verificationStatus ? chipKind : "pending"}`));
    row.append(top);
    if (!vehicle.verificationStatus || vehicle.verificationStatus === "REJECTED") {
      const action = el("div", "", "mini-vehicle-action");
      const button = el("button", vehicle.verificationStatus === "REJECTED" ? "다시 인증 요청" : "오너 인증 요청", "secondary");
      button.type = "button";
      button.addEventListener("click", () => openDocumentStep(vehicle.id));
      action.append(button);
      row.append(action);
    }
    target.append(row);
  });
}

function emptyGarageCard() {
  const wrap = el("div", "", "garage-empty");
  wrap.append(
    el("p", "아직 차고가 비어 있어요."),
    el("p", "내 차를 등록하고 REV.CC 오너 인증을 받아보세요."),
  );
  const button = el("button", "+ 내 차 등록하기", "primary");
  button.type = "button";
  button.addEventListener("click", openRegistration);
  wrap.append(button);
  const list = el("ul");
  ["오너 인증", "내 차고 프로필", "차량 기반 인장/태그", "차량 관련 커뮤니티 기능"].forEach((text) =>
    list.append(el("li", `· ${text}`)),
  );
  wrap.append(list);
  return wrap;
}

const activityText = {
  like: "님이 내 글을 좋아합니다",
  comment: "님이 내 글에 댓글을 남겼어요",
  reply: "님이 내 댓글에 답글을 남겼어요",
};

function renderActivity(notes) {
  const target = $("#home-activity");
  target.innerHTML = "";
  if (!notes.length) {
    target.append(el("p", "최근 활동이 없어요.", "empty"));
    return;
  }
  notes.slice(0, 5).forEach((note) => {
    const row = el("div", "", "mini-activity");
    row.append(el("span", `${note.username}${activityText[note.kind] || "님의 소식이 있어요"} · ${note.title}`));
    row.append(el("small", dateTimeText(note.createdAt)));
    target.append(row);
  });
}

function renderDemoPost(user, vehicles, mine) {
  const target = $("#demo-post");
  target.innerHTML = "";
  if (!mine.length) {
    target.append(el("p", "아직 작성한 글이 없어서 예시로 보여줄 게시글이 없어요.", "empty"));
    return;
  }
  const post = mine[0];
  const head = el("div", "", "demo-post-head");
  const avatar = el("div", user.username.slice(0, 1).toUpperCase(), "avatar");
  const info = el("div");
  const nameRow = el("div", "", "pill-row");
  nameRow.style.marginBottom = "0";
  const strong = el("strong", user.username);
  info.append(strong);
  const tagRow = el("div", "", "pill-row");
  if (vehicles.length) tagRow.append(pillEl(`🚗 ${vehicles[0].nickname || vehicles[0].model}`, "pill-blue"));
  if (verifiedVehicle(vehicles)) tagRow.append(pillEl("✅ 오너 인증", "pill-green"));
  info.append(tagRow);
  head.append(avatar, info);
  target.append(head, el("p", post.content));
}

// api()는 board-service용 헬퍼라 core(Spring)에도 그대로 재사용하되, body가 있는 요청을 위해 별도 헬퍼를 둔다.
async function coreApi(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || (options.body ? "POST" : "GET"),
    credentials: "same-origin",
    ...(options.body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.message || `요청 실패 (${response.status})`), { status: response.status });
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("파일을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

let pendingVehicleId = null;

function openRegistration() {
  pendingVehicleId = null;
  $("#vehicle-dialog-title").textContent = "내 차 등록";
  $("#vehicle-step-info").hidden = false;
  $("#vehicle-step-document").hidden = true;
  $("#vehicle-info-form").reset();
  $("#vehicle-dialog").showModal();
}

function openDocumentStep(vehicleId) {
  pendingVehicleId = vehicleId;
  $("#vehicle-dialog-title").textContent = "오너 인증 신청";
  $("#vehicle-step-info").hidden = true;
  $("#vehicle-step-document").hidden = false;
  $("#vehicle-document-form").reset();
  $("#vehicle-dialog").showModal();
}

document.querySelectorAll("#vehicle-dialog [data-close]").forEach((button) =>
  button.addEventListener("click", () => $("#vehicle-dialog").close()),
);

$("#vehicle-info-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const vehicle = await coreApi("/api/garage/vehicles", {
      body: {
        manufacturer: String(form.get("manufacturer") || "").trim(),
        model: String(form.get("model") || "").trim(),
        modelYear: Number(form.get("modelYear")),
        licensePlate: String(form.get("licensePlate") || "").trim(),
      },
    });
    openDocumentStep(vehicle.id);
  } catch (e) {
    notify(e.message || "차량 등록에 실패했어요.");
  }
});

$("#vehicle-skip-document").addEventListener("click", () => {
  $("#vehicle-dialog").close();
  notify("차량이 등록되었어요. 준비되면 차고에서 오너 인증을 신청해주세요.");
  void initialize();
});

$("#vehicle-document-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("#vehicle-document-input").files[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
    notify("JPG, PNG, WebP 사진을 3MB 이하로 선택해주세요.");
    return;
  }
  try {
    const data = await readFileAsDataUrl(file);
    await coreApi(`/api/garage/vehicles/${pendingVehicleId}/verification`, { body: { data } });
    $("#vehicle-dialog").close();
    notify("오너 인증을 신청했어요. 관리자 검토 후 결과를 알려드릴게요.");
    void initialize();
  } catch (e) {
    notify(e.message || "인증 신청에 실패했어요.");
  }
});

async function initialize() {
  let user;
  try {
    user = await api("/api/board/me");
  } catch (e) {
    location.replace("/api/auth/kakao/login");
    return;
  }
  $("#home-avatar").textContent = user.username.slice(0, 1).toUpperCase();
  $("#home-username").textContent = user.username;
  $("#home-handle").textContent = `@${user.username}`;
  $("#home-role").textContent = user.role === "ADMIN" ? "관리자 계정으로 로그인했어요." : "REV.CC 회원입니다.";
  $("#home-user").textContent = `${user.username} 님`;
  $("#admin-link").hidden = user.role !== "ADMIN";

  const [posts, vehicles, notes, mine] = await Promise.all([
    api("/api/board/posts?limit=6&sort=latest").catch(() => []),
    coreApi("/api/garage/vehicles").catch(() => []),
    api("/api/board/notifications").catch(() => []),
    api("/api/board/posts?scope=mine&sort=latest").catch(() => []),
  ]);
  renderPosts(posts);
  renderGarage(vehicles);
  renderActivity(notes);
  renderTags(user, vehicles);
  renderDemoPost(user, vehicles, mine);

  $("#stat-posts").textContent = String(mine.length);
  $("#stat-comments").textContent = String(mine.reduce((sum, p) => sum + p.commentCount, 0));
  $("#stat-likes").textContent = String(mine.reduce((sum, p) => sum + p.likeCount, 0));
}

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

initialize().catch((e) => notify(e.message || "정보를 불러오지 못했어요."));
