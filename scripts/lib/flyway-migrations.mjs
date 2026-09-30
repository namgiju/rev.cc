// 수동 시스템 테스트용: core의 Flyway 마이그레이션(V*.sql)을 버전 순서대로 격리 스키마에 적용한다.
// 스키마의 유일한 소유자는 Flyway다(docs/DATABASE-MIGRATIONS.md). 이 helper는 그 파일을 읽기만 한다.
// scripts/run-board-system.sh가 임시 PostgreSQL을 띄우고 REVCC_SYSTEM_TEST_DB=isolated를 설정한다.
// 그 밖의 환경(예: Neon에 연결된 board 컨테이너)에서는 실행을 거부한다.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export function assertIsolatedDatabase() {
  if (process.env.REVCC_SYSTEM_TEST_DB !== "isolated")
    throw new Error(
      "격리된 임시 DB에서만 실행한다: scripts/run-board-system.sh <script.mjs>로 실행할 것",
    );
}

const version = (name) => name.match(/^V([0-9._]+)__.+\.sql$/)?.[1].split(/[._]/).map(Number);

export async function applyFlywayMigrations(
  db,
  dir = process.env.REVCC_MIGRATIONS_DIR ?? "./db-migration",
) {
  assertIsolatedDatabase();
  const files = (await readdir(dir))
    .filter((name) => version(name))
    .sort((a, b) => {
      const [x, y] = [version(a), version(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++)
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    });
  if (!files.length) throw new Error(`마이그레이션 파일이 없다: ${dir}`);
  // Flyway처럼 파일 하나를 트랜잭션 하나로 적용한다.
  const client = await db.connect();
  try {
    for (const name of files) {
      await client.query("BEGIN");
      try {
        await client.query(await readFile(join(dir, name), "utf8"));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`${name} 적용 실패: ${error.message}`);
      }
    }
  } finally {
    client.release();
  }
  return files;
}
