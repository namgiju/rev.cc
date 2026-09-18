import express from 'express';
import morgan from 'morgan';

// Spring과 동일한 쿠키 이름·토큰 형식·Redis 키를 사용한다. TTL은 로그인부터 30분이다.
export async function sessionUser(redis, cookie = '') {
  const token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('REVCC_SESSION='))?.slice(14);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const value = await redis.get(`revcc:session:${token}`);
  if (!value) return null;
  try {
    const user = JSON.parse(value);
    return Number.isSafeInteger(user.id) && typeof user.username === 'string' ? user : null;
  } catch { return null; }
}

// 과제 시연용 호환 데이터: 실제 장착 가능 여부는 제조사 규격 확인이 필요하다.
const parts = [
  { id: 1, name: 'Avante N 전용 브레이크 패드 (예시)', vehicleIds: [1] },
  { id: 2, name: 'BMW 320i 전용 에어 필터 (예시)', vehicleIds: [2] }
];

export function createApp({ db, redis }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(morgan('dev'));
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', async (req, res) => {
    await db.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok' });
  });
  const auth = async (req, res, next) => {
    req.user = await sessionUser(redis, req.headers.cookie);
    if (!req.user) return res.status(401).json({ message: '로그인이 필요합니다.' });
    next();
  };
  app.get('/api/board/me', auth, (req, res) => res.json(req.user));
  app.get('/api/board/posts', async (req, res) => {
    const { rows } = await db.query(`SELECT p.id, p.title, p.content, p.author_id AS "authorId",
      u.username, p.created_at AS "createdAt" FROM board_posts p
      JOIN users u ON u.id = p.author_id ORDER BY p.id DESC LIMIT 100`);
    // pg는 BIGINT를 문자열로 반환하므로 공통 사용자 JSON의 숫자 ID와 맞춘다.
    res.json(rows.map(row => ({ ...row, authorId: Number(row.authorId) })));
  });
  app.post('/api/board/posts', auth, async (req, res) => {
    const { title, content } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim() || title.length > 150 ||
        typeof content !== 'string' || !content.trim() || content.length > 5000)
      return res.status(400).json({ message: '제목(150자 이하)과 내용(5000자 이하)을 입력하세요.' });
    // 작성자는 클라이언트의 authorId를 신뢰하지 않고 Redis 세션에서 가져온다.
    const { rows } = await db.query(`INSERT INTO board_posts(title, content, author_id)
      VALUES ($1, $2, $3) RETURNING id, title, content, author_id AS "authorId"`,
      [title.trim(), content.trim(), req.user.id]);
    res.status(201).json({ ...rows[0], authorId: req.user.id });
  });
  app.get('/api/parts/compatibility', (req, res) => {
    if (!/^[12]$/.test(req.query.vehicleId ?? ''))
      return res.status(400).json({ message: '지원 차량 ID(1 또는 2)를 선택하세요.' });
    const vehicleId = Number(req.query.vehicleId);
    res.json({ vehicleId, parts: parts.filter(p => p.vehicleIds.includes(vehicleId)), demo: true });
  });
  app.use((req, res) => res.status(404).json({ message: 'API를 찾을 수 없습니다.' }));
  // DB 연결 정보나 내부 SQL은 클라이언트에 노출하지 않는다.
  app.use((err, req, res, next) => {
    const status = err.status === 400 ? 400 : err.status === 413 ? 413 : 503;
    if (status === 503) console.error('Board request failed:', err.message);
    res.status(status).json({ message: status === 503 ? '서비스에 일시적으로 연결할 수 없습니다.' : '요청 JSON을 확인하세요.' });
  });
  return app;
}
