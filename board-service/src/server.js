import pg from "pg";
import { createClient } from "redis";
import { createApp } from "./app.js";
import { poolConfig } from "./db-pool.js";

// 스키마는 core(Spring)의 Flyway 마이그레이션(backend/src/main/resources/db/migration)이 관리한다.
// Compose는 core가 마이그레이션을 마치고 healthy가 된 뒤 board를 시작한다.
const db = new pg.Pool(poolConfig());
// DB 재시작 시 유휴 연결의 error 이벤트를 처리해야 Node 프로세스가 종료되지 않는다.
// pg가 끊어진 연결을 풀에서 제거하고 다음 요청에 새 연결을 생성한다.
db.on("error", (err) =>
  console.error("PostgreSQL idle connection error:", err.message),
);
// 비밀번호는 URL에 넣지 않고 따로 넘긴다(특수문자 URL 인코딩 문제 회피). 비어 있으면 인증 없이 접속한다.
const redis = createClient({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
  password: process.env.REDIS_PASSWORD || undefined,
});
redis.on("error", (err) =>
  console.error("Redis connection error:", err.message),
);
await redis.connect();
const server = createApp({ db, redis }).listen(3001, "0.0.0.0", () =>
  console.log("REV.CC board listening on 3001"),
);
// 컨테이너 종료 시 진행 중인 HTTP 요청과 DB 연결을 정리한다.
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(async () => {
      await redis.quit();
      await db.end();
      process.exit(0);
    });
  });
