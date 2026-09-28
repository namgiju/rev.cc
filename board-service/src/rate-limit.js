// 인메모리 고정 윈도우(fixed window) rate limiter. board-service 인스턴스가 하나뿐인 현재 배포
// 구조를 전제로 하며, 여러 인스턴스로 수평 확장하면 Redis 등 공유 저장소로 교체해야 한다.
export function rateLimiter({ windowMs, max, message }) {
  const hits = new Map(); // key -> {count, resetAt}
  return (req, res, next) => {
    // 대상 라우터는 모두 auth 미들웨어 뒤에 붙어 req.user가 항상 채워져 있으므로
    // 계정 단위로 제한한다(프록시 뒤에서 IP가 뭉치는 문제와 무관하다).
    const key = req.user ? `u:${req.user.id}` : `ip:${req.ip}`;
    const now = Date.now();
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
}
