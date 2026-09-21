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
  uploading: false,
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
async function refreshSession() {
  try {
    state.user = await api("/api/board/me");
  } catch (e) {
    state.user = null;
    if (e.status !== 401)
      notify("로그인 상태를 확인하지 못했어요. 새로고침해주세요.");
  }
  const user = state.user;
  $("#core-user").textContent = user ? `${user.username} 님` : "";
  for (const id of ["logout", "activity-button", "notifications-button"])
    $("#" + id).hidden = !user;
  $("#kakao-login").hidden = !!user;
  // #write-post가 없는 페이지(/garage, /parts)에서는 이 요소가 없다.
  const boardUser = $("#board-user");
  if (boardUser)
    boardUser.textContent = user
      ? `${user.username} 님, 오늘의 이야기를 남겨주세요.`
      : "이야기를 쓰려면 먼저 로그인해주세요.";
  if (user) await refreshNotificationCount();
  else $("#notification-count").textContent = "";
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
  const request = ++state.feedRequest;
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
    $("#posts").replaceChildren(...state.posts.map(renderPost));
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
  resetComposer();
  document.querySelectorAll("dialog[open]").forEach(closeDialog);
  await refreshSession();
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
function postPreviews() {
  renderPreviews(state.images, $("#image-previews"), (id) => {
    state.images = state.images.filter((x) => x !== id);
    postPreviews();
  });
}
on($("#post-images"), "change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!requireLogin()) return;
  if (files.length + state.images.length > 3)
    throw new Error("사진은 최대 3장까지 첨부할 수 있어요.");
  state.uploading = true;
  $("#submit-post").disabled = true;
  e.target.disabled = true;
  try {
    for (const file of files) {
      state.images.push(await uploadFile(file));
      postPreviews();
    }
  } finally {
    state.uploading = false;
    $("#submit-post").disabled = false;
    e.target.disabled = false;
  }
});
function resetComposer() {
  state.editing = null;
  state.images = [];
  $("#post-form").reset();
  $("#edit-status").hidden = true;
  $("#submit-post").textContent = "이야기 등록 ↗";
  postPreviews();
}
on($("#cancel-edit"), "click", resetComposer);
on($("#post-form"), "submit", async (e) => {
  e.preventDefault();
  if (!requireLogin() || state.uploading) return;
  const b = $("#submit-post");
  b.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(e.target));
    data.imageIds = state.images;
    const editing = state.editing;
    const result = await api(
      editing ? `/api/board/posts/${editing}` : "/api/board/posts",
      data,
      editing ? "PUT" : "POST",
    );
    resetComposer();
    await refreshPosts();
    location.hash = `post-${result.id}`;
    notify(editing ? "글을 수정했어요." : "이야기를 등록했어요.");
  } finally {
    b.disabled = false;
  }
});
function beginEdit(post) {
  if (!requireLogin()) return;
  closeDetail();
  // 게시글 상세가 이제 페이지라 #write-post를 숨겨뒀을 수 있어 다시 보이게 한다.
  const writePost = $("#write-post");
  if (writePost) writePost.hidden = false;
  state.editing = post.id;
  state.images = [...post.imageIds];
  const f = $("#post-form");
  for (const key of ["title", "content", "category", "vehicle"])
    f.elements[key].value = post[key];
  $("#edit-status").hidden = false;
  $("#submit-post").textContent = "수정 저장";
  postPreviews();
  location.hash = "write-post";
  f.elements.title.focus();
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
  root.replaceChildren(el("p", "이야기를 불러오고 있어요.", "empty"));
  let post, comments;
  try {
    [post, comments] = await Promise.all([
      api(`/api/board/posts/${id}`),
      api(`/api/board/posts/${id}/comments`),
    ]);
  } catch (e) {
    root.replaceChildren(
      el(
        "p",
        e.status === 404 ? "삭제되었거나 없는 이야기예요." : "이야기를 불러오지 못했어요.",
        "empty",
      ),
    );
    return;
  }
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
  renderPostDetail(root, post, comments, id);
}
function renderPostDetail(root, post, comments, id) {
  root.replaceChildren(
    el("span", labels[post.category], "post-category"),
    el("h2", post.title, "detail-title"),
  );
  const meta = el("div", "", "detail-meta");
  meta.append(
    memberLink(post.authorId, post.username),
    el("span", post.ownerVehicle || "오너"),
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
  if (state.user?.id === post.authorId) {
    actions.append(
      button("수정", () => beginEdit(post), ""),
      button(
        "삭제",
        async () => {
          if (!(await confirmDelete("게시글과 댓글을 함께 삭제합니다.")))
            return;
          await api(`/api/board/posts/${id}`, {}, "DELETE");
          // 상세는 이제 페이지라 닫을 모달이 없다. 글이 있던 카테고리 목록으로 돌아간다.
          location.href = `/community?category=${encodeURIComponent(post.category)}`;
        },
        "danger-text",
      ),
    );
  } else actions.append(button("신고", () => openReport(id), ""));
  root.append(actions);
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
    if (!c.deleted && state.user?.id === c.authorId)
      m.append(
        button(
          "삭제",
          async () => {
            if (!(await confirmDelete("이 댓글을 삭제할까요?"))) return;
            await api(`/api/board/comments/${c.id}`, {}, "DELETE");
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
  root.append(list);
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
  root.append(form);
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
        location.hash = `member-${state.user.id}`;
      },
      "",
    ),
    button("내 신고 내역", openReports, ""),
  );
  root.append(actions);
});
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
        `${r.status === "pending" ? "접수됨" : r.status} · ${dateText(r.createdAt)}`,
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
async function refreshGarage() {
  const vehicles = await api("/api/board/garage");
  $("#vehicles").replaceChildren(...vehicles.slice(0, 4).map(vehicleCard));
  if (!vehicles.length)
    $("#vehicles").append(
      el("p", "아직 등록된 차가 없어요. 나만의 차고를 만들어보세요.", "empty"),
    );
  if (vehicles.length > 4)
    $("#vehicles").append(
      button("차고 전체 보기", async () => {
        const root = panel("오너들의 차고"),
          grid = el("div", "", "garage-cards");
        grid.append(...vehicles.map(vehicleCard));
        root.append(grid);
      }),
    );
}
function vehiclePreviews() {
  renderPreviews(
    state.vehicleImage ? [state.vehicleImage] : [],
    $("#vehicle-preview"),
    () => {
      state.vehicleImage = null;
      vehiclePreviews();
    },
  );
}
function vehicleForm(v = null) {
  if (!requireLogin()) return;
  state.vehicleEditing = v?.id ?? null;
  state.vehicleImage = v?.imageId ?? null;
  const f = $("#vehicle-form");
  f.reset();
  for (const key of ["model", "year", "trim", "bio"])
    f.elements[key].value =
      v?.[key] ?? (key === "year" ? new Date().getFullYear() : "");
  f.elements.year.max = new Date().getFullYear() + 1;
  $("#vehicle-form-title").textContent = v ? "차량 정보 수정" : "내 차 등록";
  vehiclePreviews();
  openDialog($("#vehicle-dialog"));
}
on($("#add-vehicle"), "click", () => vehicleForm());
on($("#vehicle-image"), "change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const b = $("#vehicle-form button[type=submit]");
  b.disabled = true;
  e.target.disabled = true;
  try {
    state.vehicleImage = await uploadFile(file);
    vehiclePreviews();
  } finally {
    b.disabled = false;
    e.target.disabled = false;
  }
});
on($("#vehicle-form"), "submit", async (e) => {
  e.preventDefault();
  if (!requireLogin()) return;
  const b = e.target.querySelector("[type=submit]");
  b.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(e.target));
    data.year = Number(data.year);
    data.imageId = state.vehicleImage;
    const id = state.vehicleEditing;
    const result = await api(
      id ? `/api/board/garage/${id}` : "/api/board/garage",
      data,
      id ? "PUT" : "POST",
    );
    $("#vehicle-dialog").close();
    await refreshGarage();
    if (location.hash === `#car-${result.id}`) await openCar(result.id);
    else location.hash = `car-${result.id}`;
  } finally {
    b.disabled = false;
  }
});
async function openCar(id) {
  const request = ++state.detailRequest,
    root = $("#detail-content");
  root.replaceChildren(el("p", "차고를 불러오고 있어요.", "empty"));
  openDialog($("#detail-dialog"));
  const v = await api(`/api/board/garage/${id}`);
  if (request !== state.detailRequest) return;
  root.replaceChildren(
    el("span", "OWNER’S GARAGE", "post-category"),
    el("h2", v.model, "detail-title"),
  );
  root.append(
    memberLink(v.ownerId, v.username),
    el("p", `${v.year}년 · ${v.trim || "오너 차량"}`, "detail-meta"),
  );
  if (v.imageId) {
    const gallery = el("div", "", "detail-gallery");
    gallery.append(photo(v.imageId, v.model));
    root.append(gallery);
  }
  root.append(el("p", v.bio || "차량 소개를 기다리고 있어요.", "detail-text"));
  const own = state.user?.id === v.ownerId;
  if (own) {
    const actions = el("div", "", "detail-actions");
    actions.append(
      button("차량 수정", () => vehicleForm(v), ""),
      button(
        "차량 삭제",
        async () => {
          if (
            !(await confirmDelete("차량과 정비·튜닝 기록을 함께 삭제합니다."))
          )
            return;
          await api(`/api/board/garage/${id}`, {}, "DELETE");
          closeDetail();
          await refreshGarage();
        },
        "danger-text",
      ),
    );
    root.append(actions);
  }
  root.append(el("h3", `정비 · 튜닝 · 부품 기록 ${v.records.length}`));
  if (!v.records.length)
    root.append(
      el("p", "아직 기록이 없어요. 첫 정비나 장착 경험을 남겨보세요.", "empty"),
    );
  v.records.forEach((r) => {
    const item = el("article", "", "record");
    if (own)
      item.append(
        button(
          "삭제",
          async () => {
            if (!(await confirmDelete("이 차량 기록을 삭제할까요?"))) return;
            await api(`/api/board/garage/${id}/records/${r.id}`, {}, "DELETE");
            await openCar(id);
            await refreshGarage();
          },
          "text-link danger-text",
        ),
      );
    item.append(
      el("small", `${r.date} · ${recordLabels[r.kind]}`),
      el("h3", r.title),
      el("p", r.content),
    );
    const facts = [];
    if (r.mileage !== null) facts.push(`${r.mileage.toLocaleString()} km`);
    if (r.cost !== null) facts.push(`${r.cost.toLocaleString()}원`);
    item.append(el("small", facts.join(" · ")));
    root.append(item);
  });
  if (own) root.append(recordForm(id));
}
function field(form, label, name, type = "text", required = false, maxLength) {
  const wrapper = el("label", label),
    input = document.createElement(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") input.type = type;
  input.name = name;
  input.required = required;
  if (maxLength) input.maxLength = maxLength;
  wrapper.append(input);
  form.append(wrapper);
  return input;
}
function recordForm(id) {
  const form = el("form", "", "record-form");
  form.append(el("h3", "새 차량 기록"));
  const label = el("label", "종류"),
    select = document.createElement("select");
  select.name = "kind";
  for (const [value, name] of Object.entries(recordLabels)) {
    const o = el("option", name);
    o.value = value;
    select.append(o);
  }
  label.append(select);
  form.append(label);
  field(form, "제목", "title", "text", true, 150);
  const date = field(form, "날짜", "date", "date", true);
  date.value = new Date().toLocaleDateString("en-CA");
  field(form, "내용", "content", "textarea", false, 2000);
  const row = el("div", "", "form-row");
  form.append(row);
  const mileage = field(row, "주행거리 (km, 선택)", "mileage", "number");
  mileage.min = 0;
  mileage.max = 2000000;
  const cost = field(row, "비용 (원, 선택)", "cost", "number");
  cost.min = 0;
  cost.max = 2000000000;
  const b = el("button", "기록 저장", "primary");
  b.type = "submit";
  form.append(b);
  on(form, "submit", async (e) => {
    e.preventDefault();
    b.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      data.mileage = data.mileage === "" ? null : Number(data.mileage);
      data.cost = data.cost === "" ? null : Number(data.cost);
      await api(`/api/board/garage/${id}/records`, data);
      await openCar(id);
      await refreshGarage();
    } finally {
      b.disabled = false;
    }
  });
  return form;
}
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
  if (state.user) await refreshNotificationCount();
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
// 홈 2x2 포털 전용 컴팩트 행. 기존 renderPost()는 본문 미리보기·사진·저장 상태까지 보여주는
// 커뮤니티 목록 전용이라 홈 요약에는 과해서, 화면을 건드리지 않도록 별도 렌더 함수로 둔다.
function renderHomePostRow(post, { showLikes = false, showAuthor = false, showTime = false, showVehicle = false } = {}) {
  const row = link("", getPostUrl(post), "home-row");
  row.append(el("span", labels[post.category] || "자유", "home-row-category"));
  row.append(el("span", post.title, "home-row-title"));
  const metaText = [];
  if (showAuthor) metaText.push(post.username);
  if (showVehicle && post.vehicle) metaText.push(post.vehicle);
  if (showTime) metaText.push(timeAgo(post.createdAt));
  if (metaText.length) row.append(el("span", metaText.join(" · "), "home-row-meta"));
  const stats = el("span", "", "home-row-stats");
  if (showLikes) stats.append(el("span", `♥ ${post.likeCount}`));
  stats.append(el("span", `💬 ${post.commentCount}`));
  row.append(stats);
  return row;
}
async function refreshHomePopularToday() {
  const target = $("#home-popular-today");
  const posts = await api("/api/board/posts?sort=popular&period=today&limit=5");
  if (!posts.length) return homeEmpty(target, "오늘 추천받은 글이 아직 없어요.");
  target.replaceChildren(...posts.map((p) => renderHomePostRow(p, { showLikes: true })));
}
async function refreshHomeLatest() {
  const target = $("#home-latest");
  const posts = await api("/api/board/posts?sort=latest&limit=5");
  if (!posts.length) return homeEmpty(target, "아직 이야기가 없어요.");
  target.replaceChildren(...posts.map((p) => renderHomePostRow(p, { showAuthor: true, showTime: true })));
}
async function refreshHomeParts() {
  const target = $("#home-parts");
  const posts = await api("/api/board/posts?category=parts&sort=latest&limit=5");
  if (!posts.length) return homeEmpty(target, "아직 부품 관련 글이 없어요.");
  target.replaceChildren(
    ...posts.map((p) => renderHomePostRow(p, { showAuthor: true, showVehicle: true, showTime: true })),
  );
}
async function refreshHomeVehicles() {
  const target = $("#home-vehicles");
  const items = await api("/api/board/vehicles/popular?limit=8");
  if (!items.length) return homeEmpty(target, "차종 정보가 담긴 글이 아직 없어요.");
  target.replaceChildren(
    ...items.map((v) => {
      const row = link("", `/community?vehicle=${encodeURIComponent(v.vehicle)}`, "home-row");
      row.append(el("span", v.vehicle, "home-row-title"));
      row.append(el("span", `게시글 ${v.postCount}개`, "home-row-stats"));
      return row;
    }),
  );
}
async function initialize() {
  applyInitialCategory();
  applyInitialVehicleFilter();
  await refreshSession();
  // 이 페이지에 실제로 있는 섹션만 불러온다(index.html의 홈 포털, /community·/garage·/parts는 각각 일부).
  const postDetail = parsePostDetailPath();
  const jobs = [];
  if (postDetail && $("#post-detail"))
    jobs.push({ key: "post-detail", promise: showPostDetailPage(postDetail.id) });
  else if ($("#community")) jobs.push({ key: "posts", promise: refreshPosts() });
  if ($("#garage")) jobs.push({ key: "garage", promise: refreshGarage() });
  if ($("#compatibility")) jobs.push({ key: "parts", promise: loadCompatibility() });
  if ($("#home-popular-today")) jobs.push({ key: "home-popular", promise: refreshHomePopularToday() });
  if ($("#home-latest")) jobs.push({ key: "home-latest", promise: refreshHomeLatest() });
  if ($("#home-parts")) jobs.push({ key: "home-parts", promise: refreshHomeParts() });
  if ($("#home-vehicles")) jobs.push({ key: "home-vehicles", promise: refreshHomeVehicles() });
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
    if (jobs[i].key === "home-popular") homeEmpty($("#home-popular-today"), "불러오지 못했어요.");
    if (jobs[i].key === "home-latest") homeEmpty($("#home-latest"), "불러오지 못했어요.");
    if (jobs[i].key === "home-parts") homeEmpty($("#home-parts"), "불러오지 못했어요.");
    if (jobs[i].key === "home-vehicles") homeEmpty($("#home-vehicles"), "불러오지 못했어요.");
    if (jobs[i].key === "post-detail")
      $("#post-detail-content").replaceChildren(el("p", "이야기를 불러오지 못했어요.", "empty"));
  });
  if (results.some((r) => r.status === "rejected"))
    notify("일부 정보를 불러오지 못했어요. 잠시 후 새로고침해주세요.");
  await route();
}
initialize().catch((e) => notify(e.message));
