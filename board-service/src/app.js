import express from "express";
import morgan from "morgan";
import { communityRouter } from "./community.js";

// Spring과 동일한 쿠키 이름·토큰 형식·Redis 키를 사용한다. TTL은 로그인부터 30분이다.
export async function sessionUser(redis, cookie = "") {
  const token = cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("REVCC_SESSION="))
    ?.slice(14);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const value = await redis.get(`revcc:session:${token}`);
  if (!value) return null;
  try {
    const user = JSON.parse(value);
    return Number.isSafeInteger(user.id) && typeof user.username === "string"
      ? user
      : null;
  } catch {
    return null;
  }
}

// 과제 시연용 호환 데이터: 실제 장착 가능 여부는 제조사 규격 확인이 필요하다.
const parts = [
  { id: 1, name: "Avante N 전용 브레이크 패드 (예시)", vehicleIds: [1] },
  { id: 2, name: "BMW 320i 전용 에어 필터 (예시)", vehicleIds: [2] },
];

export function createApp({ db, redis }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(morgan("dev"));
  app.use(express.json({ limit: "5mb" }));
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/health", async (req, res) => {
    await db.query("SELECT 1");
    await redis.ping();
    res.json({ status: "ok" });
  });
  app.use("/api/board", async (req, res, next) => {
    req.user = await sessionUser(redis, req.headers.cookie);
    next();
  });
  const auth = async (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ message: "로그인이 필요합니다." });
    next();
  };
  app.get("/api/board/me", auth, (req, res) => res.json(req.user));
  app.use("/api/board", communityRouter({ db, auth }));
  app.get("/api/parts/compatibility", (req, res) => {
    if (!/^[12]$/.test(req.query.vehicleId ?? ""))
      return res
        .status(400)
        .json({ message: "지원 차량 ID(1 또는 2)를 선택하세요." });
    const vehicleId = Number(req.query.vehicleId);
    res.json({
      vehicleId,
      parts: parts.filter((p) => p.vehicleIds.includes(vehicleId)),
      demo: true,
    });
  });
  app.use((req, res) =>
    res.status(404).json({ message: "API를 찾을 수 없습니다." }),
  );
  // DB 연결 정보나 내부 SQL은 클라이언트에 노출하지 않는다.
  app.use((err, req, res, next) => {
    const status = [400, 401, 403, 404, 409, 413].includes(err.status)
      ? err.status
      : 503;
    if (status === 503) console.error("Board request failed:", err.message);
    res
      .status(status)
      .json({
        message:
          status === 503
            ? "서비스에 일시적으로 연결할 수 없습니다."
            : status === 413
              ? "사진은 한 장당 3MB 이하로 올려주세요."
              : err.type === "entity.parse.failed"
                ? "요청 JSON을 확인하세요."
                : err.message,
      });
  });
  return app;
}
