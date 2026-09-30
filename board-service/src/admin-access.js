import { fail } from './validation.js';

// Both the signed-in session and current database role must authorize moderation.
// 정지·비활성화·탈퇴 상태의 관리자는 app.js 인증 단계에서 이미 걸러지지만, 관리자 작업은 DB 상태로 한 번 더 확인한다.
export async function requireCurrentAdmin(db, user) {
  if (user?.role !== 'ADMIN') fail(403, '관리자만 접근할 수 있습니다.');
  const { rows } = await db.query(
    "SELECT id,username,role,COALESCE(account_status,'ACTIVE') AS status,suspended_until FROM users WHERE id=$1", [user.id]);
  const admin = rows[0];
  const blocked = !admin || admin.status === 'DISABLED' || admin.status === 'WITHDRAWN' ||
    (admin.status === 'SUSPENDED' && (!admin.suspended_until || new Date(admin.suspended_until) > new Date()));
  if (admin?.role !== 'ADMIN' || blocked) fail(403, '관리자만 접근할 수 있습니다.');
  return { id: admin.id, username: admin.username, role: admin.role };
}
