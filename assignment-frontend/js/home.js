// /home is the personal garage for every signed-in member, including ADMIN.
const $ = selector => document.querySelector(selector);
const state = {user:null, authStatus:"CHECKING", sessionRequest:0, garageRequest:0,
  detailRequest:0, activityRequest:0, profile:null, profileRequest:0, activity:"mine", page:1, vehicleEditing:null, vehicleImage:null};
const recordLabels = {maintenance:"정비", tuning:"튜닝", parts:"부품"};
const dateText = value => new Date(value).toLocaleDateString("ko-KR");
const imageUrl = id => `/api/board/images/${Number(id)}`;
function el(tag, text = "", className = "") {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notify(message) {
  $("#notice").textContent = message;
  document.querySelectorAll(".dialog-notice").forEach(node => node.remove());
  const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
  if (dialog) dialog.prepend(el("p", message, "dialog-notice"));
}
async function api(path, body, method) {
  const response = await fetch(path, {credentials:"same-origin", cache:"no-store",
    method:method || (body === undefined ? "GET" : "POST"),
    ...(body === undefined ? {} : {headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)})});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) signedOut();
    throw Object.assign(new Error(data.message || `요청 실패 (${response.status})`), {status:response.status});
  }
  return data;
}
const coreApi = (path, options = {}) => api(path, options.body, options.method);
function requireLogin() {
  if (state.authStatus === "AUTHENTICATED" && state.user) return true;
  notify("내 차고를 이용하려면 로그인이 필요합니다.");
  return false;
}
function openDialog(dialog) { if (!dialog.open) dialog.showModal(); }
function closeDetail() {
  state.detailRequest++;
  $("#detail-dialog").close();
  history.replaceState(null, "", location.pathname + location.search);
}
// 탈퇴 회원은 id가 없다("탈퇴한 회원"). 프로필이 없으므로 링크 없이 이름만 보여 준다.
const memberLink = (id, name) => id == null ? el("span", name, "owner-link member-withdrawn") : link(name, `/#member-${id}`, "owner-link");
const isMyGaragePage = () => true;
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

function clearPrivateUI() {
  state.detailRequest++;
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  for (const id of ["detail-content", "panel-content", "vehicle-preview", "home-posts", "home-profile", "owned-vehicles", "home-badge-list", "home-guestbook"])
    $("#" + id).replaceChildren();
  $("#member-content").hidden = true;
  for(const id of ["home-profile","owned-panel","home-badges","home-guestbook","edit-profile","withdraw-account"]) $("#"+id).hidden=true;
  $("#home-user").textContent = "";
  $("#admin-link").hidden = true;
  $("#logout").hidden = true;
  $("#home-add-vehicle").hidden = true;
  $("#activity-more").hidden = true;
  $("#vehicle-form").reset();
  $("#vehicle-info-form").reset();
  $("#vehicle-document-form").reset();
  state.vehicleEditing = null; state.vehicleImage = null; pendingVehicleId = null;
}
function signedOut() {
  state.sessionRequest++; state.garageRequest++; state.activityRequest++;
  state.profileRequest++; state.profile=null;
  state.user = null; state.authStatus = "NOT_AUTHENTICATED";
  clearPrivateUI();
  $("#home-login").hidden = false;
  renderGarageState("NOT_AUTHENTICATED");
}
function renderGarageState(status, vehicles = []) {
  const target = $("#home-garage");
  target.dataset.state = status;
  target.replaceChildren();
  $("#home-add-vehicle").hidden = status !== "HAS_VEHICLE";
  if (status === "NOT_AUTHENTICATED") {
    target.append(el("p", "내 차고를 이용하려면 로그인이 필요합니다.", "empty"),
      link("로그인하기", "/login", "primary"));
  } else if (status === "EMPTY_GARAGE") {
    const empty = el("div", "", "garage-empty");
    empty.append(el("h2", "아직 등록된 차량이 없습니다."),
      el("p", "내 차량을 등록하고 REV.CC의 오너 기능을 이용해보세요."),
      button("차량 등록하기", openRegistration, "primary"));
    target.append(empty);
  } else if (status === "HAS_VEHICLE") {
    const representative = state.profile?.representativeVehicle?.id;
    const vehicle = vehicles.find(v=>v.id===representative) || vehicles[0];
    const card = el("article", "", "home-vehicle-card");
    const publicVehicle = state.profile?.vehicles.find(v=>v.id===vehicle.id);
    if(publicVehicle?.imageId) card.append(photo(publicVehicle.imageId,vehicle.model,"representative-photo"));
    const info=el("div");
    info.append(el("p",vehicle.manufacturer,"eyebrow"),el("h2",vehicle.nickname||vehicle.model),
      el("p",[vehicle.modelYear,vehicle.trim].filter(Boolean).join(" · ")));
    const status = vehicle.verified ? ["인증 완료", "ok"] :
      ({PENDING:["인증 검토 중", "pending"], REJECTED:["인증 반려", "blocked"]}[vehicle.verificationStatus] || ["인증 전", "pending"]);
    info.append(el("span",status[0],`status-chip ${status[1]}`));
    if(vehicle.description)info.append(el("p",vehicle.description));
    const actions=el("div","","detail-actions");
    actions.append(link("차량 상세",`#car-${vehicle.id}`,"secondary"),button("수정",()=>editVehicle(vehicle.id)),
      link("정비 기록",`#car-${vehicle.id}`,"secondary"));
    if(!vehicle.verified && vehicle.verificationStatus!=="PENDING")actions.append(button(vehicle.verificationStatus==="REJECTED"?"인증 재신청":"오너 인증 신청",()=>openDocumentStep(vehicle.id)));
    info.append(actions);card.append(info);target.append(card);
  } else if (status === "ERROR") {
    target.append(el("p", "차고 정보를 불러오지 못했어요. 다시 확인해주세요.", "empty"), button("다시 시도", initialize));
  } else target.append(el("p", "로그인 및 차고 정보를 확인하고 있어요.", "empty"));
}
async function refreshGarage() {
  if (state.authStatus !== "AUTHENTICATED") return;
  const request = ++state.garageRequest, userId = state.user.id;
  renderGarageState("LOADING");
  try {
    const [vehicles,member] = await Promise.all([api("/api/garage/vehicles"),api(`/api/board/members/${userId}`)]);
    if (request !== state.garageRequest || userId !== state.user?.id) return;
    state.profile=member;
    renderGarageState(vehicles.length ? "HAS_VEHICLE" : "EMPTY_GARAGE", vehicles);
    renderMyProfile(member,vehicles);
  } catch (error) {
    if (request === state.garageRequest) renderGarageState("ERROR");
  }
}
async function editVehicle(id) {
  const userId=state.user?.id;
  const vehicle=await api(`/api/board/garage/${id}`);
  if(state.user?.id===userId && state.authStatus==="AUTHENTICATED")vehicleForm(vehicle);
}
function renderMyProfile(member,vehicles) {
  $("#home-profile").replaceChildren(memberProfileCard(member));
  for(const id of ["home-profile","owned-panel","home-badges","edit-profile","withdraw-account"])$("#"+id).hidden=false;
  const owned=$("#owned-vehicles");owned.replaceChildren();
  for(const vehicle of vehicles){
    const row=el("article","","owned-vehicle");row.dataset.vehicleId=vehicle.id;
    const publicVehicle=member.vehicles.find(v=>v.id===vehicle.id);
    const title=link("",`#car-${vehicle.id}`,"context-vehicle-row");
    if(publicVehicle?.imageId)title.append(photo(publicVehicle.imageId,vehicle.model));
    const info=el("div");info.append(el("strong",vehicle.model),el("p",[vehicle.modelYear,vehicle.trim].filter(Boolean).join(" · "),"context-muted"));title.append(info);row.append(title);
    const selected=member.representativeVehicle?.id===vehicle.id;
    const choose=button(selected?"대표 차량":"대표 차량 설정",async()=>{await api("/api/board/profile/representative-vehicle",{vehicleId:vehicle.id},"PUT");await refreshGarage();},"text-link");
    choose.disabled=selected;
    row.append(choose,button("수정",()=>editVehicle(vehicle.id),"text-link"));owned.append(row);
  }
  if(!vehicles.length)owned.append(el("p","등록된 차량이 없습니다.","context-muted"));
  $("#home-add-vehicle").hidden=false;
  const badges=$("#home-badge-list");badges.replaceChildren(...member.badges.map(b=>authorBadge(b)));
  if(!member.badges.length)badges.append(el("p","아직 획득한 인장이 없습니다. 차량 인증을 완료하면 오너 인장이 표시됩니다.","context-muted"));
}
function editProfile() {
  if(!requireLogin()||!state.profile)return;
  const userId=state.user.id, member=state.profile;
  const root=$("#panel-content");root.replaceChildren();$("#panel-title").textContent="프로필 수정";
  const form=el("form","","dialog-form"), bio=document.createElement("textarea");bio.name="bio";bio.maxLength=300;bio.value=member.bio||"";
  const label=el("label","한 줄 소개");label.append(bio);form.append(label);
  const fields=[];
  for(const [name,title,id] of [["avatarImageId","프로필 이미지",member.avatarImageId],["coverImageId","커버 이미지",member.coverImageId]]){
    const group=el("label",title),input=document.createElement("input");input.type="file";input.accept="image/jpeg,image/png,image/webp";input.name=name;
    const remove=document.createElement("input");remove.type="checkbox";const removeLabel=el("label","기존 이미지 제거");removeLabel.prepend(remove);
    group.append(input);form.append(group,removeLabel);fields.push({name,input,remove,id});
  }
  const submit=el("button","프로필 저장","primary");submit.type="submit";form.append(submit);
  on(form,"submit",async event=>{
    event.preventDefault();submit.disabled=true;
    try{
      const body={bio:bio.value};
      for(const field of fields)body[field.name]=field.input.files[0]?await uploadFile(field.input.files[0]):field.remove.checked?null:field.id??null;
      if(state.user?.id!==userId || state.authStatus!=="AUTHENTICATED")return;
      await api("/api/board/profile",body,"PUT");$("#panel-dialog").close();await refreshGarage();
    }finally{submit.disabled=false;}
  });root.append(form);openDialog($("#panel-dialog"));
}
// 회원 탈퇴(STEP 10-impl-C). 서버가 비밀번호를 다시 확인하고 한 번에 처리한다. 카카오 계정은 카카오 재인증 탈퇴(STEP 10-impl-D)가
// 준비될 때까지 안내만 보여 준다(버튼 없음). 예약중 매물·관리자 권한 등 서버의 거부 사유는 그대로 보여 준다.
async function withdrawAccount() {
  if(!requireLogin())return;
  const userId=state.user.id;
  const root=$("#panel-content");root.replaceChildren();$("#panel-title").textContent="회원 탈퇴";
  let info;
  try{info=await api("/api/auth/withdraw");}catch(e){notify(e.message);return;}
  if(state.user?.id!==userId)return;
  const notice=el("div","","withdraw-notice");
  for(const line of["탈퇴하면 되돌릴 수 없고, 같은 아이디·이메일로는 30일 동안 다시 가입할 수 없습니다.",
    "작성한 글과 댓글은 남고 작성자는 \"탈퇴한 회원\"으로 표시됩니다.",
    "내 차고(차량·정비기록·자동차등록증)와 프로필, 좋아요·북마크·찜·알림은 삭제됩니다.",
    "판매중 매물은 비공개로 닫히고, 판매완료 매물은 연락처만 지워진 채 남습니다."])notice.append(el("p",line));
  root.append(notice);
  const message=el("p","","danger-text");
  if(info.admin)message.textContent="관리자 권한을 먼저 해제해야 탈퇴할 수 있습니다.";
  else if(info.reservedListings>0)message.textContent=`예약중인 매물이 ${info.reservedListings}개 있습니다. 거래를 마치거나 판매중으로 바꾼 뒤 탈퇴해주세요.`;
  else if(info.method==="KAKAO")message.textContent="카카오 계정은 카카오 재인증으로 탈퇴해야 합니다. 이 기능은 아직 준비 중입니다.";
  else if(!info.available)message.textContent="지금은 회원 탈퇴를 처리할 수 없습니다. 관리자에게 문의해주세요.";
  if(message.textContent){root.append(message);openDialog($("#panel-dialog"));return;}
  const form=el("form","","dialog-form"),password=document.createElement("input");
  password.type="password";password.name="password";password.autocomplete="current-password";password.required=true;password.maxLength=255;
  const passwordLabel=el("label","현재 비밀번호");passwordLabel.append(password);
  const confirm=document.createElement("input");confirm.type="checkbox";confirm.required=true;
  const confirmLabel=el("label","위 내용을 확인했고 탈퇴에 동의합니다.");confirmLabel.prepend(confirm);
  const submit=el("button","회원 탈퇴","danger");submit.type="submit";
  form.append(passwordLabel,confirmLabel,message,submit);
  on(form,"submit",async event=>{
    event.preventDefault();submit.disabled=true;message.textContent="";
    try{
      await api("/api/auth/withdraw",{password:password.value,confirm:confirm.checked});
      password.value="";$("#panel-dialog").close();signedOut();
      notify("회원 탈퇴가 완료되었습니다.");location.assign("/");
    }catch(e){message.textContent=e.message;password.value="";}
    finally{submit.disabled=false;}
  });
  root.append(form);openDialog($("#panel-dialog"));password.focus();
}
const {vehicleForm, openCar} = createVehicleUI({$, state, api, el, on, button, photo, memberLink,
  requireLogin, openDialog, closeDetail, confirmDelete, uploadFile, renderPreviews, refreshGarage,
  isMyGaragePage, recordLabels});

async function refreshActivity(append = false) {
  if (state.authStatus !== "AUTHENTICATED") return;
  const request = ++state.activityRequest, userId = state.user.id, scope = state.activity;
  const page = append ? state.page + 1 : 1;
  const target = $("#home-posts");
  $("#activity-list-title").textContent = {mine:"내가 쓴 글", commented:"내가 댓글 단 글", notifications:"내 활동 알림"}[scope];
  document.querySelectorAll("[data-activity]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.activity === scope)));
  $("#activity-more").hidden = true;
  if (!append) target.replaceChildren(el("p", "내 활동을 불러오고 있어요.", "empty"));
  try {
    const items = await api(scope === "notifications" ? "/api/board/notifications" :
      `/api/board/posts?scope=${scope}&sort=latest&limit=20&page=${page}`);
    if (request !== state.activityRequest || userId !== state.user?.id) return;
    if (!append) target.replaceChildren();
    if (!items.length && !append) target.append(el("p", {
      mine:"아직 작성한 글이 없습니다.", commented:"아직 댓글을 남긴 글이 없습니다.", notifications:"아직 받은 활동 알림이 없습니다."
    }[scope], "empty"));
    items.forEach(item => {
      const row = el("article", "", "personal-post-row");
      row.append(link(item.title, getPostUrl(scope === "notifications" ? {id:item.postId, category:item.category} : item)));
      row.append(el("small", scope === "notifications" ? `${item.username} 님의 댓글 · ${dateText(item.createdAt)}` :
        `${item.username} · ${dateText(item.createdAt)} · 댓글 ${item.commentCount} · 추천 ${item.likeCount}`));
      target.append(row);
    });
    state.page = page;
    $("#activity-more").hidden = scope === "notifications" || items.length < 20;
  } catch (error) {
    if (request !== state.activityRequest) return;
    if (!append) target.replaceChildren();
    target.append(el("p", "내 활동을 불러오지 못했어요.", "empty"), button("활동 다시 확인", () => refreshActivity()));
  }
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
  if (!requireLogin()) return;
  pendingVehicleId = null;
  $("#vehicle-dialog-title").textContent = "내 차 등록";
  $("#vehicle-step-info").hidden = false;
  $("#vehicle-step-document").hidden = true;
  $("#vehicle-info-form").reset();
  openDialog($("#registration-dialog"));
}

function openDocumentStep(vehicleId) {
  if (!requireLogin()) return;
  pendingVehicleId = vehicleId;
  $("#vehicle-dialog-title").textContent = "오너 인증 신청";
  $("#vehicle-step-info").hidden = true;
  $("#vehicle-step-document").hidden = false;
  $("#vehicle-document-form").reset();
  openDialog($("#registration-dialog"));
}

document.querySelectorAll("#registration-dialog [data-close]").forEach((button) =>
  button.addEventListener("click", () => $("#registration-dialog").close()),
);

$("#vehicle-info-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireLogin()) return;
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
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
    await refreshGarage();
    openDocumentStep(vehicle.id);
  } catch (e) {
    notify(e.message || "차량 등록에 실패했어요.");
  } finally { submit.disabled = false; }
});

$("#vehicle-skip-document").addEventListener("click", () => {
  $("#registration-dialog").close();
  notify("차량이 등록되었어요. 준비되면 차고에서 오너 인증을 신청해주세요.");
  void initialize();
});

$("#vehicle-document-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireLogin()) return;
  const file = $("#vehicle-document-input").files[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
    notify("JPG, PNG, WebP 사진을 3MB 이하로 선택해주세요.");
    return;
  }
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const data = await readFileAsDataUrl(file);
    await coreApi(`/api/garage/vehicles/${pendingVehicleId}/verification`, { body: { data } });
    $("#registration-dialog").close();
    notify("오너 인증을 신청했어요. 관리자 검토 후 결과를 알려드릴게요.");
    void initialize();
  } catch (e) {
    notify(e.message || "인증 신청에 실패했어요.");
  } finally { submit.disabled = false; }
});


async function route() {
  if (state.authStatus !== "AUTHENTICATED") return;
  const match = /^#(car|member|post)-(\d+)$/.exec(location.hash);
  if (!match) { state.detailRequest++; $("#detail-dialog").close(); return; }
  if (match[1] !== "car") { location.replace("/" + location.hash); return; }
  try { await openCar(Number(match[2])); }
  catch (error) { if (state.user) notify(error.message); }
}
async function initialize() {
  const request = ++state.sessionRequest, previousId = state.user?.id;
  state.garageRequest++; state.activityRequest++; state.profileRequest++;
  state.authStatus = "CHECKING";
  renderGarageState("CHECKING");
  $("#member-content").hidden = true;
  for(const id of ["home-profile","owned-panel","home-badges","home-guestbook","edit-profile","withdraw-account"]) $("#"+id).hidden=true;
  let user;
  try { user = await api("/api/auth/me"); }
  catch (error) {
    if (request !== state.sessionRequest) return;
    clearPrivateUI(); state.profileRequest++; state.profile=null;
  state.user = null; state.authStatus = "ERROR";
    renderGarageState("ERROR"); return;
  }
  if (request !== state.sessionRequest) return;
  if (previousId !== user.id) clearPrivateUI();
  state.user = user; state.authStatus = "AUTHENTICATED";
  $("#home-login").hidden = true; $("#logout").hidden = false;
  renderManagementNav(user);
  $("#home-user").textContent = `${user.username} 님`;
  $("#member-content").hidden = false;
  const profileTicket=++state.profileRequest;
  $("#home-guestbook").hidden=false;
  await Promise.all([refreshGarage(), refreshActivity(),renderGuestbook($("#home-guestbook"),user.id,
    {current:()=>profileTicket===state.profileRequest && state.user?.id===user.id && state.authStatus==="AUTHENTICATED"})]);
  if (request === state.sessionRequest) await route();
}
on($("#edit-profile"), "click", editProfile);
on($("#withdraw-account"), "click", withdrawAccount);
on($("#home-add-vehicle"), "click", openRegistration);
on($("#activity-more"), "click", () => refreshActivity(true));
document.querySelectorAll("[data-activity]").forEach(button => on(button, "click", () => {
  state.activity = button.dataset.activity; return refreshActivity();
}));
on($("#logout"), "click", async () => { await api("/api/auth/logout", {}); signedOut(); });
document.querySelectorAll("dialog:not(#registration-dialog) [data-close]").forEach(button => on(button, "click", () => {
  const dialog = button.closest("dialog"); if (dialog.id === "detail-dialog") closeDetail(); else dialog.close();
}));
on($("#detail-dialog"), "cancel", event => {event.preventDefault(); closeDetail();});
on($("#detail-dialog"), "click", event => {
  const dialog = event.currentTarget;
  const rect = dialog.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
    event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) { if (dialog.id === "detail-dialog") closeDetail(); else dialog.close(); }
});
on(window, "hashchange", route);
on(window, "focus", () => initialize());
on(window, "pageshow", event => {if (event.persisted) return initialize();});
initialize().catch(error => notify(error.message));
