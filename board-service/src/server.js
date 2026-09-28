import { readFile } from "node:fs/promises";
import pg from "pg";
import { createClient } from "redis";
import { createApp } from "./app.js";

// Compose는 core의 JPA users 테이블 생성 후 board를 시작한다.
const db = new pg.Pool();
// DB 재시작 시 유휴 연결의 error 이벤트를 처리해야 Node 프로세스가 종료되지 않는다.
// pg가 끊어진 연결을 풀에서 제거하고 다음 요청에 새 연결을 생성한다.
db.on("error", (err) =>
  console.error("PostgreSQL idle connection error:", err.message),
);
const redis = createClient({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
});
redis.on("error", (err) =>
  console.error("Redis connection error:", err.message),
);
await redis.connect();
await db.query(
  await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
);
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
