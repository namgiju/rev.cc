import { fail } from './validation.js';

// Both the signed-in session and current database role must authorize moderation.
export async function requireCurrentAdmin(db, user) {
  if (user?.role !== 'ADMIN') fail(403, '관리자만 접근할 수 있습니다.');
  const { rows } = await db.query('SELECT id,username,role FROM users WHERE id=$1', [user.id]);
  if (rows[0]?.role !== 'ADMIN') fail(403, '관리자만 접근할 수 있습니다.');
  return rows[0];
}
