'use client';

import {useRef, useState, type FormEvent} from 'react';
import type {CommunityComment} from '../../lib/community-types';
import type {SessionUser} from '../../lib/home-types';
import {formatDateTime} from '../../lib/format';
import MemberLink from './member-link';
import styles from './post-detail.module.css';

type Props = {
  comments: CommunityComment[];
  viewer: SessionUser | null;
  requireLogin: () => boolean;
  // Resolves true once the comment is saved (the form then clears itself).
  onSubmit: (content: string, parentId: number | null) => Promise<boolean>;
  onDelete: (comment: CommunityComment) => void;
};

// Comment block from renderPostDetail(): count of non-deleted comments, the
// write form (above the list), then top-level comments each followed by their
// replies (one level of nesting, same as board-service). 답글 = any top-level,
// non-deleted comment; 삭제 = comment author or ADMIN.
export default function CommentSection({comments, viewer, requireLogin, onSubmit, onDelete}: Props) {
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<CommunityComment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  function startReply(comment: CommunityComment) {
    if (!requireLogin()) return;
    setReplyTo(comment);
    document.getElementById('comment-input')?.focus();
  }

  // The ref (not just state) blocks a second submit fired before React
  // re-renders the disabled button — Enter + click, double click.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || !requireLogin()) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (await onSubmit(content, replyTo?.id ?? null)) {
        setContent('');
        setReplyTo(null);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
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
            <button type="button" className={styles.dangerText} onClick={() => onDelete(c)}>
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
          readOnly={submitting}
          required
          maxLength={2000}
          rows={3}
          aria-label="댓글 내용"
          placeholder={viewer ? '서로를 배려하는 댓글을 남겨주세요.' : '로그인 후 댓글을 남길 수 있어요.'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button type="submit" className={styles.primary} disabled={submitting}>
          {submitting ? '등록 중…' : '댓글 등록'}
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
