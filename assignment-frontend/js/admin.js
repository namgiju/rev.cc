// Spring handles vehicle verification; board-service handles operational lists and report reviews.
const $ = (selector) => document.querySelector(selector);

async function api(path, body, method = "GET") {
  const response = await fetch(path, {
    credentials: "same-origin",
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if ([401, 403].includes(response.status)) {
    $("#admin-app").hidden = true;
    $("#admin-denied").hidden = false;
    $("#review-dialog").close();
    $("#member-dialog").close();
    $("#admin-user").textContent = "";
    renderManagementNav(null);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(data.message || `요청 실패 (${response.status})`),
      {
        status: response.status,
      },
    );
  return data;
}

function coreApiPost(path) {
  return api(path, {}, "POST");
}

function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function statTile(label, value) {
  const tile = el("div", "", "stat-tile");
  const eyebrow = el("p", label, "eyebrow");
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
    const [chipText, chipKind] = verificationStatusChip[item.status] || [
      item.status,
      "pending",
    ];
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
    body.append(
      row([
        item.username,
        item.licensePlate,
        `${item.manufacturer} ${item.model}`,
        String(item.modelYear),
        new Date(item.requestedAt).toLocaleDateString("ko-KR"),
        docLink,
        statusChip(chipText, chipKind),
        actions,
      ]),
    );
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
    if (e.status !== 401) throw e;
    location.replace("/login");
    return;
  }
  renderManagementNav(user);
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

  setupMembers();
  setupTabs();
  setupOperationalLists();
  $("#admin-app").hidden = false;
  await Promise.allSettled([
    refreshOverview(),
    loadList("members"),
    loadList("posts"),
    loadList("reports"),
    loadList("logs"),
    loadBadges(),
    renderVehicleVerifications().catch(() => {
      $("#vehicles-body").replaceChildren(
        row([
          "차량 인증 목록을 불러오지 못했어요.",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]),
      );
    }),
  ]);
}

const categories = {
  free: "자유 이야기",
  maintenance: "정비 / DIY",
  parts: "부품 이야기",
  drive: "드라이브",
};
const reportStatuses = {
  pending: "검토 대기",
  resolved: "처리 완료",
  dismissed: "반려",
};
const listState = Object.fromEntries(
  ["members", "posts", "reports", "logs"].map((name) => [
    name,
    { page: 1, request: 0 },
  ]),
);
const date = (value) =>
  value ? new Date(value).toLocaleString("ko-KR") : "기록 없음";
function postLink(post) {
  const a = el("a", post.title, "text-link");
  a.href = getPostUrl({ id: post.postId ?? post.id, category: post.category });
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}
async function refreshOverview() {
  const root = $("#overview-stats");
  try {
    const [core, board] = await Promise.all([
      api("/api/admin/overview"),
      api("/api/board/admin/overview"),
    ]);
    root.replaceChildren(
      statTile("총 회원 수", core.totalUsers),
      statTile("총 등록 차량 수", core.totalVehicles),
      statTile("게시글 수", board.totalPosts),
      statTile("신고 대기", board.pendingReports),
    );
  } catch (e) {
    root.replaceChildren(el("p", e.message));
  }
}
function setupOperationalLists() {
  for (const name of Object.keys(listState)) {
    const controls = $(`#${name}-controls`),
      search = el("input");
    search.name = "q";
    search.maxLength = 100;
    search.placeholder =
      name === "members" ? "회원 검색" : "제목 / 사용자 검색";
    search.setAttribute("aria-label", search.placeholder);
    controls.append(search);
    if (name === "members") {
      for (const [name, options] of [['field', {username:'아이디',nickname:'닉네임',email:'이메일'}], ['status', {'':'전체 상태',ACTIVE:'정상',SUSPENDED:'정지',DISABLED:'비활성'}]]) {
        const select = el('select'); select.name = name; select.setAttribute('aria-label', name === 'field' ? '검색 항목' : '계정 상태');
        for (const [value,label] of Object.entries(options)) { const option = el('option',label); option.value=value; select.append(option); }
        controls.append(select);
      }
    }
    if (name === "posts" || name === "reports") {
      const select = el("select");
      select.name = name === "posts" ? "category" : "status";
      select.setAttribute(
        "aria-label",
        name === "posts" ? "게시판 필터" : "신고 상태 필터",
      );
      const options = name === "posts" ? categories : reportStatuses;
      for (const [value, label] of Object.entries({ "": "전체", ...options })) {
        const o = el("option", label);
        o.value = value;
        select.append(o);
      }
      controls.append(select);
    }
    const submit = el("button", "검색 / 새로고침", "secondary");
    submit.type = "submit";
    controls.append(submit);
    controls.addEventListener("submit", (e) => {
      e.preventDefault();
      listState[name].page = 1;
      void loadList(name);
    });
    const pager = $(`#${name}-pager`);
    for (const [label, step] of [
      ["이전", -1],
      ["다음", 1],
    ]) {
      const button = el("button", label, "secondary");
      button.dataset.step = step;
      button.addEventListener("click", () => {
        listState[name].page += step;
        void loadList(name);
      });
      pager.append(button);
    }
  }
  $("#overview-refresh").addEventListener("click", refreshOverview);
  $("#badges-refresh").addEventListener("click", loadBadges);
  $("#review-cancel").addEventListener("click", () =>
    $("#review-dialog").close(),
  );
  $("#review-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target,
      b = $("#review-submit");
    if (b.disabled) return;
    b.disabled = true;
    $("#review-error").textContent = "";
    try {
      await api(
        `/api/board/admin/reports/${f.dataset.id}`,
        Object.fromEntries(new FormData(f)),
        "PATCH",
      );
      $("#review-dialog").close();
      await Promise.all([loadList("reports"), refreshOverview()]);
    } catch (error) {
      $("#review-error").textContent = error.message;
    } finally {
      b.disabled = false;
    }
  });
}
async function loadList(name) {
  const state = listState[name],
    request = ++state.request,
    params = new URLSearchParams(new FormData($(`#${name}-controls`)));
  params.set("page", state.page);
  const root = $(`#${name}-body`),
    pager = $(`#${name}-pager`);
  root.replaceChildren(row(["불러오는 중…"]));
  pager.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const result = await api(`${name === "members" ? "/api/admin/members" : `/api/board/admin/${name}`}?${params}`);
    if (request !== state.request) return;
    root.replaceChildren();
    for (const item of result.items) {
      if (name === "members") {
        const open = el('button', item.username, 'secondary'); open.dataset.memberId = item.id; open.addEventListener('click', () => openMember(item.id, open));
        root.append(row([String(item.id),open,item.nickname || '—',item.email || '미등록',date(item.joinedAt),({ACTIVE:'정상',SUSPENDED:'이용 정지',DISABLED:'비활성'})[item.status] || item.status,item.role]));
      }
      else if (name === "posts")
        root.append(
          row([
            postLink(item),
            item.username,
            categories[item.category] || item.category,
            String(item.reportCount),
            date(item.createdAt),
          ]),
        );
      else if (name === 'logs') {
        const source = el('details'), body = el('p', item.original_content, 'detail-text');
        source.append(el('summary', '삭제 당시 원문'), body);
        const reason = el('div'); reason.append(el('p', item.reason), source);
        const action = {POST_DELETE:'게시글', COMMENT_DELETE:'댓글', REPLY_DELETE:'답글'}[item.action_type];
        root.append(row([
          date(item.created_at) + ' · ' + item.admin_username,
          (categories[item.category] || item.category) + ' > ' + item.post_title + ' (#' + item.post_id + ')',
          action + ' #' + item.target_id + ' 삭제 · ' + item.target_author_username,
          reason,
        ]));
      }
      else {
        const details = el("div");
        details.append(el("span", reportStatuses[item.status] || item.status));
        if (item.reviewedAt)
          details.append(
            el(
              "p",
              `${item.reviewer || "삭제된 담당자"} · ${date(item.reviewedAt)}`,
            ),
            el("p", item.resolutionNote),
          );
        const actions = el("div");
        if (item.status === "pending") {
          const button = el("button", "검토", "secondary");
          button.addEventListener("click", () => {
            const f = $("#review-form");
            f.reset();
            f.dataset.id = item.id;
            $("#review-target").textContent = item.title;
            $("#review-error").textContent = "";
            $("#review-dialog").showModal();
          });
          actions.append(button);
        }
        root.append(
          row([postLink(item), item.reporter, item.reason, details, actions]),
        );
      }
    }
    if (!result.items.length) root.append(row(["조회 결과가 없습니다."]));
    $(`#${name}-count`).textContent =
      `총 ${result.total}개 · ${result.page} / ${Math.max(1, Math.ceil(result.total / result.pageSize))} 페이지`;
    pager.querySelector('[data-step="-1"]').disabled = result.page <= 1;
    pager.querySelector('[data-step="1"]').disabled =
      result.page * result.pageSize >= result.total;
  } catch (e) {
    if (request === state.request) {
      root.replaceChildren(
        row([e.message + " 검색 / 새로고침으로 다시 확인해주세요."]),
      );
      $(`#${name}-count`).textContent = "";
    }
  }
}
async function loadBadges() {
  try {
    const badges = await api("/api/board/admin/badges");
    $("#tags-body").replaceChildren(
      ...badges.map((b) => row([b.name, b.description, String(b.holders)])),
    );
  } catch (e) {
    $("#tags-body").replaceChildren(row([e.message]));
  }
}
initialize().catch(() => {
  $("#notice").textContent =
    "관리자 정보를 불러오지 못했어요. 새로고침해주세요.";
});

window.addEventListener("focus", () => {
  if (!$("#admin-app").hidden)
    void api("/api/board/admin/overview").catch(() => {});
});

let selectedMember = null;
let memberBusy = false;
let memberView = 0, memberOpener = null;
async function memberActions(id, view = memberView) {
  const logs = await api(`/api/admin/members/${id}/actions`);
  if (view !== memberView || !$('#member-dialog').open) return;
  $('#member-actions').replaceChildren(...logs.map(l => el('li', `${date(l.createdAt)} · 관리자 #${l.adminId} · ${l.action === 'PASSWORD_RESET_REQUEST' ? '비밀번호 재설정 메일 요청' : l.action.replace('UPDATE:', '회원 정보 변경: ').replace('NICKNAME', '닉네임').replace('EMAIL', '이메일').replace('ROLE', '권한').replace('STATUS', '상태')}`)));
}
async function openMember(id, opener) {
  const view = ++memberView; memberOpener = opener;
  try {
    const item = await api(`/api/admin/members/${id}`);
    if (view !== memberView) return;
    selectedMember = item;
    const f = $('#member-form'); f.reset(); f.elements.nickname.value = item.nickname || ''; f.elements.email.value = item.email || '';
    f.elements.status.value = item.status; f.elements.role.value = item.role;
    if (item.suspendedUntil) { const d = new Date(item.suspendedUntil); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); f.elements.suspendedUntil.value=d.toISOString().slice(0,16); }
    $('#member-title').textContent = `회원 #${item.id} · ${item.username}`;
    $('#member-message').textContent = item.kakaoOnly ? '카카오 전용 계정입니다.' : '';
    $('#member-reset').disabled = !item.email || item.kakaoOnly;
    $('#member-dialog').showModal(); await memberActions(id, view);
  } catch (e) { if (view === memberView) $('#notice').textContent=e.message; }
}
function setupMembers() {
  const dialog = $('#member-dialog');
  let pointerOutside = false;
  const outside = event => {
    const r = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom);
  };
  $('#member-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('pointerdown', event => { pointerOutside = outside(event); });
  dialog.addEventListener('pointercancel', () => { pointerOutside = false; });
  dialog.addEventListener('click', event => { if (pointerOutside && outside(event)) dialog.close(); pointerOutside = false; });
  // Native dialog handles ESC, focus trapping, and backdrop. One close handler cleans every path.
  dialog.addEventListener('close', () => {
    const id = selectedMember?.id;
    const opener = memberOpener?.isConnected ? memberOpener : document.querySelector(`[data-member-id="${id}"]`);
    memberView++; selectedMember = null; memberBusy = false; memberOpener = null; pointerOutside = false;
    $('#member-form').reset(); $('#member-message').textContent = ''; $('#member-actions').replaceChildren();
    dialog.querySelectorAll('button').forEach(b => b.disabled = false); $('#member-reset').disabled = true;
    if (opener?.getClientRects().length) opener.focus();
  });
  const work = async action => {
    if (memberBusy || !selectedMember) return;
    memberBusy=true; const id=selectedMember.id, view=memberView;
    $('#member-dialog').querySelectorAll('button:not(#member-close)').forEach(b => b.disabled=true);
    try { await action(id, view); } catch (e) { if (view === memberView) $('#member-message').textContent=e.message; }
    finally { if (view === memberView) { memberBusy=false; $('#member-dialog').querySelectorAll('button').forEach(b => b.disabled=false); $('#member-reset').disabled=!selectedMember?.email || selectedMember?.kakaoOnly; } }
  };
  $('#member-form').addEventListener('submit', e => {
    e.preventDefault(); void work(async (id, view) => {
      const body=Object.fromEntries(new FormData(e.target));
      body.suspendedUntil=body.status === 'SUSPENDED' && body.suspendedUntil ? new Date(body.suspendedUntil).toISOString() : null;
      const updated=await api(`/api/admin/members/${id}`,body,'PATCH');
      await loadList('members');
      if (view !== memberView) return;
      selectedMember=updated;
      $('#member-message').textContent='저장했습니다. 기존 로그인 세션이 만료되었습니다.';
      await memberActions(id, view);
    });
  });
  $('#member-reset').addEventListener('click', () => void work(async (id, view) => {
    const result=await api(`/api/admin/members/${id}/password-reset`,{},'POST');
    if (view !== memberView) return;
    $('#member-message').textContent=result.message; await memberActions(id, view);
  }));
}
