import { fail, text } from './validation.js';
import { requireCurrentAdmin } from './admin-access.js';

// Row locks prevent duplicate logs and preserve the exact pre-deletion snapshot.
export async function deleteContent(db, user, kind, id, reason) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const isPost = kind === 'post';
    const { rows } = await client.query(isPost
      ? `SELECT p.id,p.id AS post_id,p.title AS post_title,p.category,p.author_id,u.username,p.content,p.deleted
         FROM board_posts p JOIN users u ON u.id=p.author_id WHERE p.id=$1 FOR UPDATE OF p`
      : `SELECT c.id,c.post_id,p.title AS post_title,p.category,c.author_id,u.username,c.content,c.deleted,c.parent_id,p.deleted AS post_deleted
         FROM board_comments c JOIN board_posts p ON p.id=c.post_id JOIN users u ON u.id=c.author_id
         WHERE c.id=$1 FOR UPDATE OF p,c`, [id]);
    const target = rows[0];
    if (!target || target.deleted || target.post_deleted) fail(404, '삭제되었거나 없는 콘텐츠입니다.');
    const moderation = Number(target.author_id) !== user.id;
    if (moderation) {
      const admin = await requireCurrentAdmin(client, user);
      const note = text(reason, 500);
      await client.query(`INSERT INTO moderation_logs
        (action_type,category,post_id,post_title,target_id,target_author_id,target_author_username,original_content,reason,admin_id,admin_username)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [isPost ? 'POST_DELETE' : target.parent_id ? 'REPLY_DELETE' : 'COMMENT_DELETE',
         target.category,target.post_id,target.post_title,target.id,target.author_id,target.username,target.content,note,admin.id,admin.username]);
    }
    if (isPost) {
      // 게시글은 행을 지우지 않는다(STEP 10-impl-B). 댓글·신고·좋아요·알림과 운영 기록의 참조가 그대로 남고,
      // 공개 API는 NOT deleted로 숨긴다. deleted_by는 삭제한 사용자 id, deleted_reason은 삭제 주체다.
      // 관리자 삭제는 원문을 moderation_logs에 남기고 글에서는 지운다(사진 참조도 비워 공개되지 않는다).
      // 작성자 삭제는 신고 처리를 위해 원문을 DB에 남긴다. 사진은 삭제 글만 참조하면 공개되지 않는다(image-references.js).
      if (moderation) await client.query(`UPDATE board_posts SET deleted=true,deleted_at=NOW(),deleted_by=$2,deleted_reason='ADMIN',
        title='관리자에 의해 삭제된 게시글입니다.',content='관리자에 의해 삭제된 게시글입니다.',image_ids='{}',vehicle='',vehicle_id=NULL WHERE id=$1`, [id, user.id]);
      else await client.query(`UPDATE board_posts SET deleted=true,deleted_at=NOW(),deleted_by=$2,deleted_reason='AUTHOR' WHERE id=$1`, [id, user.id]);
    } else {
      await client.query('UPDATE board_comments SET deleted=true,content=$2 WHERE id=$1',
        [id, moderation ? '관리자에 의해 삭제된 댓글입니다.' : '삭제된 댓글입니다.']);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
