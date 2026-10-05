import type {CommunityPost} from '../../lib/community-types';
import {CATEGORY_LABELS, imageUrl, memberUrl, postUrl} from '../../lib/format';
import styles from './community.module.css';

// One row in the community list table. Mirrors
// assignment-frontend/js/community-list.js's row() — title (+ thumbnail when
// the post has one), author (→ their public garage), date, and the
// 조회/추천/댓글 stat columns.
//
// Deliberately a <div>, not <article>: app/globals.css has an unscoped
// `article{background:#14161b;border-radius:20px;...}` rule (dark card style
// for the old garage prototype) that would otherwise paint every row's
// background near-black under this page's light theme.
export default function PostRow({post}: {post: CommunityPost}) {
  return (
    <div className={styles.feedRow}>
      <a className={styles.feedTitleCell} href={postUrl(post)}>
        {post.imageIds.length > 0 && (
          <img src={imageUrl(post.imageIds[0])} alt="" loading="lazy" className={styles.feedThumb} />
        )}
        <span className={styles.feedTitleText}>
          <strong>{post.title}</strong>
          <span className={styles.feedCategory}>{CATEGORY_LABELS[post.category] || post.category}</span>
        </span>
      </a>
      {post.authorId == null ? (
        <span className={styles.feedAuthorWithdrawn}>탈퇴한 회원</span>
      ) : (
        <a className={styles.feedAuthor} href={memberUrl(post.authorId)}>
          {post.username}
        </a>
      )}
      <time className={styles.feedDate} dateTime={post.createdAt}>
        {new Date(post.createdAt).toLocaleDateString('ko-KR')}
      </time>
      <span className={styles.feedStat} aria-label={`조회 ${post.views}`}>
        {post.views}
      </span>
      <span className={styles.feedStat} aria-label={`추천 ${post.likeCount}`}>
        {post.likeCount}
      </span>
      <span className={styles.feedStat} aria-label={`댓글 ${post.commentCount}`}>
        {post.commentCount}
      </span>
    </div>
  );
}
