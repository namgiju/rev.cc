// PostgreSQL 커넥션 풀 설정. 운영 DB(Neon, 2026-09-30 확인 max_connections 901, 일반 사용자 가용 897)에
// core 10 + board 10 = 평시 최대 20, 재배포로 구·신 컨테이너가 겹쳐도 40만 쓴다.
// connectionTimeoutMillis의 pg 기본값 0은 무한 대기라, 풀이 다 차거나 DB가 응답하지 않으면 요청이 쌓인다.
// 유한한 값을 두면 연결 대기 오류가 나고, app.js 에러 핸들러가 이를 503으로 응답한다.
// connectionTimeoutMillis는 "새 연결을 얻을 때"만 적용된다. 이미 열린 연결에서 DB가 멈추면 쿼리가 무한히
// 기다리므로 query_timeout(클라이언트 측 제한)도 둔다. 시간 초과된 연결은 pool.query가 폐기한다.
const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function poolConfig(env = process.env) {
  return {
    ssl: env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
    max: positiveInt(env.PG_POOL_MAX, 10),
    idleTimeoutMillis: positiveInt(env.PG_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: positiveInt(env.PG_CONNECTION_TIMEOUT_MS, 5_000),
    query_timeout: positiveInt(env.PG_QUERY_TIMEOUT_MS, 15_000),
  };
}
