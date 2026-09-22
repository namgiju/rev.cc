/*
 * REV.CC 공통 커스텀 드롭다운.
 *
 * 네이티브 <select>를 "값의 원본"으로 그대로 두고(폼 제출, FormData, .value, change 이벤트,
 * 기존 필터/API 로직 모두 그대로 동작) 화면에는 OS 기본 팝업 대신 페이지 안에서 펼쳐지는
 * 리스트박스를 보여준다.
 *
 *   RevDropdown.enhance(select)       한 개를 변환
 *   RevDropdown.enhanceAll(root)      root 안의 모든 select 변환
 *   RevDropdown.observe(root)         root 안의 현재/미래(동적 생성) select를 모두 자동 변환
 *   RevDropdown.refresh(select)       화면 표시를 select 상태와 다시 맞춤
 *
 * 변환하지 않으려면 select에 data-native 속성을 붙인다.
 */
window.RevDropdown = (() => {
  const valueDescriptor = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    ),
    indexDescriptor = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "selectedIndex",
    );
  const instances = new WeakMap();
  let openInstance = null,
    counter = 0;

  function labelTextOf(select) {
    const own = select.getAttribute("aria-label");
    if (own) return own;
    const label = select.closest("label");
    if (!label) return "";
    const clone = label.cloneNode(true);
    clone.querySelectorAll(".rev-dd").forEach((n) => n.remove());
    return clone.textContent.trim();
  }

  function create(select) {
    const id = `rev-dd-${++counter}`;
    const root = document.createElement("div");
    root.className = "rev-dd";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "rev-dd-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `${id}-list`);
    const text = document.createElement("span");
    text.className = "rev-dd-value";
    trigger.append(text);
    const menu = document.createElement("ul");
    menu.className = "rev-dd-menu";
    menu.id = `${id}-list`;
    menu.setAttribute("role", "listbox");
    menu.tabIndex = -1;

    // 트리거를 select보다 앞에 두면 <label> 클릭이 트리거로 연결된다.
    select.replaceWith(root);
    root.append(trigger, select, menu);
    select.classList.add("rev-dd-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const inst = {
      id,
      select,
      root,
      trigger,
      text,
      menu,
      options: [],
      active: -1,
      isOpen: false,
      typed: "",
      typedTimer: 0,
    };
    instances.set(select, inst);
    build(inst);
    bind(inst);
    return inst;
  }

  function build(inst) {
    const { select, menu } = inst;
    const previous = inst.options.length;
    inst.options = [...select.options].map((option, index) => {
      const item = document.createElement("li");
      item.className = "rev-dd-option";
      item.id = `${inst.id}-o${index}`;
      item.setAttribute("role", "option");
      item.textContent = option.textContent;
      item.dataset.index = String(index);
      return { option, item };
    });
    menu.replaceChildren(...inst.options.map((o) => o.item));
    inst.active = -1;
    paint(inst);
    if (inst.isOpen && !previous && !inst.options.length) close(inst);
  }

  function paint(inst) {
    const { select, trigger, text, options } = inst;
    const selected = select.selectedIndex;
    const current = options[selected];
    text.textContent = current ? current.option.textContent : "";
    const name = labelTextOf(select);
    if (name) trigger.setAttribute("aria-label", name);
    else trigger.removeAttribute("aria-label");
    trigger.disabled = select.disabled;
    inst.root.classList.toggle("is-disabled", select.disabled);
    options.forEach(({ option, item }, index) => {
      const on = index === selected;
      item.setAttribute("aria-selected", String(on));
      item.classList.toggle("is-selected", on);
      item.classList.toggle("is-disabled", option.disabled);
      item.setAttribute("aria-disabled", String(option.disabled));
      item.classList.toggle("is-active", index === inst.active);
    });
    if (inst.active >= 0 && options[inst.active])
      trigger.setAttribute("aria-activedescendant", options[inst.active].item.id);
    else trigger.removeAttribute("aria-activedescendant");
  }

  function setActive(inst, index, scroll = true) {
    inst.active = index;
    paint(inst);
    const entry = inst.options[index];
    if (!entry || !scroll) return;
    const { menu } = inst,
      top = entry.item.offsetTop,
      bottom = top + entry.item.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = bottom - menu.clientHeight;
  }

  const enabled = (inst, index) =>
    index >= 0 && index < inst.options.length && !inst.options[index].option.disabled;

  function step(inst, from, direction) {
    for (let i = from + direction; i >= 0 && i < inst.options.length; i += direction)
      if (enabled(inst, i)) return i;
    return from;
  }

  // 화면 밖으로 잘리지 않도록 position:fixed로 배치하고, 공간이 부족하면 위로 뒤집는다.
  function place(inst) {
    const { trigger, menu } = inst,
      gap = 4,
      pad = 8,
      rect = trigger.getBoundingClientRect(),
      vw = document.documentElement.clientWidth,
      vh = window.innerHeight;
    menu.style.minWidth = `${rect.width}px`;
    menu.style.maxWidth = `${Math.min(360, vw - pad * 2)}px`;
    menu.style.maxHeight = "none";
    const natural = menu.scrollHeight + 2,
      below = vh - rect.bottom - gap - pad,
      above = rect.top - gap - pad,
      flip = natural > below && above > below,
      room = Math.max(96, flip ? above : below),
      height = Math.min(natural, 336, room);
    menu.style.maxHeight = `${height}px`;
    const width = menu.offsetWidth;
    const left = Math.max(pad, Math.min(rect.left, vw - width - pad));
    menu.style.left = `${left}px`;
    menu.style.top = flip
      ? `${Math.max(pad, rect.top - gap - height)}px`
      : `${rect.bottom + gap}px`;
    menu.classList.toggle("is-above", flip);
  }

  const onReposition = (event) => {
    if (!openInstance) return;
    if (event?.target instanceof Node && openInstance.menu.contains(event.target)) return;
    place(openInstance);
  };
  const onOutside = (event) => {
    if (openInstance && !openInstance.root.contains(event.target)) close(openInstance);
  };

  function open(inst) {
    if (inst.isOpen || inst.select.disabled || !inst.options.length) return;
    if (openInstance) close(openInstance);
    build(inst);
    inst.isOpen = true;
    openInstance = inst;
    inst.root.classList.add("is-open");
    inst.trigger.setAttribute("aria-expanded", "true");
    const selected = inst.select.selectedIndex;
    setActive(inst, enabled(inst, selected) ? selected : step(inst, -1, 1), false);
    place(inst);
    inst.menu.classList.add("is-open");
    setActive(inst, inst.active);
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
  }

  function close(inst, focus = false) {
    if (!inst.isOpen) return;
    inst.isOpen = false;
    if (openInstance === inst) openInstance = null;
    inst.root.classList.remove("is-open");
    inst.menu.classList.remove("is-open");
    inst.trigger.setAttribute("aria-expanded", "false");
    inst.active = -1;
    paint(inst);
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("scroll", onReposition, true);
    window.removeEventListener("resize", onReposition);
    if (focus) inst.trigger.focus();
  }

  function choose(inst, index) {
    if (!enabled(inst, index)) return;
    const changed = inst.select.selectedIndex !== index;
    indexDescriptor.set.call(inst.select, index);
    paint(inst);
    close(inst, true);
    if (changed) {
      inst.select.dispatchEvent(new Event("input", { bubbles: true }));
      inst.select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function typeahead(inst, key) {
    clearTimeout(inst.typedTimer);
    inst.typed += key.toLowerCase();
    inst.typedTimer = setTimeout(() => (inst.typed = ""), 600);
    const from = inst.isOpen ? inst.active : inst.select.selectedIndex,
      size = inst.options.length,
      needle = inst.typed,
      startAt = needle.length > 1 ? from : from + 1;
    for (let n = 0; n < size; n++) {
      const i = (startAt + n) % size;
      if (
        enabled(inst, i) &&
        inst.options[i].option.textContent.trim().toLowerCase().startsWith(needle)
      ) {
        if (inst.isOpen) setActive(inst, i);
        else choose(inst, i);
        return;
      }
    }
  }

  // form.reset()은 값을 바꾸고도 change를 내지 않으므로, 폼 안의 모든 드롭다운 표시를 다시 맞춘다.
  const watched = new WeakSet();
  function repaintForm(form) {
    for (const element of form.elements) {
      const inst = element instanceof HTMLSelectElement && instances.get(element);
      if (inst) paint(inst);
    }
  }
  function watchForm(form) {
    if (!form || watched.has(form)) return;
    watched.add(form);
    const original = form.reset;
    form.reset = function () {
      original.call(this);
      repaintForm(this);
    };
    // 사용자가 누르는 reset 버튼: 값 복원은 이벤트 처리 직후에 일어난다.
    form.addEventListener("reset", () => setTimeout(() => repaintForm(form), 0));
  }

  function bind(inst) {
    const { select, trigger, menu } = inst;
    trigger.addEventListener("click", () => (inst.isOpen ? close(inst) : open(inst)));
    trigger.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key;
      if (!inst.isOpen) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
          event.preventDefault();
          open(inst);
        } else if (key.length === 1 && key !== " ") typeahead(inst, key);
        return;
      }
      switch (key) {
        case "ArrowDown":
          event.preventDefault();
          setActive(inst, step(inst, inst.active, 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setActive(inst, step(inst, inst.active, -1));
          break;
        case "Home":
          event.preventDefault();
          setActive(inst, step(inst, -1, 1));
          break;
        case "End":
          event.preventDefault();
          setActive(inst, step(inst, inst.options.length, -1));
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          choose(inst, inst.active);
          break;
        case "Escape":
          // dialog가 함께 닫히지 않도록 드롭다운만 닫는다.
          event.preventDefault();
          event.stopPropagation();
          close(inst, true);
          break;
        case "Tab":
          close(inst);
          break;
        default:
          if (key.length === 1) typeahead(inst, key);
      }
    });
    // <label> 안에 있으므로 메뉴 클릭이 label 활성화로 트리거를 다시 토글하지 않게 막는다.
    menu.addEventListener("click", (event) => {
      event.preventDefault();
      const item = event.target.closest(".rev-dd-option");
      if (item) choose(inst, Number(item.dataset.index));
    });
    menu.addEventListener("mousemove", (event) => {
      const item = event.target.closest(".rev-dd-option");
      if (!item) return;
      const index = Number(item.dataset.index);
      if (index !== inst.active && enabled(inst, index)) setActive(inst, index, false);
    });
    menu.addEventListener("mouseleave", () => {
      if (inst.isOpen) setActive(inst, inst.select.selectedIndex, false);
    });
    menu.addEventListener("pointerdown", (event) => event.preventDefault());

    // 코드에서 바꾼 값(select.value = ..., form.reset(), 옵션 갱신)도 화면에 반영한다.
    Object.defineProperty(select, "value", {
      configurable: true,
      get() {
        return valueDescriptor.get.call(this);
      },
      set(next) {
        valueDescriptor.set.call(this, next);
        paint(inst);
      },
    });
    Object.defineProperty(select, "selectedIndex", {
      configurable: true,
      get() {
        return indexDescriptor.get.call(this);
      },
      set(next) {
        indexDescriptor.set.call(this, next);
        paint(inst);
      },
    });
    select.addEventListener("change", () => paint(inst));
    select.addEventListener("invalid", () => trigger.focus());
    watchForm(select.form);
    new MutationObserver(() => {
      if (inst.pending) return;
      inst.pending = true;
      queueMicrotask(() => {
        inst.pending = false;
        build(inst);
        if (inst.isOpen) place(inst);
      });
    }).observe(select, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "label", "value", "aria-label"],
    });
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement)) return null;
    if (select.multiple || select.size > 1 || "native" in select.dataset) return null;
    return instances.get(select)?.select ? select : (create(select), select);
  }

  function enhanceAll(root = document) {
    root.querySelectorAll?.("select").forEach(enhance);
    if (root instanceof HTMLSelectElement) enhance(root);
  }

  function observe(root = document.body) {
    enhanceAll(root);
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof Element) enhanceAll(node);
    }).observe(root, { childList: true, subtree: true });
  }

  function refresh(select) {
    const inst = instances.get(select);
    if (!inst) return;
    build(inst);
  }

  return { enhance, enhanceAll, observe, refresh };
})();

// 부품장터처럼 body에 data-rev-dropdown이 있는 페이지는 모든 select(동적 생성 포함)를 자동 변환한다.
if (document.body?.hasAttribute("data-rev-dropdown")) RevDropdown.observe(document.body);
