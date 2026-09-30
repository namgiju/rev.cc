// 인메모리 고정 윈도우(fixed window) rate limiter. board-service 인스턴스가 하나뿐인 현재 배포
// 구조를 전제로 하며, 여러 인스턴스로 수평 확장하면 Redis 등 공유 저장소로 교체해야 한다.
// 만료된 윈도는 윈도 길이마다 한 번씩 정리해 사용자·IP 수만큼 메모리가 계속 늘지 않게 한다.
// by: "user"(기본)는 로그인 사용자면 계정 단위, 아니면 IP 단위. "ip"는 로그인 여부와 관계없이 IP 단위.
export function rateLimiter({ windowMs, max, message, by = "user", now: clock = Date.now }) {
  const hits = new Map(); // key -> {count, resetAt}
  let nextSweepAt = clock() + windowMs;
  const limiter = (req, res, next) => {
    // 쓰기 라우터는 auth 미들웨어 뒤에 붙어 req.user가 항상 채워져 있으므로 계정 단위로 제한한다.
    // req.ip는 trust proxy 1 + nginx가 덮어쓴 X-Forwarded-For로 정해지는 실제 클라이언트 주소다(STEP 5-A).
    const key = by === "user" && req.user ? `u:${req.user.id}` : `ip:${req.ip}`;
    const now = clock();
    if (now >= nextSweepAt) {
      for (const [k, stale] of hits) if (now > stale.resetAt) hits.delete(k);
      nextSweepAt = now + windowMs;
    }
    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res
        .status(429)
        .json({ message: message ?? "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
    }
    next();
  };
  limiter.bucketCount = () => hits.size;
  return limiter;
}
