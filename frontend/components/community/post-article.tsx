'use client';

import type {CommunityPost} from '../../lib/community-types';
import type {SessionUser} from '../../lib/home-types';
import {CATEGORY_LABELS, formatDateTime, imageUrl, postUrl} from '../../lib/format';
import type {AuthorState} from './post-detail';
import BadgeList from './badge-list';
import MemberLink from './member-link';
import styles from './post-detail.module.css';

type Props = {
  post: CommunityPost;
  author: AuthorState;
  viewer: SessionUser | null;
  notify: (message: string) => void;
  // Placeholder for mutations wired in later STEPs (receives the button label).
  onAction: (label: string) => void;
};

// Body of the post: renderPostDetail()'s title/meta/text/gallery/actions and
// the "작성자의 인장" block. Visibility rules match the legacy page exactly:
// 수정 = author only, 삭제 = author or ADMIN, 신고 = anyone but the author.
export default function PostArticle({post, author, viewer, notify, onAction}: Props) {
  const isAuthor = viewer != null && post.authorId != null && viewer.id === post.authorId;
  const isAdmin = viewer?.role === 'ADMIN';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin + postUrl(post));
      notify('글 링크를 복사했어요.');
    } catch {
      notify('링크를 복사하지 못했어요.');
    }
  }

  return (
    <>
      <span className={styles.category}>{CATEGORY_LABELS[post.category] || post.category}</span>
      <h1 className={styles.title}>{post.title}</h1>
      <div className={styles.meta}>
        <MemberLink id={post.authorId} name={post.username} />
        {post.ownerVehicle && <span>{post.ownerVehicle}</span>}
        <time dateTime={post.createdAt}>{formatDateTime(post.createdAt)}</time>
        <span>조회 {post.views}</span>
        {post.updatedAt && <span>수정됨</span>}
        {post.vehicle && <span>{post.vehicle}</span>}
      </div>

      <p className={styles.text}>{post.content}</p>

      {post.imageIds.length > 0 && (
        <div className={styles.gallery}>
          {post.imageIds.map((id) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={imageUrl(id)} alt={`${post.title} 사진`} loading="lazy" />
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" aria-pressed={post.liked} onClick={() => onAction('추천')}>
          ♡ 추천 {post.likeCount}
        </button>
        <button type="button" aria-pressed={post.bookmarked} onClick={() => onAction('북마크')}>
          {post.bookmarked ? '저장됨' : '북마크'}
        </button>
        <button type="button" onClick={copyLink}>
          링크 복사
        </button>
        {isAuthor && (
          <button type="button" onClick={() => onAction('수정')}>
            수정
          </button>
        )}
        {(isAuthor || isAdmin) && (
          <button type="button" className={styles.danger} onClick={() => onAction('삭제')}>
            삭제
          </button>
        )}
        {!isAuthor && (
          <button type="button" onClick={() => onAction('신고')}>
            신고
          </button>
        )}
      </div>

      <section className={styles.badges} aria-label="작성자의 인장">
        <h3>작성자의 인장</h3>
        {author.status === 'loading' && <p className={styles.muted}>인장을 불러오고 있어요.</p>}
        {author.status === 'withdrawn' && <p className={styles.muted}>탈퇴한 회원의 인장은 표시하지 않아요.</p>}
        {author.status === 'error' && <p className={styles.muted}>인장을 불러오지 못했어요.</p>}
        {author.status === 'ready' && (
          <BadgeList badges={author.member.badges} empty="아직 표시할 인장이 없어요." />
        )}
      </section>
    </>
  );
}
