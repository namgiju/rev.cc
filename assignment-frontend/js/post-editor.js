// One composer for create and edit; app.js retains session, upload and post rendering.
window.postEditor = (() => {
  let opened = false,
    baseline = "",
    userId,
    version = 0,
    busy = false,
    uploading = false,
    ready = false,
    returning = "/community";
  const form = () => $("#post-form");
  const serialize = (fields, images) =>
    JSON.stringify([
      Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)),
      images,
    ]);
  const snapshot = () =>
    serialize(Object.fromEntries(new FormData(form())), state.images);
  const dirty = () => opened && !!baseline && snapshot() !== baseline;
  const active = () => opened;
  function navigate(url) {
    if ((busy || uploading) && !confirm("처리 중입니다. 이 화면을 나갈까요?"))
      return;
    if (dirty() && !confirm("작성 중인 내용이 사라집니다. 이동할까요?")) return;
    baseline = "";
    location.assign(url);
  }
  function counts() {
    for (const [name, max] of [
      ["title", 150],
      ["content", 5000],
    ])
      $(`#${name}-count`).textContent =
        `${form().elements[name].value.length} / ${max}`;
    $("#editor-category").textContent =
      form().elements.category.selectedOptions[0].textContent;
    document.querySelectorAll("[data-category]").forEach((b) => {
      const selected = b.dataset.category === form().elements.category.value;
      b.classList.toggle("active", selected);
      b.setAttribute("aria-pressed", String(selected));
    });
  }
  function previews() {
    renderPreviews(state.images, $("#image-previews"), (id) => {
      if (busy || uploading) return;
      state.images = state.images.filter((v) => v !== id);
      previews();
    });
  }
  function layout() {
    $("#main").classList.remove("post-detail-wide");
    $("#main").classList.add("community-list-layout", "community-editor-mode");
    $("#community").hidden = true;
    $("#post-detail").hidden = true;
    $("#write-post").hidden = false;
    $("#community-left").hidden = false;
    $("#community-right").hidden = false;
    document
      .querySelectorAll(".editor-help")
      .forEach((n) => (n.hidden = false));
    form().hidden = !state.user;
    $("#editor-login").hidden = !!state.user;
  }
  async function open(post = null) {
    const request = ++version;
    opened = true;
    userId = state.user?.id;
    baseline = "";
    busy = false;
    uploading = false;
    ready = false;
    returning = post ? getPostUrl(post) : `/community${location.search}`;
    form().reset();
    form().inert = false;
    state.images = [...(post?.imageIds || [])];
    state.editing = post?.id || null;
    for (const key of ["title", "content", "vehicle"])
      form().elements[key].value = post?.[key] || "";
    form().elements.category.value = post?.category || state.category || "free";
    $("#editor-heading").textContent = post ? "게시글 수정" : "새 글 작성";
    $("#edit-status").hidden = !post;
    $("#submit-post").textContent = post ? "수정 저장" : "등록하기";
    $("#submit-post").disabled = true;
    $("#post-images").disabled = false;
    $("#upload-status").textContent = "";
    counts();
    previews();
    layout();
    const initial = Object.fromEntries(new FormData(form()));
    const initialImages = [...state.images];
    const root = $("#editor-vehicles");
    root.replaceChildren(
      el("p", "내 차량을 확인하고 있어요.", "context-muted"),
    );
    if (!state.user) {
      root.replaceChildren();
      return;
    }
    baseline = snapshot();
    const loadVehicles = async () => {
      try {
        const cars = await api("/api/board/garage/mine");
        if (request !== version) return;
        const select = el("select");
        select.name = "vehicleId";
        select.setAttribute("aria-label", "내 차량 연결 (선택)");
        const empty = el("option", "연결하지 않음");
        empty.value = "";
        select.append(empty);
        for (const car of cars) {
          const option = el(
            "option",
            `${car.manufacturer || ""} ${car.model} (${car.year})`.trim(),
          );
          option.value = car.id;
          select.append(option);
        }
        root.replaceChildren();
        if (cars.length) {
          const label = el("label", "내 차량 연결 (선택)");
          label.append(select);
          root.append(label);
        } else {
          select.dataset.native = "";
          select.hidden = true;
          root.append(
            select,
            el("p", "등록된 차량이 없습니다."),
            el(
              "p",
              "차량을 등록하면 게시글에 내 차량을 연결할 수 있습니다.",
              "context-muted",
            ),
            link("내 차고에서 차량 등록 →", "/home", "text-link"),
          );
        }
        select.value = post?.vehicleId || "";
        // A legacy text-only vehicle is preserved unless the user changes the link.
        on(select, "change", () => (form().elements.vehicle.value = ""));
        if (cars.length) window.RevDropdown?.enhance(select);
        ready = true;
        $("#submit-post").disabled = false;
        baseline = serialize(
          { ...initial, vehicleId: select.value },
          initialImages,
        );
      } catch (e) {
        if (request !== version) return;
        root.replaceChildren(
          el(
            "p",
            "내 차량을 확인하지 못했어요. 다시 확인 후 작성해주세요.",
            "context-muted",
          ),
          button("다시 확인", loadVehicles, "secondary"),
        );
        notify(e.message);
      }
    };
    await loadVehicles();
  }
  async function route() {
    if (!$("#write-post") || !$("#editor-heading")) return false;
    if (location.hash === "#write-post") {
      if (!opened) {
        if (!state.user) {
          await open();
          return true;
        }
        const path = parsePostDetailPath();
        let post = null;
        if (path) {
          post = await api(`/api/board/posts/${path.id}`);
          if (post.authorId !== state.user?.id) {
            notify("본인이 작성한 글만 수정할 수 있어요.");
            baseline = "";
            opened = false;
            location.replace(getPostUrl(post));
            return true;
          }
        }
        await open(post);
      }
      return true;
    }
    if (opened) {
      if (dirty() && !confirm("작성 중인 내용이 사라집니다. 이동할까요?")) {
        history.replaceState(
          null,
          "",
          location.pathname + location.search + "#write-post",
        );
        return true;
      }
      baseline = "";
      opened = false;
      version++;
      location.replace(
        parsePostDetailPath()
          ? location.pathname
          : `/community${location.search}${location.hash}`,
      );
      return true;
    }
    return false;
  }
  async function edit(post) {
    if (!requireLogin() || post.authorId !== state.user.id) return;
    await open(post);
    location.hash = "write-post";
    form().elements.title.focus();
  }
  function sessionChanged() {
    if (opened && userId !== state.user?.id) {
      version++;
      baseline = "";
      opened = false;
      state.images = [];
      form().reset();
      form().hidden = true;
      $("#editor-vehicles").replaceChildren();
      void route();
    }
  }
  function setup() {
    if (!$("#editor-heading")) return;
    on(form(), "input", counts);
    on(form().elements.category, "change", counts);
    on($("#cancel-edit"), "click", () => navigate(returning));
    on(window, "beforeunload", (e) => {
      if (dirty() || uploading || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    document.addEventListener(
      "click",
      (e) => {
        const a = e.target.closest("a[href]");
        if (
          !opened ||
          !a ||
          a.target ||
          e.ctrlKey ||
          e.metaKey ||
          a.hash === "#write-post"
        )
          return;
        if (dirty()) {
          e.preventDefault();
          navigate(a.href);
        }
      },
      true,
    );
    document.querySelectorAll("[data-community-scope]").forEach((b) =>
      b.addEventListener(
        "click",
        (e) => {
          if (!opened) return;
          e.stopImmediatePropagation();
          navigate(`/community?scope=${b.dataset.communityScope}`);
        },
        true,
      ),
    );
    on($("#post-images"), "change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (!requireLogin() || uploading || busy) return;
      if (state.images.length + files.length > 3)
        throw new Error("사진은 최대 3장까지 첨부할 수 있어요.");
      const request = version;
      uploading = true;
      e.target.disabled = true;
      $("#submit-post").disabled = true;
      $("#upload-status").textContent = "사진 업로드 중…";
      try {
        for (const file of files) {
          const id = await uploadFile(file);
          if (request !== version) return;
          state.images.push(id);
          previews();
        }
        $("#upload-status").textContent = "사진 업로드 완료";
      } catch (e) {
        if (request === version) $("#upload-status").textContent = e.message;
        throw e;
      } finally {
        if (request === version) {
          uploading = false;
          e.target.disabled = false;
          $("#submit-post").disabled = !ready;
        }
      }
    });
    on(form(), "submit", async (e) => {
      e.preventDefault();
      if (!requireLogin() || busy || uploading || !ready) return;
      busy = true;
      form().inert = true;
      const request = version;
      const b = $("#submit-post");
      b.disabled = true;
      b.textContent = "저장 중…";
      try {
        const data = Object.fromEntries(new FormData(form()));
        data.vehicleId = data.vehicleId || null;
        data.imageIds = [...state.images];
        const result = await api(
          state.editing
            ? `/api/board/posts/${state.editing}`
            : "/api/board/posts",
          data,
          state.editing ? "PUT" : "POST",
        );
        if (request !== version) return;
        baseline = "";
        busy = false;
        location.assign(
          getPostUrl({ ...result, category: result.category || data.category }),
        );
      } finally {
        if (request === version) {
          busy = false;
          form().inert = false;
          b.disabled = false;
          b.textContent = state.editing ? "수정 저장" : "등록하기";
        }
      }
    });
  }
  return { setup, route, edit, active, navigate, sessionChanged };
})();
