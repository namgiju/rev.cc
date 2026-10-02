import type {Post} from '../../lib/home-types';
import {postUrl} from '../../lib/format';
import styles from './home.module.css';

// "실시간 인기" 사이드바. 왼쪽 "오늘의 인기글"과 같은 게시글 데이터를 쓰지만
// 기간 제한 없이 전체 추천순 TOP N만 보여준다(레퍼런스의 실시간 랭킹 위치).
export default function PopularList({posts}: {posts: Post[]}) {
  if (!posts.length) {
    return <p className={styles.empty}>아직 인기글이 없어요.</p>;
  }
  return (
    <ol className={styles.popularList}>
      {posts.map((post, i) => (
        <li key={post.id} className={styles.popularRow}>
          <span className={styles.popularRank} data-top={i < 3 ? 'true' : undefined}>
            {i + 1}
          </span>
          <a className={styles.popularTitle} href={postUrl(post)}>
            {post.title}
          </a>
        </li>
      ))}
    </ol>
  );
}
