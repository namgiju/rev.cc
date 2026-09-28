const $ = (selector) => document.querySelector(selector);
const labels = {
  free: "자유 이야기",
  maintenance: "정비·관리",
  parts: "부품 이야기",
  drive: "드라이브",
};
const recordLabels = { maintenance: "정비", tuning: "튜닝", parts: "부품" };
const state = {
  user: null,
  authStatus: "CHECKING",
  sessionRequest: 0,
  garageRequest: 0,
  posts: [],
  query: "",
  category: "",
  sort: "latest",
  vehicle: "",
  scope: "",
  page: 1,
  editing: null,
  images: [],
  vehicleEditing: null,
  vehicleImage: null,
  feedRequest: 0,
  detailRequest: 0,
};
const dateText = (value) =>
  new Date(value).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const imageUrl = (id) => `/api/board/images/${Number(id)}`;
async function api(path, body, method) {
  const response = await fetch(path, {
    credentials: "same-origin",
    method: method || (body === undefined ? "GET" : "POST"),
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(data.message || `요청 실패 (${response.status})`),
      { status: response.status },
    );
  return data;
}
function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function on(node, event, handler) {
  // /community, /garage, /parts 등 독립 페이지는 index.html의 일부 요소가 없을 수 있어
  // 없는 요소에 대한 바인딩은 조용히 건너뛴다(전체 스크립트가 죽는 것을 방지).
  if (!node) return null;
  node.addEventListener(event, async (e) => {
    try {
      await handler(e);
    } catch (error) {
      notify(error.message);
    }
  });
  return node;
}
function button(text, action, className = "secondary") {
  const b = el("button", text, className);
  b.type = "button";
  on(b, "click", async () => {
    b.disabled = true;
    try {
      await action();
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
function link(text, href, className = "") {
  const a = el("a", text, className);
  a.href = href;
  return a;
}
function photo(id, alt, className = "") {
  const img = document.createElement("img");
  img.src = imageUrl(id);
  img.alt = alt;
  img.loading = "lazy";
  img.className = className;
  return img;
}
let noticeTimer;
function notify(message) {
  document.querySelectorAll(".dialog-notice").forEach((n) => n.remove());
  const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
  if (dialog) {
    const notice = el("p", message, "dialog-notice");
    notice.setAttribute("role", "status");
    dialog.prepend(notice);
  }
  $("#notice").textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $("#notice").textContent = "";
  }, 7000);
}
function requireLogin() {
  if (state.user) return true;
  notify("로그인 후 이용할 수 있어요. 상단의 로그인 / 가입을 눌러주세요.");
  return false;
}
function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}
function closeDetail() {
  state.detailRequest++;
  $("#detail-dialog").close();
  // /home 등 다른 화면에서 글로 들어온 경우 닫을 때 그 화면으로 돌아간다.
  const returnTo = sessionStorage.getItem("revcc-return-to");
  if (returnTo) {
    sessionStorage.removeItem("revcc-return-to");
    location.href = returnTo;
    return;
  }
  if (/^#(post|car|member)-\d+$/.test(location.hash)) {
    history.replaceState(
      null,
      "",
      location.pathname + location.search + "#community",
    );
  }
}
function closeDialog(dialog) {
  if (dialog.id === "detail-dialog") closeDetail();
  else dialog.close();
}
document
  .querySelectorAll("[data-close]")
  .forEach((b) => on(b, "click", () => closeDialog(b.closest("dialog"))));
on($("#detail-dialog"), "cancel", (e) => {
  e.preventDefault();
  closeDetail();
});
function panel(title) {
  $("#panel-title").textContent = title;
  $("#panel-content").replaceChildren();
  openDialog($("#panel-dialog"));
  return $("#panel-content");
}
function confirmDelete(message) {
  return new Promise((resolve) => {
    const d = $("#confirm-dialog");
    $("#confirm-message").textContent = message;
    const finish = (value) => {
      d.close();
      $("#confirm-delete").onclick = null;
      $("#confirm-cancel").onclick = null;
      d.oncancel = null;
      resolve(value);
    };
    $("#confirm-delete").onclick = () => finish(true);
    $("#confirm-cancel").onclick = () => finish(false);
    d.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    d.showModal();
  });
}
// Only moderation of another member's content requires a reason.
async function requestContentDeletion(path, authorId, message) {
  if (state.user?.id === authorId) {
    if (!(await confirmDelete(message))) return false;
    await api(path, {}, 'DELETE');
    return true;
  }
  return new Promise((resolve) => {
    const dialog = el('dialog', '', 'community-dialog');
    dialog.setAttribute('aria-labelledby', 'moderation-title');
    const title = el('h2', '관리자 콘텐츠 삭제'); title.id = 'moderation-title';
    const form = el('form'), label = el('label', '삭제 사유 (필수)'), input = el('textarea');
    input.name = 'reason'; input.required = true; input.maxLength = 500; input.rows = 4;
    label.append(input);
    const error = el('p', '', 'dialog-notice'); error.setAttribute('role', 'alert'); error.hidden = true;
    const actions = el('div', '', 'form-bottom'), cancel = el('button', '취소', 'secondary'), submit = el('button', '삭제', 'danger');
    cancel.type = 'button'; submit.type = 'submit';
    let busy = false, completed = false;
    dialog.addEventListener('close', () => { dialog.remove(); resolve(completed); });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (busy) return;
      if (!input.value.trim()) { error.hidden = false; error.textContent = '삭제 사유를 입력해주세요.'; input.focus(); return; }
      busy = true; submit.disabled = cancel.disabled = true;
      try {
        await api(path, {reason: input.value.trim()}, 'DELETE');
        completed = true; dialog.close();
      } catch (e) { error.hidden = false; error.textContent = e.message; }
      finally { busy = false; submit.disabled = cancel.disabled = false; }
    });
    actions.append(cancel, submit); form.append(label, error, actions);
    dialog.append(title, el('p', '삭제 사유와 삭제 당시 원문이 운영 로그에 기록됩니다.'), form);
    document.body.append(dialog); dialog.showModal(); input.focus();
  });
}
async function refreshSession() {
  const request = ++state.sessionRequest;
  const previousId = state.user?.id;
  state.authStatus = "CHECKING";
  state.garageRequest++;
  renderGarageState("CHECKING");
  let user = null;
  let authStatus;
  try {
    user = await api("/api/board/me");
    authStatus = "AUTHENTICATED";
  } catch (e) {
    authStatus = e.status === 401 ? "NOT_AUTHENTICATED" : "ERROR";
    if (request !== state.sessionRequest) return;
    if (e.status !== 401)
      notify("로그인 상태를 확인하지 못했어요. 새로고침해주세요.");
  }
  if (request !== state.sessionRequest) return;
  state.user = user;
  renderManagementNav(user);
  state.authStatus = authStatus;
  void window.communityList?.garage();
  if (previousId !== user?.id || !user) {
    state.detailRequest++;
    document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    $("#detail-content")?.replaceChildren();
    $("#panel-content")?.replaceChildren();
    state.vehicleEditing = null;
    state.vehicleImage = null;
    $("#vehicle-form")?.reset();
  }
  if (!user) renderGarageState(authStatus);
  $("#core-user").textContent = user ? `${user.username} 님` : "";
  for (const id of ["logout", "activity-button", "notifications-button"])
    $("#" + id).hidden = !user;
  $("#kakao-login").hidden = !!user;
  // 홈(`/`)에만 있는 Hero CTA: 로그인 상태면 글쓰기로, 아니면 로그인으로 보낸다.
  const heroCta = $("#hero-cta-primary");
  if (heroCta) heroCta.href = user ? "/community#write-post" : "/login";
  // #write-post가 없는 페이지(/garage, /parts)에서는 이 요소가 없다.
  const boardUser = $("#board-user");
  if (boardUser)
    boardUser.textContent = user
      ? `${user.username} 님, 오늘의 이야기를 남겨주세요.`
      : "이야기를 쓰려면 먼저 로그인해주세요.";
  if (user) await refreshNotificationCount().catch(() => {});
  else $("#notification-count").textContent = "";
  window.partsMarket?.sessionChanged();
  window.postEditor?.sessionChanged();
}
async function refreshNotificationCount() {
  if (!state.user) return;
  const notes = await api("/api/board/notifications");
  const n = notes.filter((x) => !x.isRead).length;
  $("#notification-count").textContent = n ? String(n) : "";
}
function memberLink(id, name) {
  return link(name, `#member-${id}`, "owner-link");
}
function renderPost(post) {
  const article = el("article", "", "post"),
    body = el("div", "", "post-body");
  body.append(
    el("span", labels[post.category] || "자유 이야기", "post-category"),
  );
  const title = el("h3");
  title.append(link(post.title, getPostUrl(post)));
  body.append(title, el("p", post.content));
  const meta = el("small");
  meta.append(
    memberLink(post.authorId, post.username),
    document.createTextNode(
      ` · ${post.ownerVehicle || "오너"} · ${dateText(post.createdAt)}`,
    ),
  );
  body.append(meta);
  const stats = el("div", "", "post-stats");
  stats.append(
    el("span", `♡ ${post.likeCount}`),
    el("span", `댓글 ${post.commentCount}`),
    el("span", `조회 ${post.views}`),
  );
  if (post.vehicle) stats.append(el("span", post.vehicle));
  if (post.bookmarked) stats.append(el("span", "저장됨"));
  body.append(stats);
  article.append(body);
  if (post.imageIds?.length) {
    const a = link("", getPostUrl(post));
    a.append(photo(post.imageIds[0], `${post.title} 첨부 사진`, "post-thumb"));
    article.append(a);
  }
  return article;
}
async function refreshPosts(append = false) {
  // 게시글 상세가 페이지로 분리된 뒤 홈(`/`)에는 이 목록 UI 자체가 없다. "내가 쓴 글" 같은
  // 활동 버튼은 어느 페이지에서나 누를 수 있어 여기서 조용히 멈춘다(크래시 방지).
  if (!$("#posts")) return;
  window.communityList?.sync();
  const request = ++state.feedRequest;
  if (window.communityList?.isList() && state.scope && !state.user) {
    state.posts = [];
    $("#posts").replaceChildren(el("p", "내 활동을 보려면 로그인이 필요합니다.", "empty"),
      link("로그인하기", "/login", "text-link"));
    $("#load-more").hidden = true;
    $("#activity-scope").hidden = true;
    $("#search-summary").textContent = "";
    return;
  }
  const page = append ? state.page + 1 : 1;
  const query = new URLSearchParams({
    q: state.query,
    category: state.category,
    sort: state.sort,
    vehicle: state.vehicle,
    scope: state.scope,
    page,
    limit: 20,
  });
  $("#load-more").disabled = true;
  try {
    const posts = await api("/api/board/posts?" + query);
    if (request !== state.feedRequest) return;
    state.page = page;
    state.posts = append ? [...state.posts, ...posts] : posts;
    $("#posts").replaceChildren(...state.posts.map(window.communityList?.isList() ? window.communityList.row : renderPost));
    if (!state.posts.length)
      $("#posts").append(
        el(
          "p",
          state.query || state.category || state.scope || state.vehicle
            ? "조건에 맞는 이야기가 없어요. 필터를 바꿔보세요."
            : "아직 이야기가 없어요. 첫 자동차 이야기를 남겨주세요.",
          "empty",
        ),
      );
    $("#load-more").hidden = posts.length < 20;
    $("#search-summary").textContent = state.query
      ? `“${state.query}” 검색 · ${state.posts.length}개 표시`
      : "";
    $("#activity-scope").hidden = !state.scope;
    $("#scope-label").textContent =
      { mine: "내가 쓴 글", bookmarks: "저장한 글", commented: "댓글 남긴 글" }[
        state.scope
      ] || "";
  } finally {
    if (request === state.feedRequest) $("#load-more").disabled = false;
  }
}
async function search(query, scroll = true) {
  state.query = query.trim();
  $("#search-input").value = state.query;
  await refreshPosts();
  if (scroll) $("#community").scrollIntoView({ behavior: "smooth" });
}
on($("#search-form"), "submit", (e) => {
  e.preventDefault();
  return search($("#search-input").value);
});
on($("#search-input"), "search", () => search($("#search-input").value, false));
document
  .querySelectorAll("[data-query]")
  .forEach((b) => on(b, "click", () => search(b.dataset.query)));
document.querySelectorAll("[data-category]").forEach((b) =>
  on(b, "click", async () => {
    if (window.postEditor?.active()) {
      window.postEditor.navigate(`/community?category=${b.dataset.category}`);
      return;
    }
    state.category = b.dataset.category;
    document.querySelectorAll("[data-category]").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    // 카테고리를 URL에도 반영해 새로고침·공유 시 같은 필터가 유지되게 한다.
    const url = new URL(location.href);
    if (b.dataset.category) url.searchParams.set("category", b.dataset.category);
    else url.searchParams.delete("category");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    await refreshPosts();
  }),
);
on($("#post-sort"), "change", () => {
  state.sort = $("#post-sort").value;
  return refreshPosts();
});
on($("#apply-filter"), "click", () => {
  state.vehicle = $("#vehicle-filter").value.trim();
  return refreshPosts();
});
on($("#vehicle-filter"), "keydown", (e) => {
  if (e.key === "Enter") {
    $("#apply-filter").click();
  }
});
on($("#reset-filter"), "click", async () => {
  state.query = "";
  state.category = "";
  state.vehicle = "";
  state.sort = "latest";
  state.scope = "";
  $("#search-input").value = "";
  $("#vehicle-filter").value = "";
  $("#post-sort").value = "latest";
  document
    .querySelectorAll("[data-category]")
    .forEach((b) => b.classList.toggle("active", b.dataset.category === ""));
  await refreshPosts();
});
on($("#load-more"), "click", () => refreshPosts(true));
on($("#clear-scope"), "click", () => {
  state.scope = "";
  return refreshPosts();
});
on($("#logout"), "click", async () => {
  await api("/api/auth/logout", {});
  state.scope = "";
  state.images = [];
  state.vehicleImage = null;
  state.garageRequest++;
  state.detailRequest++;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  await refreshSession();
  await refreshGarage();
  await refreshPosts();
  notify("로그아웃되었습니다.");
});

async function uploadFile(file) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 3 * 1024 * 1024
  )
    throw new Error("JPG, PNG, WebP 사진을 장당 3MB 이하로 선택해주세요.");
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("사진을 읽지 못했어요."));
    r.readAsDataURL(file);
  });
  return (await api("/api/board/images", { data })).id;
}
function renderPreviews(ids, target, remove) {
  target.replaceChildren(
    ...ids.map((id) => {
      const box = el("div", "", "image-preview");
      const b = button("✕", () => remove(id), "");
      b.setAttribute("aria-label", "첨부 사진 제거");
      box.append(photo(id, "첨부 사진 미리보기"), b);
      return box;
    }),
  );
}
function beginEdit(post) {
  return window.postEditor?.edit(post);
}
const viewed = new Set();
// 게시글 상세는 더 이상 #detail-dialog 모달이 아니라 /community/{category}/{id} 페이지에
// 그대로 렌더링한다(car·member는 여전히 모달을 쓴다). 렌더링 내용(본문·댓글·좋아요·북마크·
// 수정·삭제)은 예전 openPost()와 동일하며 대상 컨테이너만 바뀐 것이다.
function parsePostDetailPath() {
  const match = /^\/community\/(free|maintenance|parts|drive)\/([0-9]+)$/.exec(location.pathname);
  return match ? { category: match[1], id: Number(match[2]) } : null;
}
async function showPostDetailPage(id) {
  const wrap = $("#post-detail"),
    root = $("#post-detail-content");
  if (!wrap || !root) return;
  $("#community")?.setAttribute("hidden", "");
  $("#write-post")?.setAttribute("hidden", "");
  wrap.hidden = false;
  $("#main").classList.add("post-detail-wide");
  const contextRequest = resetPostContext();
  root.replaceChildren(el("p", "이야기를 불러오고 있어요.", "empty"));
  let post, comments;
  try {
    [post, comments] = await Promise.all([
      api(`/api/board/posts/${id}`),
      api(`/api/board/posts/${id}/comments`),
    ]);
  } catch (e) {
    if (contextRequest !== postContextRequest) return;
    if (e.status === 404) window.communityList?.forget(id);
    $("#post-author").replaceChildren();
    $("#post-related").replaceChildren();
    root.replaceChildren(
      el(
        "p",
        e.status === 404 ? "삭제되었거나 없는 이야기예요." : "이야기를 불러오지 못했어요.",
        "empty",
      ),
    );
    return;
  }
  if (contextRequest !== postContextRequest) return;
  // URL의 category 세그먼트가 실제 글의 category와 다르면(오래된 링크, 카테고리 변경 등)
  // 에러 대신 정확한 canonical 주소로 조용히 교정한다.
  const canonical = getPostUrl(post);
  if (canonical !== location.pathname) history.replaceState(null, "", canonical + location.search);
  if (!viewed.has(id)) {
    try {
      const v = await api(`/api/board/posts/${id}/view`, {});
      post.views = v.views;
      viewed.add(id);
    } catch {}
  }
  if (contextRequest !== postContextRequest) return;
  renderPostDetail(root, post, comments, id);
  window.communityList?.remember(post);
  void renderPostContext(post, contextRequest);
}
function renderPostDetail(root, post, comments, id) {
  root.replaceChildren(
    el("span", labels[post.category], "post-category"),
    el("h2", post.title, "detail-title"),
  );
  const meta = el("div", "", "detail-meta");
  meta.append(
    memberLink(post.authorId, post.username),
    el("span", post.ownerVehicle || ""),
    el("span", dateText(post.createdAt)),
    el("span", `조회 ${post.views}`),
  );
  if (post.updatedAt) meta.append(el("span", "수정됨"));
  if (post.vehicle) meta.append(el("span", post.vehicle));
  root.append(meta, el("p", post.content, "detail-text"));
  const gallery = el("div", "", "detail-gallery");
  post.imageIds.forEach((image) =>
    gallery.append(photo(image, `${post.title} 사진`)),
  );
  root.append(gallery);
  const actions = el("div", "", "detail-actions");
  for (const [kind, label, active] of [
    ["like", `♡ 추천 ${post.likeCount}`, post.liked],
    ["bookmark", post.bookmarked ? "저장됨" : "북마크", post.bookmarked],
  ]) {
    const b = button(
      label,
      async () => {
        if (!requireLogin()) return;
        await api(`/api/board/posts/${id}/${kind}`, { active: !active }, "PUT");
        await showPostDetailPage(id);
        await refreshPosts();
      },
      "",
    );
    b.setAttribute("aria-pressed", String(active));
    actions.append(b);
  }
  actions.append(
    button(
      "링크 복사",
      async () => {
        await navigator.clipboard.writeText(location.origin + getPostUrl(post));
        notify("글 링크를 복사했어요.");
      },
      "",
    ),
  );
  if (state.user?.id === post.authorId) actions.append(button("수정", () => beginEdit(post), ""));
  if (state.user?.id === post.authorId || state.user?.role === "ADMIN") {
    actions.append(
      button(
        "삭제",
        async () => {
          if (!(await requestContentDeletion(`/api/board/posts/${id}`, post.authorId, "게시글과 댓글을 함께 삭제합니다."))) return;
          // 상세는 이제 페이지라 닫을 모달이 없다. 글이 있던 카테고리 목록으로 돌아간다.
          location.href = `/community?category=${encodeURIComponent(post.category)}`;
        },
        "danger-text",
      ),
    );
  }
  if (state.user?.id !== post.authorId) actions.append(button("신고", () => openReport(id), ""));
  root.append(actions);
  const badges = el("section", "", "author-badges");
  badges.id = "post-author-badges";
  badges.setAttribute("aria-label", "작성자의 인장");
  badges.append(el("h3", "작성자의 인장"), el("p", "인장을 불러오고 있어요.", "context-muted"));
  root.append(badges);
  root.append(el("h3", `댓글 ${comments.filter((c) => !c.deleted).length}`));
  const list = el("div");
  const form = el("form", "", "comment-form"),
    replyLabel = el("div", "", "reply-label");
  replyLabel.hidden = true;
  let parentId = null;
  const input = document.createElement("textarea");
  input.required = true;
  input.maxLength = 2000;
  input.rows = 3;
  input.placeholder = state.user
    ? "서로를 배려하는 댓글을 남겨주세요."
    : "로그인 후 댓글을 남길 수 있어요.";
  input.setAttribute("aria-label", "댓글 내용");
  const submit = el("button", "댓글 등록", "primary");
  submit.type = "submit";
  const replyTo = (comment) => {
    if (!requireLogin()) return;
    parentId = comment.id;
    replyLabel.replaceChildren(
      el("span", `${comment.username} 님에게 답글 `),
      button(
        "취소",
        () => {
          parentId = null;
          replyLabel.hidden = true;
        },
        "text-link",
      ),
    );
    replyLabel.hidden = false;
    input.focus();
  };
  const commentNode = (c) => {
    const item = el(
        "article",
        "",
        `comment${c.parentId ? " reply" : ""}${c.deleted ? " deleted" : ""}`,
      ),
      m = el("div", "", "comment-meta");
    m.append(
      memberLink(c.authorId, c.username),
      el("span", dateText(c.createdAt)),
    );
    if (!c.deleted && !c.parentId)
      m.append(button("답글", () => replyTo(c), "text-link"));
    if (!c.deleted && (state.user?.id === c.authorId || state.user?.role === "ADMIN"))
      m.append(
        button(
          "삭제",
          async () => {
            if (!(await requestContentDeletion(`/api/board/comments/${c.id}`, c.authorId, "이 댓글을 삭제할까요?"))) return;
            await showPostDetailPage(id);
            await refreshPosts();
          },
          "danger-text",
        ),
      );
    item.append(m, el("p", c.content));
    return item;
  };
  comments
    .filter((c) => !c.parentId)
    .forEach((c) => {
      list.append(commentNode(c));
      comments
        .filter((reply) => reply.parentId === c.id)
        .forEach((reply) => list.append(commentNode(reply)));
    });
  if (!comments.length) list.append(el("p", "첫 댓글을 남겨보세요.", "empty"));
  form.append(replyLabel, input, submit);
  on(form, "submit", async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    submit.disabled = true;
    try {
      await api(`/api/board/posts/${id}/comments`, {
        content: input.value,
        parentId,
      });
      await showPostDetailPage(id);
      await refreshPosts();
    } finally {
      submit.disabled = false;
    }
  });
  root.append(form, list);
}
function openReport(id) {
  if (!requireLogin()) return;
  const root = panel("게시글 신고"),
    form = el("form", "", "report-form"),
    label = el("label", "신고 사유"),
    input = document.createElement("textarea");
  input.required = true;
  input.maxLength = 500;
  input.rows = 4;
  input.placeholder = "스팸, 욕설, 허위 정보 등 신고 이유를 적어주세요.";
  label.append(input);
  const b = el("button", "신고 접수", "primary");
  b.type = "submit";
  form.append(
    label,
    el("p", "신고 내역은 내 활동에서 확인할 수 있습니다.", "empty"),
    b,
  );
  on(form, "submit", async (e) => {
    e.preventDefault();
    b.disabled = true;
    try {
      await api(`/api/board/posts/${id}/report`, { reason: input.value });
      $("#panel-dialog").close();
      notify("신고를 접수했어요.");
    } finally {
      b.disabled = false;
    }
  });
  root.append(form);
}
async function showScope(scope) {
  if (!requireLogin()) return;
  if (!$("#posts") || parsePostDetailPath()) { location.href = `/community?scope=${encodeURIComponent(scope)}`; return; }
  state.scope = scope;
  state.query = "";
  state.category = "";
  state.vehicle = "";
  $("#search-input").value = "";
  $("#vehicle-filter").value = "";
  document
    .querySelectorAll("[data-category]")
    .forEach((b) => b.classList.toggle("active", b.dataset.category === ""));
  $("#panel-dialog").close();
  closeDetail();
  await refreshPosts();
  location.hash = "community";
}
on($("#activity-button"), "click", () => {
  if (!requireLogin()) return;
  const root = panel(`${state.user.username} 님의 활동`),
    actions = el("div", "", "activity-actions");
  for (const [scope, label] of [
    ["mine", "내가 쓴 글"],
    ["commented", "댓글 남긴 글"],
    ["bookmarks", "저장한 글"],
  ])
    actions.append(button(label, () => showScope(scope), ""));
  actions.append(
    button(
      "내 차고",
      () => {
        $("#panel-dialog").close();
        location.href = "/home";
      },
      "",
    ),
    button("내 신고 내역", openReports, ""),
  );
  root.append(actions);
});
// 홈(`/`)의 Quick Action "내 활동" 카드는 새 화면을 만들지 않고 헤더의 같은 버튼을 그대로 누른다.
on($("#quick-action-activity"), "click", () => $("#activity-button")?.click());
async function openReports() {
  const root = panel("내 신고 내역");
  const reports = await api("/api/board/reports");
  if (!reports.length) root.append(el("p", "접수한 신고가 없습니다.", "empty"));
  reports.forEach((r) => {
    const row = el("div", "", "notification");
    row.append(
      link(r.title, getPostUrl({ id: r.postId, category: r.category })),
      el("p", r.reason),
      el(
        "small",
        `${({pending:"접수됨",resolved:"처리 완료",dismissed:"반려"})[r.status] || r.status} · ${dateText(r.createdAt)}`,
      ),
    );
    root.append(row);
  });
}
on($("#notifications-button"), "click", async () => {
  if (!requireLogin()) return;
  const root = panel("알림");
  const notes = await api("/api/board/notifications");
  if (!notes.length)
    root.append(
      el(
        "p",
        "아직 새 알림이 없어요. 내 글이나 댓글에 답변이 달리면 알려드릴게요.",
        "empty",
      ),
    );
  notes.forEach((n) => {
    const row = el("div", "", `notification${n.isRead ? "" : " unread"}`);
    row.append(
      link(
        `${n.username} 님이 댓글을 남겼어요 · ${n.title}`,
        getPostUrl({ id: n.postId, category: n.category }),
      ),
      el("small", dateText(n.createdAt)),
    );
    root.append(row);
  });
  await api("/api/board/notifications/read", {}, "PUT");
  $("#notification-count").textContent = "";
});

function vehicleCard(v) {
  const card = link("", `#car-${v.id}`, "vehicle");
  if (v.imageId) card.append(photo(v.imageId, v.model, "vehicle-photo"));
  else card.append(el("div", "", "vehicle-icon"));
  card.append(
    el("strong", v.model),
    el("small", `${v.year}년 · ${v.trim || "오너 차량"}`),
    el("span", `${v.username} · 기록 ${v.recordCount ?? 0}개`, "vehicle-owner"),
  );
  return card;
}
const isMyGaragePage = () => /^\/garage(?:\/index\.html|\/)?$/.test(location.pathname);
function renderGarageState(status, vehicles = []) {
  const root = $("#vehicles");
  if (!root) return;
  root.dataset.state = status;
  root.replaceChildren();
  $("#add-vehicle").hidden = !["EMPTY_GARAGE", "HAS_VEHICLE"].includes(status);
  if (status === "NOT_AUTHENTICATED") {
    root.append(el("p", "내 차고를 이용하려면 로그인이 필요해요.", "empty"),
      link("로그인하기", "/login", "primary"));
  } else if (status === "EMPTY_GARAGE") {
    root.append(el("p", "아직 등록된 차량이 없어요. 첫 차량을 등록해보세요.", "empty"),
      button("내 차 등록", () => vehicleForm(), "primary"),
      link("차량 등록·인증 안내", "/home", "text-link"));
  } else if (status === "HAS_VEHICLE") {
    root.append(...vehicles.map((v) => {
      const item = el("div", "", "my-vehicle");
      const card = vehicleCard(v);
      card.append(el("span", v.verified ? "오너 인증 완료" :
        ({PENDING: "오너 인증 검토 중", REJECTED: "오너 인증 반려"}[v.verificationStatus] || "오너 인증 전")));
      item.append(card, button("차량 수정", () => vehicleForm(v)),
        link("차량·기록 관리", `#car-${v.id}`, "text-link"),
        link("차량 인증 관리", "/home", "text-link"));
      return item;
    }));
  } else if (status === "ERROR") {
    root.append(el("p", "차고 정보를 확인하지 못했어요. 다시 시도해주세요.", "empty"),
      button("다시 시도", refreshMyGarageSession));
  } else {
    root.append(el("p", "로그인 및 차고 정보를 확인하고 있어요.", "empty"));
  }
}
async function refreshGarage() {
  if (!$("#vehicles")) return;
  if (state.authStatus !== "AUTHENTICATED") {
    renderGarageState(state.authStatus);
    return;
  }
  const request = ++state.garageRequest;
  const userId = state.user.id;
  renderGarageState("LOADING");
  try {
    const vehicles = await api("/api/board/garage/mine");
    if (request !== state.garageRequest || state.user?.id !== userId) return;
    renderGarageState(vehicles.length ? "HAS_VEHICLE" : "EMPTY_GARAGE", vehicles);
  } catch (error) {
    if (request !== state.garageRequest) return;
    if (error.status === 401) {
      await refreshSession();
      if (state.authStatus === "AUTHENTICATED") renderGarageState("ERROR");
    } else renderGarageState("ERROR");
  }
}
async function refreshMyGarageSession() {
  await refreshSession();
  await refreshGarage();
}

const {vehicleForm, openCar} = createVehicleUI({$, state, api, el, on, button, photo, memberLink, requireLogin, openDialog, closeDetail, confirmDelete, uploadFile, renderPreviews, refreshGarage, isMyGaragePage, recordLabels});
async function openMember(id) {
  const request = ++state.detailRequest,
    root = $("#detail-content");
  root.replaceChildren(el("p", "오너 정보를 불러오고 있어요.", "empty"));
  openDialog($("#detail-dialog"));
  const [member, vehicles] = await Promise.all([
    api(`/api/board/members/${id}`),
    api(`/api/board/garage?owner=${id}`),
  ]);
  if (request !== state.detailRequest) return;
  root.replaceChildren(
    el("h2", `${member.username} 님의 차고`, "detail-title"),
  );
  const grid = el("div", "", "garage-cards");
  grid.append(...vehicles.map(vehicleCard));
  if (!vehicles.length)
    grid.append(el("p", "아직 등록한 차량이 없어요.", "empty"));
  root.append(grid);
  const guestbook=el("section", "", "member-guestbook");root.append(guestbook);
  void renderGuestbook(guestbook,id,{current:()=>request===state.detailRequest && guestbook.isConnected});
  if (state.user?.id === id)
    root.append(button("내 차 등록", () => vehicleForm()));
  root.append(el("h3", "최근 작성한 이야기"));
  if (!member.posts.length)
    root.append(el("p", "아직 작성한 이야기가 없어요.", "empty"));
  member.posts.forEach((p) => root.append(renderPost(p)));
}
let partsRequest = 0;
on($("#vehicle-select"), "change", async (e) => {
  const request = ++partsRequest;
  $("#parts").replaceChildren();
  if (!e.target.value) return;
  const data = await api(
    `/api/parts/compatibility?vehicleId=${encodeURIComponent(e.target.value)}`,
  );
  if (request === partsRequest)
    $("#parts").replaceChildren(...data.parts.map((p) => el("li", p.name)));
});
async function loadCompatibility() {
  const vehicles = await api("/api/vehicles");
  vehicles.forEach((v) => {
    const o = el("option", `${v.brand} ${v.model}`);
    o.value = v.id;
    $("#vehicle-select").append(o);
  });
}
async function route() {
  if (location.hash === "#write-post" && ["/", "/index.html"].includes(location.pathname)) {
    location.replace("/community#write-post");
    return;
  }
  if (await window.postEditor?.route()) return;
  if (isMyGaragePage() && state.authStatus !== "AUTHENTICATED") return;
  const match = /^#(post|car|member)-(\d+)$/.exec(location.hash);
  // 예전 /#post-123 링크(북마크·공유된 링크 등) 호환: 글을 조회해 category를 알아낸 뒤
  // 새 canonical 주소로 옮겨준다. 모달을 열지 않는다.
  if (match && match[1] === "post") {
    try {
      const post = await api(`/api/board/posts/${match[2]}`);
      location.replace(getPostUrl(post));
    } catch (e) {
      notify(e.message || "이야기를 찾을 수 없어요.");
    }
    return;
  }
  // /parts 등 detail-dialog가 없는 페이지에서는 car·member 해시 라우팅을 하지 않는다.
  const dialog = $("#detail-dialog");
  if (!dialog) return;
  if (!match) {
    if (dialog.open) closeDetail();
    return;
  }
  $("#panel-dialog")?.close();
  try {
    await { car: openCar, member: openMember }[match[1]](Number(match[2]));
    $("#detail-dialog").scrollTop = 0;
  } catch (e) {
    $("#detail-content").replaceChildren(el("p", e.message, "empty"));
  }
}
on(window, "hashchange", route);
on(window, "focus", async () => {
  if (window.postEditor?.active()) await refreshSession();
  else if (window.partsMarket?.active()) await refreshSession();
  else if (window.communityList?.isList()) { await refreshSession(); if(state.scope) await refreshPosts(); }
  else if (isMyGaragePage()) await refreshMyGarageSession();
  else if (state.user) await refreshNotificationCount();
});
on(window, "pageshow", async (event) => {
  if (event.persisted && window.postEditor?.active()) await refreshSession();
  else if (event.persisted && window.partsMarket?.active()) { await refreshSession(); await window.partsMarket.start(); }
  else if (event.persisted && window.communityList?.isList()) { await refreshSession(); await refreshPosts(); }
  else if (event.persisted && isMyGaragePage()) await refreshMyGarageSession();
});
function applyInitialCategory() {
  // /community?category=free 같은 딥링크를 초기 진입 시 반영한다. #community가
  // 없는 페이지(/garage, /parts)에서는 해당 없음.
  const category = new URLSearchParams(location.search).get("category");
  if (!category) return;
  const tab = document.querySelector(`[data-category="${CSS.escape(category)}"]`);
  if (!tab) return;
  state.category = category;
  document.querySelectorAll("[data-category]").forEach((b) => b.classList.toggle("active", b === tab));
}
function applyInitialVehicleFilter() {
  // 홈 "차종별 게시판"에서 /community?vehicle=아반떼 N 형태로 넘어온 딥링크를 반영한다.
  const vehicle = new URLSearchParams(location.search).get("vehicle");
  const input = $("#vehicle-filter");
  if (!vehicle || !input) return;
  input.value = vehicle;
  state.vehicle = vehicle;
}
function timeAgo(iso) {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "방금 전";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return dateText(iso);
}
function homeEmpty(target, message) {
  target.replaceChildren(el("p", message, "empty"));
}
// 홈 "이번 주 인기 이야기"/"오래 사랑받은 이야기" 공용 카드. 실제 게시글 필드(추천수·댓글수·
// 대표 이미지·작성 시각)만 사용하고, 순위 배지는 rank가 주어졌을 때만 그린다.
function renderStoryCard(post, { rank } = {}) {
  const card = link("", getPostUrl(post), "story-card");
  if (rank) card.append(el("span", String(rank), "story-rank"));
  const media = el("div", "", "story-media");
  if (post.imageIds?.length) media.append(photo(post.imageIds[0], `${post.title} 대표 사진`, "story-photo"));
  card.append(media);
  const body = el("div", "", "story-body");
  body.append(el("span", labels[post.category] || "자유 이야기", "story-category"));
  body.append(el("h3", post.title, "story-title"));
  body.append(el("p", post.content, "story-preview"));
  const meta = el("div", "", "story-meta");
  meta.append(el("span", post.username), el("span", timeAgo(post.createdAt)));
  body.append(meta);
  const stats = el("div", "", "story-stats");
  stats.append(el("span", `♥ ${post.likeCount}`), el("span", `💬 ${post.commentCount}`));
  body.append(stats);
  card.append(body);
  return card;
}
// "이번 주 인기 이야기"(최근 7일 추천순)와 "오래 사랑받은 이야기"(전체 기간 추천순)는 같은
// posts API를 기간만 다르게 호출해서 얻는다. 별도 추천 시스템은 만들지 않는다.
async function refreshHomeStories() {
  const weeklyTarget = $("#home-weekly-best");
  const evergreenSection = $("#evergreen-section");
  const evergreenTarget = $("#home-evergreen");
  const [weekly, allTime] = await Promise.all([
    api("/api/board/posts?sort=popular&period=week&limit=5"),
    api("/api/board/posts?sort=popular&limit=20"),
  ]);
  if (!weekly.length) homeEmpty(weeklyTarget, "이번 주 추천받은 이야기가 아직 없어요.");
  else weeklyTarget.replaceChildren(...weekly.map((p, i) => renderStoryCard(p, { rank: i + 1 })));
  const weeklyIds = new Set(weekly.map((p) => p.id));
  const evergreen = allTime.filter((p) => !weeklyIds.has(p.id)).slice(0, 5);
  evergreenSection.hidden = !evergreen.length;
  if (evergreen.length) evergreenTarget.replaceChildren(...evergreen.map((p) => renderStoryCard(p)));
}
// 실제 커뮤니티 카테고리(자유/정비/부품/드라이브) 4개만 보여준다. 설명 문구는
// community-list.js의 게시판 소개와 같은 문구를 그대로 사용한다.
const boardInfo = {
  free: ["자유게시판", "자동차와 관련된 모든 이야기를 자유롭게 나누는 공간입니다."],
  maintenance: ["정비 / DIY", "정비 경험과 직접 관리하는 노하우를 나눠보세요."],
  parts: ["부품 이야기", "부품 선택부터 장착 후기까지, 함께 이야기해요."],
  drive: ["드라이브", "좋았던 길과 함께 달리고 싶은 순간을 공유해요."],
};
function renderBoardCard(board, rank) {
  const [title, description] = boardInfo[board.category] || [board.category, ""];
  const card = link("", `/community?category=${board.category}`, "board-card");
  card.append(el("span", String(rank), "board-rank"));
  const body = el("div", "", "board-body");
  body.append(el("strong", title, "board-title"));
  if (description) body.append(el("p", description, "board-desc"));
  const stats = el("div", "", "board-stats");
  stats.append(
    el("span", `게시글 ${board.postCount}개`),
    el("span", `최근 7일 ${board.recentPostCount}개`),
    el("span", `추천 ${board.likeCount}`),
  );
  body.append(stats);
  card.append(body);
  return card;
}
async function refreshHomeBoards() {
  const target = $("#home-boards");
  const boards = await api("/api/board/categories/summary");
  if (!boards.length) return homeEmpty(target, "게시판 정보를 불러오지 못했어요.");
  target.replaceChildren(...boards.map((b, i) => renderBoardCard(b, i + 1)));
}
// Hero 하단 서비스 지표. 실제 값만 보여주고 K/+ 같은 과장 표기는 하지 않는다.
async function refreshHeroStats() {
  const stats = await api("/api/board/stats/summary");
  $("#stat-members").textContent = stats.memberCount.toLocaleString("ko-KR");
  $("#stat-vehicles").textContent = stats.vehicleCount.toLocaleString("ko-KR");
  $("#stat-parts").textContent = stats.soldPartsCount.toLocaleString("ko-KR");
  $("#stat-posts").textContent = stats.postCount.toLocaleString("ko-KR");
}
async function initialize() {
  window.communityList?.setup();
  window.postEditor?.setup();
  window.partsMarket?.setup();
  applyInitialCategory();
  applyInitialVehicleFilter();
  await refreshSession();
  // 이 페이지에 실제로 있는 섹션만 불러온다(index.html의 홈 섹션, /community·/garage·/parts는 각각 일부).
  const postDetail = parsePostDetailPath();
  const jobs = [];
  if (window.partsMarket?.active()) jobs.push({ key: "market", promise: window.partsMarket.start() });
  if (postDetail && $("#post-detail"))
    jobs.push({ key: "post-detail", promise: showPostDetailPage(postDetail.id) });
  else if ($("#community")) jobs.push({ key: "posts", promise: refreshPosts() });
  if ($("#garage")) jobs.push({ key: "garage", promise: refreshGarage() });
  if ($("#compatibility")) jobs.push({ key: "parts", promise: loadCompatibility() });
  if ($("#home-weekly-best")) jobs.push({ key: "home-stories", promise: refreshHomeStories() });
  if ($("#home-boards")) jobs.push({ key: "home-boards", promise: refreshHomeBoards() });
  if ($("#hero-stats")) jobs.push({ key: "hero-stats", promise: refreshHeroStats() });
  const results = await Promise.allSettled(jobs.map((j) => j.promise));
  results.forEach((r, i) => {
    if (r.status !== "rejected") return;
    if (jobs[i].key === "posts")
      $("#posts").replaceChildren(
        el("p", "게시글을 불러오지 못했어요. 새로고침해주세요.", "empty"),
      );
    if (jobs[i].key === "garage")
      $("#vehicles").replaceChildren(
        el("p", "차고를 불러오지 못했어요.", "empty"),
      );
    if (jobs[i].key === "home-stories") {
      homeEmpty($("#home-weekly-best"), "불러오지 못했어요.");
      $("#evergreen-section").hidden = true;
    }
    if (jobs[i].key === "home-boards") homeEmpty($("#home-boards"), "불러오지 못했어요.");
    if (jobs[i].key === "hero-stats")
      for (const id of ["stat-members", "stat-vehicles", "stat-parts", "stat-posts"])
        $("#" + id).textContent = "–";
    if (jobs[i].key === "post-detail")
      $("#post-detail-content").replaceChildren(el("p", "이야기를 불러오지 못했어요.", "empty"));
  });
  if (results.some((r) => r.status === "rejected"))
    notify("일부 정보를 불러오지 못했어요. 잠시 후 새로고침해주세요.");
  await route();
}
initialize().catch((e) => notify(e.message));
