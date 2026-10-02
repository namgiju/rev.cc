import type {Post} from '../../lib/home-types';
import {CATEGORY_LABELS, imageUrl, postUrl} from '../../lib/format';
import styles from './home.module.css';

// "오늘의 인기글" 카드. 실제 게시글 필드(대표 이미지·제목·카테고리·조회수·
// 댓글수·추천수)만 쓰고, 값이 없는 필드는 억지로 만들어 채우지 않는다.
export default function PostCard({post}: {post: Post}) {
  return (
    <a className={styles.postCard} href={postUrl(post)}>
      <div className={styles.postMedia}>
        {post.imageIds?.length ? (
          <img src={imageUrl(post.imageIds[0])} alt="" loading="lazy" />
        ) : (
          <span className={styles.postNoPhoto} aria-hidden="true" />
        )}
      </div>
      <div className={styles.postBody}>
        <span className={styles.postCategory}>{CATEGORY_LABELS[post.category] || post.category}</span>
        <h3 className={styles.postTitle}>{post.title}</h3>
        <div className={styles.postStats}>
          <span>👁 {post.views.toLocaleString('ko-KR')}</span>
          <span>💬 {post.commentCount.toLocaleString('ko-KR')}</span>
          <span>♥ {post.likeCount.toLocaleString('ko-KR')}</span>
        </div>
      </div>
    </a>
  );
}
