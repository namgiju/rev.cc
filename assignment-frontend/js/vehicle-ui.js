// Shared existing vehicle detail/edit/photo/record UI for community and My Garage.
window.createVehicleUI = function ({$, state, api, el, on, button, photo, memberLink, requireLogin, openDialog, closeDetail, confirmDelete, uploadFile, renderPreviews, refreshGarage, isMyGaragePage, recordLabels}) {
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
  if (isMyGaragePage() && state.authStatus !== "AUTHENTICATED") return;
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

return {vehicleForm, openCar};
};
