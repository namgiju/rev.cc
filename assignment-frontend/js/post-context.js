// 기존 상세 렌더러/액션과 독립적으로 보조 정보를 읽는다. 실패해도 본문은 유지한다.
let postContextRequest = 0;
function resetPostContext() {
  for (const selector of ["#post-author", "#post-related"])
    $(selector)?.replaceChildren(
      el("p", "정보를 불러오고 있어요.", "context-muted"),
    );
  return ++postContextRequest;
}
function contextCard(title) {
  const card = el("section", "", "context-card");
  card.append(el("h3", title));
  return card;
}
function authorBadge(badge, compact = false) {
  const item = el("div", "", `author-badge${compact ? " compact" : ""}`);
  // 현재 인증 인장에는 전용 이미지가 없으므로 기존 색상의 텍스트 표식을 쓴다.
  const mark = el("span", "✓", "badge-mark");
  mark.setAttribute("aria-hidden", "true");
  const text = el("div");
  text.append(el("strong", badge.name));
  if (!compact) text.append(el("p", badge.description, "context-muted"));
  else item.title = badge.description;
  item.append(mark, text);
  return item;
}
function renderAuthorContext(member) {
  const card = contextCard("작성자");
  const avatar = el("div", [...member.username][0] || "", "author-avatar");
  avatar.setAttribute("aria-label", "프로필 사진 미등록");
  card.append(avatar, memberLink(member.id, member.username));
  card.append(
    el(
      "p",
      member.verified ? "오너 인증 완료" : "인증된 차량 없음",
      "context-muted",
    ),
  );
  const representative = member.representativeVehicle;
  if (representative) {
    card.append(
      el(
        "p",
        `${representative.verified ? "인증 차량" : "등록 차량"} · ${representative.model}`,
        "author-car-name",
      ),
    );
  }
  const badges = el("div", "", "author-badge-list");
  member.badges
    .slice(0, 3)
    .forEach((badge) => badges.append(authorBadge(badge, true)));
  if (!member.badges.length)
    badges.append(el("p", "표시할 인장이 없어요.", "context-muted"));
  card.append(badges);
  const stats = el("dl", "", "author-stats");
  for (const [label, value] of [
    [
      "가입일",
      member.joinedAt
        ? new Date(member.joinedAt).toLocaleDateString("ko-KR")
        : "기록 없음",
    ],
    ["게시글", member.postCount],
    ["댓글", member.commentCount],
    ["받은 추천", member.receivedLikes],
  ]) {
    const row = el("div");
    row.append(el("dt", label), el("dd", String(value)));
    stats.append(row);
  }
  card.append(stats, el("h3", `보유 차량 ${member.vehicles.length}`));
  const cars = el("div", "", "author-cars");
  for (const vehicle of member.vehicles) {
    const row = link("", `#car-${vehicle.id}`, "context-vehicle-row");
    if (vehicle.imageId) row.append(photo(vehicle.imageId, vehicle.model));
    const info = el("div");
    info.append(
      el("strong", vehicle.nickname || vehicle.model),
      el(
        "p",
        `${vehicle.year} · ${vehicle.model}${vehicle.verified ? " · 인증" : ""}`,
        "context-muted",
      ),
    );
    row.append(info);
    cars.append(row);
  }
  if (!member.vehicles.length)
    cars.append(el("p", "등록한 차량이 없어요.", "context-muted"));
  card.append(cars);
  $("#post-author").replaceChildren(card);
  const section = $("#post-author-badges");
  const list = el("div", "", "author-badge-list");
  member.badges.slice(0, 3).forEach((badge) => list.append(authorBadge(badge)));
  if (!member.badges.length)
    list.append(el("p", "아직 표시할 인장이 없어요.", "context-muted"));
  section.replaceChildren(el("h3", "작성자의 인장"), list);
}
function renderRelatedPosts(card, posts, currentId) {
  const list = el("div", "", "context-posts");
  posts
    .filter((p) => p.id !== currentId)
    .slice(0, 5)
    .forEach((post) => {
      const row = link("", getPostUrl(post), "context-post-row");
      if (post.imageIds?.length) row.append(photo(post.imageIds[0], ""));
      const info = el("div");
      info.append(
        el("strong", post.title),
        el(
          "p",
          `${post.username} · 조회 ${post.views} · 추천 ${post.likeCount}`,
          "context-muted",
        ),
      );
      row.append(info);
      list.append(row);
    });
  if (!list.children.length)
    list.append(el("p", "아직 다른 글이 없어요.", "context-muted"));
  card.append(list);
}
async function renderPostContext(post, request) {
  const current = () => request === postContextRequest;
  const related = $("#post-related");
  related.replaceChildren();
  const vehicleCard = contextCard("관련 차종");
  const popularCard = contextCard("이 차종의 인기글");
  const latestCard = contextCard("같은 카테고리의 최신글");
  related.append(vehicleCard, popularCard, latestCard);
  // 최신글은 작성자 조회 결과와 관계없이 표시한다.
  const latest = api(
    `/api/board/posts?${new URLSearchParams({ category: post.category, sort: "latest", limit: "6" })}`,
  )
    .then((posts) => {
      if (current()) renderRelatedPosts(latestCard, posts, post.id);
    })
    .catch(() => {
      if (current())
        latestCard.append(
          el("p", "최신글을 불러오지 못했어요.", "context-muted"),
        );
    });
  let member = null;
  try {
    member = await api(`/api/board/members/${post.authorId}`);
    if (!current()) return;
    renderAuthorContext(member);
  } catch {
    if (!current()) return;
    $("#post-author").replaceChildren(
      el("p", "작성자 정보를 불러오지 못했어요.", "context-muted"),
    );
    $("#post-author-badges").replaceChildren(
      el("h3", "작성자의 인장"),
      el("p", "인장을 불러오지 못했어요.", "context-muted"),
    );
  }
  // 게시글의 명시적 차종을 우선한다. 다른 차량 사진을 연관 사진으로 사용하지 않는다.
  const model = post.vehicle || member?.representativeVehicle?.model || "";
  if (!model) {
    vehicleCard.append(el("p", "연결된 차종이 없어요.", "context-muted"));
    popularCard.append(
      el("p", "차종이 연결되면 관련 글을 볼 수 있어요.", "context-muted"),
    );
  } else {
    const matching = member?.vehicles.find((v) => v.model === model);
    vehicleCard.append(el("strong", model));
    if (matching?.imageId)
      vehicleCard.append(photo(matching.imageId, model, "context-car-photo"));
    vehicleCard.append(
      link(
        "차종 게시판 바로가기 →",
        `/community?vehicle=${encodeURIComponent(model)}`,
        "context-board-link",
      ),
    );
    try {
      const posts = await api(
        `/api/board/posts?${new URLSearchParams({ vehicle: model, sort: "popular", limit: "6" })}`,
      );
      if (current()) renderRelatedPosts(popularCard, posts, post.id);
    } catch {
      if (current())
        popularCard.append(
          el("p", "인기글을 불러오지 못했어요.", "context-muted"),
        );
    }
  }
  await latest;
}
