'use client';

import {useState, type FormEvent} from 'react';
import type {CommunityComment} from '../../lib/community-types';
import type {SessionUser} from '../../lib/home-types';
import {formatDateTime} from '../../lib/format';
import MemberLink from './member-link';
import styles from './post-detail.module.css';

type Props = {
  comments: CommunityComment[];
  viewer: SessionUser | null;
  requireLogin: () => boolean;
  // Placeholder for mutations wired in STEP 2-3 (receives the action label).
  onAction: (label: string) => void;
};

// Comment block from renderPostDetail(): count of non-deleted comments, the
// write form (above the list), then top-level comments each followed by their
// replies (one level of nesting, same as board-service). 답글 = any top-level,
// non-deleted comment; 삭제 = comment author or ADMIN.
export default function CommentSection({comments, viewer, requireLogin, onAction}: Props) {
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<CommunityComment | null>(null);

  function startReply(comment: CommunityComment) {
    if (!requireLogin()) return;
    setReplyTo(comment);
    document.getElementById('comment-input')?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAction(replyTo ? '답글 등록' : '댓글 등록');
  }

  const topLevel = comments.filter((c) => !c.parentId);
  const visibleCount = comments.filter((c) => !c.deleted).length;

  function commentNode(c: CommunityComment) {
    const canDelete = !c.deleted && viewer != null && (viewer.id === c.authorId || viewer.role === 'ADMIN');
    return (
      <div
        key={c.id}
        className={[styles.comment, c.parentId ? styles.reply : '', c.deleted ? styles.deleted : ''].join(' ')}
      >
        <div className={styles.commentMeta}>
          <MemberLink id={c.authorId} name={c.username} />
          <time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time>
          {!c.deleted && !c.parentId && (
            <button type="button" className={styles.textButton} onClick={() => startReply(c)}>
              답글
            </button>
          )}
          {canDelete && (
            <button type="button" className={styles.dangerText} onClick={() => onAction('댓글 삭제')}>
              삭제
            </button>
          )}
        </div>
        <p>{c.content}</p>
      </div>
    );
  }

  return (
    <section className={styles.comments} aria-labelledby="comments-title">
      <h3 id="comments-title">댓글 {visibleCount}</h3>
      <form className={styles.commentForm} onSubmit={submit}>
        {replyTo && (
          <div className={styles.replyLabel}>
            <span>{replyTo.username} 님에게 답글 </span>
            <button type="button" className={styles.textButton} onClick={() => setReplyTo(null)}>
              취소
            </button>
          </div>
        )}
        <textarea
          id="comment-input"
          required
          maxLength={2000}
          rows={3}
          aria-label="댓글 내용"
          placeholder={viewer ? '서로를 배려하는 댓글을 남겨주세요.' : '로그인 후 댓글을 남길 수 있어요.'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button type="submit" className={styles.primary}>
          댓글 등록
        </button>
      </form>
      <div>
        {topLevel.length ? (
          topLevel.flatMap((c) => [c, ...comments.filter((r) => r.parentId === c.id)]).map(commentNode)
        ) : (
          <p className={styles.emptyComments}>첫 댓글을 남겨보세요.</p>
        )}
      </div>
    </section>
  );
}
