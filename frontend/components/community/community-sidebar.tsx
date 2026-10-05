'use client';

import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {fetchPosts} from '../../lib/community-api';
import type {CommunityPost} from '../../lib/community-types';
import type {SessionUser} from '../../lib/home-types';
import {postUrl} from '../../lib/format';
import {readRecentPosts, RECENT_POSTS_STORAGE_KEY, type RecentPost} from '../../lib/recent-posts';
import PopularList from '../home/popular-list';
import MyGarageMini from './my-garage-mini';
import styles from './community.module.css';

// Right sidebar shared by the list and the editor: "지금 인기글" (추천순
// TOP5, independent of the page's filters), MY GARAGE and "최근 본 글".
// `children` go first (the editor's writing guidelines).
export default function CommunitySidebar({session, children}: {session: SessionUser | null | undefined; children?: ReactNode}) {
  const [popularPosts, setPopularPosts] = useState<CommunityPost[]>([]);
  const [popularFailed, setPopularFailed] = useState(false);
  const loadPopular = useCallback(() => {
    setPopularFailed(false);
    fetchPosts({sort: 'popular', limit: 5})
      .then(setPopularPosts)
      .catch(() => setPopularFailed(true));
  }, []);
  useEffect(() => loadPopular(), [loadPopular]);

  // Local only, same key as the legacy site (lib/recent-posts.ts).
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);
  useEffect(() => {
    setRecentPosts(readRecentPosts());
    function onStorage(e: StorageEvent) {
      if (e.key === RECENT_POSTS_STORAGE_KEY) setRecentPosts(readRecentPosts());
    }
    function onPageShow() {
      setRecentPosts(readRecentPosts());
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return (
    <aside className={styles.rightSidebar} aria-label="커뮤니티 사이드바">
      {children}
      <section className={styles.sideSection}>
        <h2>지금 인기글</h2>
        <p className={styles.muted}>추천 수를 기준으로 모았어요.</p>
        {popularFailed ? (
          <p className={styles.empty}>
            인기글을 불러오지 못했어요.{' '}
            <button type="button" className={styles.textLink} onClick={loadPopular}>
              다시 확인
            </button>
          </p>
        ) : (
          <PopularList posts={popularPosts} />
        )}
      </section>
      <section className={styles.sideSection}>
        <h2>MY GARAGE</h2>
        <MyGarageMini user={session} />
      </section>
      <section id="community-recent" className={styles.sideSection}>
        <h2>최근 본 글</h2>
        <p className={styles.muted}>이 브라우저에서 읽은 글</p>
        {recentPosts.length ? (
          <ul className={styles.recentList}>
            {recentPosts.map((post) => (
              <li key={post.id}>
                <a href={postUrl(post)}>{post.title}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>아직 읽은 글이 없습니다.</p>
        )}
      </section>
    </aside>
  );
}
