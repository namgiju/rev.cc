// Same representative-vehicle lookup and auth states for community and marketplace.
function createMyGarageCard({ root, api, getUser, el, link, photo, button }) {
  let ticket = 0;
  return async function refresh() {
    const request = ++ticket,
      user = getUser();
    root.replaceChildren();
    const current = () => request === ticket && getUser()?.id === user?.id;
    if (!user) {
      root.dataset.state = "NOT_AUTHENTICATED";
      root.append(
        el("p", "로그인하고 나의 차량을 만나보세요.", "context-muted"),
        link("로그인하기", "/login", "text-link"),
      );
      return;
    }
    root.dataset.state = "LOADING";
    root.append(el("p", "내 차량을 확인하고 있어요.", "context-muted"));
    try {
      const member = await api(`/api/board/members/${user.id}`);
      if (!current()) return;
      root.replaceChildren();
      const vehicle = member.representativeVehicle || member.vehicles[0];
      root.dataset.state = vehicle ? "HAS_VEHICLE" : "EMPTY_GARAGE";
      if (vehicle) {
        if (vehicle.imageId)
          root.append(
            photo(vehicle.imageId, vehicle.model, "community-garage-photo"),
          );
        root.append(
          el(
            "strong",
            [vehicle.manufacturer, vehicle.model].filter(Boolean).join(" "),
          ),
          el(
            "p",
            [vehicle.year, vehicle.trim].filter(Boolean).join(" · "),
            "context-muted",
          ),
        );
        if (vehicle.verified)
          root.append(el("span", "인증 오너", "author-verification"));
      } else
        root.append(el("p", "아직 등록된 차량이 없습니다.", "context-muted"));
      root.append(
        link(
          vehicle ? "내 차고 보기 →" : "내 차 등록하기 →",
          "/home",
          "community-garage-link",
        ),
      );
    } catch {
      if (current()) {
        root.dataset.state = "ERROR";
        root.replaceChildren(
          el("p", "차량 정보를 불러오지 못했어요.", "context-muted"),
          button("다시 확인", refresh, "text-link"),
        );
      }
    }
  };
}
