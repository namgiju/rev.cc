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
function memberProfileCard(member) {
  // The caller supplies the subject: current user on /home, post.authorId on details.
  const card = el("section", "", "context-card");
  card.append(el("h3", "작성자"));
  card.classList.add("author-profile-card");
  card.firstElementChild.classList.add("author-card-title");
  const representative = member.representativeVehicle;
  if (member.coverImageId || representative?.imageId) {
    const cover = photo(member.coverImageId || representative.imageId, member.coverImageId ? "프로필 커버" : `작성자의 차량 · ${representative.model}`, "author-vehicle-cover");
    card.prepend(cover);
    card.classList.add("has-vehicle-cover");
  }
  const identity = el("div", "", "author-identity");
  const avatar = el("div", [...member.username][0] || "", "author-avatar");
  avatar.setAttribute("aria-label", "프로필 사진 미등록");
  if (member.avatarImageId) { avatar.replaceChildren(photo(member.avatarImageId,member.username)); avatar.removeAttribute("aria-label"); }
  identity.append(avatar, memberLink(member.id, member.username));
  if (representative) identity.append(el("p", representative.model, "author-car-name"));
  if (member.verified) identity.append(el("span", "✓ 오너 인증 완료", "author-verification"));
  if (member.bio) identity.append(el("p",member.bio,"context-muted"));
  card.append(identity);
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
        [vehicle.year, vehicle.model, vehicle.trim, vehicle.verified ? "인증" : ""].filter(Boolean).join(" · "),
        "context-muted",
      ),
    );
    row.append(info);
    cars.append(row);
  }
  if (!member.vehicles.length)
    cars.append(el("p", "등록한 차량이 없어요.", "context-muted"));
  card.append(cars);
  return card;
}
