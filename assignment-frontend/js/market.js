window.partsMarket = (() => {
  const categories = {
    wheels: "휠 / 타이어",
    suspension: "서스펜션",
    brakes: "브레이크",
    "intake-exhaust": "배기 / 흡배기",
    exterior: "외장 / 바디",
    interior: "내장",
    electronics: "전장 / ECU",
    engine: "엔진 / 구동계",
    other: "기타",
  };
  const statuses = { selling: "판매중", reserved: "예약중", sold: "판매완료" };
  const filters = {
    q: "",
    category: "",
    status: "",
    region: "",
    vehicle: "",
    sort: "latest",
    scope: "",
    page: 1,
  };
  const recentKey = "revcc:recent-listings:v1",
    seen = new Set();
  let started = false,
    feedTicket = 0,
    detailTicket = 0,
    editTicket = 0,
    editing = null,
    images = [],
    uploading = false,
    lastUser = null,
    refreshGarage;
  const active = () => !!document.querySelector("#market-app");
  const money = (value) => `${Number(value).toLocaleString("ko-KR")}원`;
  const url = (id) => `/parts#listing-${Number(id)}`;
  async function request(path, body, method) {
    try {
      return await api(path, body, method);
    } catch (e) {
      if (e.status === 401) await refreshSession();
      throw e;
    }
  }
  function readRecent() {
    try {
      const value = JSON.parse(localStorage.getItem(recentKey) || "[]");
      if (!Array.isArray(value)) return [];
      const ids = new Set();
      return value
        .filter(
          (p) =>
            Number.isSafeInteger(p.id) &&
            p.id > 0 &&
            typeof p.title === "string" &&
            p.title.length <= 150 &&
            Number.isFinite(p.price) &&
            p.price >= 0 &&
            !ids.has(p.id) &&
            ids.add(p.id),
        )
        .slice(0, 5);
    } catch {
      return [];
    }
  }
  function recent() {
    const root = $("#market-recent");
    root.replaceChildren(...readRecent().map((p) => sideRow(p)));
    if (!root.children.length)
      root.append(el("p", "아직 본 매물이 없습니다.", "context-muted"));
  }
  function remember(item) {
    try {
      localStorage.setItem(
        recentKey,
        JSON.stringify(
          [
            {
              id: item.id,
              title: item.title,
              price: item.price,
              viewedAt: Date.now(),
            },
            ...readRecent().filter((p) => p.id !== item.id),
          ].slice(0, 5),
        ),
      );
    } catch {}
    recent();
  }
  function forget(id) {
    try {
      localStorage.setItem(
        recentKey,
        JSON.stringify(readRecent().filter((p) => p.id !== id)),
      );
    } catch {}
    recent();
  }
  function sideRow(item) {
    const a = link("", url(item.id), "market-side-row");
    a.append(el("strong", item.title), el("small", money(item.price)));
    return a;
  }
  function sync() {
    const form = $("#market-filters");
    for (const key of ["q", "category", "status", "region", "vehicle", "sort"])
      form.elements[key].value = filters[key];
    document
      .querySelectorAll("[data-market-category]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.marketCategory === filters.category),
        ),
      );
    document
      .querySelectorAll("[data-market-scope]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.marketScope === filters.scope),
        ),
      );
    const target = new URL(location.href);
    for (const [key, value] of Object.entries(filters)) {
      if (
        value &&
        !(key === "sort" && value === "latest") &&
        !(key === "page" && value === 1)
      )
        target.searchParams.set(key, value);
      else target.searchParams.delete(key);
    }
    history.replaceState(
      null,
      "",
      target.pathname + target.search + target.hash,
    );
  }
  async function favorite(item) {
    if (!requireLogin()) return;
    await request(
      `/api/parts/listings/${item.id}/favorite`,
      { active: !item.favorited },
      "PUT",
    );
    await Promise.all([load(), popular()]);
    if (location.hash === `#listing-${item.id}`) await route();
  }
  function favoriteButton(item) {
    const b = button(
      `${item.favorited ? "♥" : "♡"} 관심 ${item.favoriteCount}`,
      () => favorite(item),
      "market-favorite",
    );
    b.setAttribute("aria-pressed", String(item.favorited));
    return b;
  }
  function card(item) {
    const root = el("article", "", "market-card");
    root.dataset.listingId = item.id;
    const a = link("", url(item.id), "market-card-link"),
      visual = el("div", "", "market-visual");
    if (item.imageIds.length)
      visual.append(photo(item.imageIds[0], item.title));
    else visual.append(el("span", "등록된 사진 없음", "market-no-photo"));
    visual.append(
      el("span", statuses[item.status], `market-status ${item.status}`),
    );
    a.append(
      visual,
      el("h3", item.title),
      el("strong", money(item.price), "market-price"),
    );
    root.append(
      a,
      el("p", categories[item.category], "context-muted"),
      el("p", `판매자 제공 차종 · ${item.vehicle}`, "market-fitment"),
      el(
        "p",
        `${item.region} · ${new Date(item.createdAt).toLocaleDateString("ko-KR")}`,
        "context-muted",
      ),
    );
    const bottom = el("div", "", "market-card-bottom");
    bottom.append(
      link(item.username, `/community#member-${item.sellerId}`),
      favoriteButton(item),
    );
    root.append(bottom);
    return root;
  }
  async function load() {
    const ticket = ++feedTicket,
      userId = state.user?.id;
    sync();
    const root = $("#market-list");
    root.replaceChildren(el("p", "매물을 불러오고 있어요.", "empty"));
    $("#market-pagination").replaceChildren();
    if (filters.scope && !state.user) {
      $("#market-summary").textContent = "";
      root.replaceChildren(
        el("p", "내 판매글과 관심 매물을 보려면 로그인이 필요합니다.", "empty"),
        link("로그인하기", "/api/auth/kakao/login", "text-link"),
      );
      return;
    }
    try {
      const data = await request(
        "/api/parts/listings?" + new URLSearchParams({ ...filters, limit: 12 }),
      );
      if (ticket !== feedTicket || userId !== state.user?.id) return;
      const pages = Math.max(1, Math.ceil(data.total / data.limit));
      if (filters.page > pages) {
        filters.page = pages;
        return load();
      }
      $("#market-summary").textContent =
        `${{ mine: "내 판매글", favorites: "관심 매물" }[filters.scope] || "전체 매물"} ${data.total}개`;
      root.replaceChildren(...data.items.map(card));
      if (!data.items.length)
        root.append(
          el(
            "p",
            "조건에 맞는 매물이 없습니다. 필터를 바꾸거나 첫 판매글을 등록해보세요.",
            "empty",
          ),
        );
      const pager = $("#market-pagination");
      const go = (page) => {
        filters.page = page;
        return load();
      };
      const previous = button("이전", () => go(filters.page - 1), "secondary");
      previous.disabled = filters.page === 1;
      pager.append(previous);
      for (
        let page = Math.max(1, Math.min(filters.page - 2, pages - 4));
        page <= Math.min(pages, Math.max(5, filters.page + 2));
        page++
      ) {
        const b = button(String(page), () => go(page), "secondary");
        if (page === filters.page) b.setAttribute("aria-current", "page");
        pager.append(b);
      }
      const next = button("다음", () => go(filters.page + 1), "secondary");
      next.disabled = filters.page >= pages;
      pager.append(next);
    } catch (e) {
      if (ticket === feedTicket) {
        $("#market-summary").textContent = "";
        root.replaceChildren(
          el("p", e.message, "empty"),
          button("다시 시도", load),
        );
      }
    }
  }
  async function popular() {
    const root = $("#market-popular");
    try {
      const data = await request(
        "/api/parts/listings?sort=popular&limit=5&status=selling",
      );
      root.replaceChildren(...data.items.map(sideRow));
      if (!data.items.length)
        root.append(el("p", "아직 판매중인 매물이 없습니다.", "context-muted"));
    } catch {
      root.replaceChildren(
        el("p", "인기 매물을 불러오지 못했어요.", "context-muted"),
        button("다시 확인", popular, "text-link"),
      );
    }
  }
  function closeDetail() {
    detailTicket++;
    $("#market-detail").close();
    $("#market-detail-content").replaceChildren();
    if (/^#listing-\d+$/.test(location.hash))
      history.replaceState(null, "", location.pathname + location.search);
  }
  async function route() {
    if (!active() || !started) return;
    const match = /^#listing-([1-9]\d*)$/.exec(location.hash);
    if (!match) {
      closeDetail();
      return;
    }
    const id = Number(match[1]),
      ticket = ++detailTicket,
      userId = state.user?.id,
      root = $("#market-detail-content");
    root.replaceChildren(el("p", "매물을 확인하고 있어요.", "empty"));
    openDialog($("#market-detail"));
    try {
      const item = await request(`/api/parts/listings/${id}`);
      if (ticket !== detailTicket || userId !== state.user?.id) return;
      if (!seen.has(id)) {
        try {
          const result = await request(`/api/parts/listings/${id}/view`, {});
          item.views = result.views;
          seen.add(id);
        } catch {}
      }
      if (ticket !== detailTicket || userId !== state.user?.id) return;
      remember(item);
      renderDetail(root, item);
    } catch (e) {
      if (ticket === detailTicket) {
        if (e.status === 404) forget(id);
        root.replaceChildren(el("p", e.message, "empty"));
      }
    }
  }
  function renderDetail(root, item) {
    root.replaceChildren(
      el("span", statuses[item.status], `market-status ${item.status}`),
      el("h2", item.title, "detail-title"),
      el("strong", money(item.price), "market-detail-price"),
    );
    const meta = el("p", "", "context-muted");
    meta.append(
      link(item.username, `/community#member-${item.sellerId}`),
      document.createTextNode(
        ` · ${dateText(item.createdAt)} · 조회 ${item.views}`,
      ),
    );
    root.append(meta);
    const gallery = el("div", "", "detail-gallery");
    item.imageIds.forEach((id) => gallery.append(photo(id, item.title)));
    root.append(gallery, el("p", item.description, "detail-text"));
    const specs = el("dl", "", "market-specs");
    for (const [key, value] of [
      ["카테고리", categories[item.category]],
      ["판매자 제공 적용 차량", item.vehicle],
      ["거래 지역", item.region],
    ]) {
      const row = el("div");
      row.append(el("dt", key), el("dd", value));
      specs.append(row);
    }
    root.append(
      specs,
      el(
        "p",
        "적용 여부와 부품 상태는 판매자에게 확인해주세요. REV.CC가 호환성을 보증하지 않습니다.",
        "context-muted",
      ),
    );
    const actions = el("div", "", "detail-actions");
    actions.append(
      favoriteButton(item),
      button("매물 링크 복사", async () => {
        await navigator.clipboard.writeText(location.origin + url(item.id));
        notify("매물 링크를 복사했어요.");
      }),
    );
    root.append(actions);
    const contact = el("section", "", "market-contact");
    contact.append(el("h3", "판매자와 직접 거래"));
    if (state.user) {
      contact.append(
        el("p", item.contact || "연락 방법을 확인하지 못했습니다."),
        el(
          "small",
          "판매자가 제공한 연락 방법입니다. 제품과 거래 조건을 직접 확인해주세요.",
        ),
      );
    } else
      contact.append(
        el("p", "연락 방법은 로그인 후 확인할 수 있습니다."),
        link("로그인하기", "/api/auth/kakao/login", "text-link"),
      );
    root.append(contact);
    if (state.user?.id === item.sellerId) {
      const controls = el("div", "", "market-owner-actions");
      controls.append(
        button("판매글 수정", () => edit(item)),
        button(
          "판매글 삭제",
          async () => {
            if (!(await confirmDelete("이 판매글을 삭제할까요?"))) return;
            await request(`/api/parts/listings/${item.id}`, {}, "DELETE");
            forget(item.id);
            closeDetail();
            await Promise.all([load(), popular()]);
          },
          "danger-text",
        ),
      );
      const label = el("label", "판매 상태"),
        select = document.createElement("select");
      select.setAttribute("aria-label", "판매 상태 변경");
      for (const [value, name] of Object.entries(statuses)) {
        const option = el("option", name);
        option.value = value;
        select.append(option);
      }
      select.value = item.status;
      label.append(select);
      controls.append(
        label,
        button("상태 저장", async () => {
          await request(
            `/api/parts/listings/${item.id}/status`,
            { status: select.value },
            "PATCH",
          );
          await Promise.all([load(), popular(), route()]);
        }),
      );
      root.append(controls);
    }
  }
  function previews() {
    renderPreviews(images, $("#market-image-previews"), (id) => {
      images = images.filter((x) => x !== id);
      previews();
    });
  }
  async function edit(item = null) {
    if (!requireLogin()) return;
    const ticket = ++editTicket,
      userId = state.user.id;
    editing = item?.id ?? null;
    images = [...(item?.imageIds || [])];
    uploading = false;
    const form = $("#market-form");
    form.reset();
    if (item)
      for (const key of [
        "title",
        "description",
        "price",
        "category",
        "status",
        "vehicle",
        "region",
        "contact",
      ])
        form.elements[key].value = item[key];
    $("#market-editor-title").textContent = item
      ? "판매글 수정"
      : "판매글 등록";
    $("#market-save").textContent = item ? "수정 저장" : "판매글 등록";
    $("#market-save").disabled = false;
    previews();
    const select = $("#market-own-vehicle");
    select.replaceChildren(el("option", "직접 입력"));
    select.firstChild.value = "";
    openDialog($("#market-editor"));
    try {
      const member = await request(`/api/board/members/${userId}`);
      if (ticket !== editTicket || state.user?.id !== userId) return;
      for (const v of member.vehicles) {
        const text = [v.manufacturer, v.model, v.year, v.trim]
          .filter(Boolean)
          .join(" ");
        const option = el("option", text);
        option.value = text;
        select.append(option);
      }
    } catch {
      if (ticket === editTicket)
        notify(
          "내 차량 정보를 불러오지 못했어요. 적용 차량은 직접 입력할 수 있습니다.",
        );
    }
  }
  function sessionChanged() {
    if (!active() || !refreshGarage) return;
    const changed = lastUser !== state.user?.id;
    lastUser = state.user?.id;
    void refreshGarage();
    if (changed) {
      editTicket++;
      detailTicket++;
      feedTicket++;
      images = [];
      editing = null;
      $("#market-form").reset();
      $("#market-image-previews").replaceChildren();
      $("#market-editor").close();
      $("#market-detail-content").replaceChildren();
      if (started) {
        void load();
        void route();
      }
    }
  }
  function setup() {
    if (!active()) return;
    refreshGarage = createMyGarageCard({
      root: $("#market-my-garage"),
      api: request,
      getUser: () => state.user,
      el,
      link,
      photo,
      button,
    });
    const params = new URLSearchParams(location.search);
    for (const key of Object.keys(filters)) {
      if (params.has(key))
        filters[key] =
          key === "page"
            ? Math.max(1, Number(params.get(key)) || 1)
            : params.get(key);
    }
    for (const [value, name] of [
      ["", "전체 매물"],
      ...Object.entries(categories),
    ]) {
      const b = button(
        name,
        () => {
          filters.category = value;
          filters.scope = "";
          filters.page = 1;
          return load();
        },
        "",
      );
      b.dataset.marketCategory = value;
      $("#market-categories").append(b);
      for (const selector of [
        "#market-category-filter",
        ...(value ? ["#market-editor-category"] : []),
      ]) {
        const option = el("option", name);
        option.value = value;
        $(selector).append(option);
      }
    }
    sync();
    on($("#market-filters"), "submit", (event) => {
      event.preventDefault();
      Object.assign(
        filters,
        Object.fromEntries(new FormData(event.currentTarget)),
        { page: 1 },
      );
      return load();
    });
    on($("#market-filters"), "change", (event) => {
      if (event.target.tagName === "SELECT")
        $("#market-filters").requestSubmit();
    });
    on($("#market-reset"), "click", () => {
      Object.assign(filters, {
        q: "",
        category: "",
        status: "",
        region: "",
        vehicle: "",
        sort: "latest",
        scope: "",
        page: 1,
      });
      return load();
    });
    on($("#market-new"), "click", () => edit());
    document.querySelectorAll("[data-market-scope]").forEach((b) =>
      on(b, "click", () => {
        if (!requireLogin()) return;
        filters.scope = b.dataset.marketScope;
        filters.page = 1;
        return load();
      }),
    );
    on($("#market-own-vehicle"), "change", () => {
      if ($("#market-own-vehicle").value)
        $("#market-form").elements.vehicle.value = $(
          "#market-own-vehicle",
        ).value;
    });
    on($("#market-images"), "change", async (event) => {
      const files = [...event.target.files];
      event.target.value = "";
      if (files.length + images.length > 3)
        throw new Error("사진은 최대 3장까지 첨부할 수 있어요.");
      const ticket = editTicket,
        userId = state.user?.id;
      uploading = true;
      $("#market-save").disabled = true;
      try {
        for (const file of files) {
          const id = await uploadFile(file);
          if (ticket !== editTicket || userId !== state.user?.id) return;
          images.push(id);
          previews();
        }
      } finally {
        if (ticket === editTicket) {
          uploading = false;
          $("#market-save").disabled = false;
        }
      }
    });
    on($("#market-form"), "submit", async (event) => {
      event.preventDefault();
      if (!requireLogin() || uploading) return;
      const userId = state.user.id,
        ticket = editTicket;
      $("#market-save").disabled = true;
      try {
        const body = Object.fromEntries(new FormData(event.currentTarget));
        body.price = Number(body.price);
        body.imageIds = images;
        const item = await request(
          editing ? `/api/parts/listings/${editing}` : "/api/parts/listings",
          body,
          editing ? "PUT" : "POST",
        );
        if (ticket !== editTicket || userId !== state.user?.id) return;
        $("#market-editor").close();
        await Promise.all([load(), popular()]);
        if (location.hash === `#listing-${item.id}`) await route();
        else location.hash = `listing-${item.id}`;
      } finally {
        if (ticket === editTicket) $("#market-save").disabled = false;
      }
    });
    document.querySelectorAll("[data-market-close]").forEach((b) =>
      on(b, "click", () => {
        if (b.closest("dialog").id === "market-detail") closeDetail();
        else {
          editTicket++;
          $("#market-editor").close();
        }
      }),
    );
    on($("#market-detail"), "cancel", (event) => {
      event.preventDefault();
      closeDetail();
    });
    on($("#market-editor"), "cancel", () => {
      editTicket++;
    });
    on(window, "hashchange", route);
    on(window, "storage", (event) => {
      if (event.key === recentKey) recent();
    });
  }
  async function start() {
    if (!active()) return;
    started = true;
    recent();
    await Promise.all([load(), popular(), route()]);
  }
  return { setup, start, sessionChanged, active };
})();
