'use client';

import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {fetchListings} from '../../lib/parts-api';
import type {Listing} from '../../lib/parts-types';
import type {SessionUser} from '../../lib/home-types';
import {formatMoney, listingUrl} from '../../lib/format';
import {readRecentListings, RECENT_LISTINGS_STORAGE_KEY, type RecentListing} from '../../lib/recent-listings';
import MyGarageMini from '../community/my-garage-mini';
import styles from './parts.module.css';

// Right sidebar shared by the list, detail and editor: "인기 매물" (관심·조회
// 기준, assignment-frontend/js/market.js's popular()), MY GARAGE and "최근
// 본 매물". `children` go first (the editor's own sidebar content, if any).
export default function PartsSidebar({session, children}: {session: SessionUser | null | undefined; children?: ReactNode}) {
  const [popular, setPopular] = useState<Listing[]>([]);
  const [popularFailed, setPopularFailed] = useState(false);
  const loadPopular = useCallback(() => {
    setPopularFailed(false);
    fetchListings({sort: 'popular', limit: 5, status: 'selling'})
      .then((page) => setPopular(page.items))
      .catch(() => setPopularFailed(true));
  }, []);
  useEffect(() => loadPopular(), [loadPopular]);

  const [recent, setRecent] = useState<RecentListing[]>([]);
  useEffect(() => {
    setRecent(readRecentListings());
    function onStorage(e: StorageEvent) {
      if (e.key === RECENT_LISTINGS_STORAGE_KEY) setRecent(readRecentListings());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <aside className={styles.sidebar} aria-label="부품장터 사이드바">
      {children}
      <section className={styles.sideSection}>
        <h2>인기 매물</h2>
        <p className={styles.muted}>관심 수 · 조회수 기준</p>
        {popularFailed ? (
          <p className={styles.empty}>
            인기 매물을 불러오지 못했어요.{' '}
            <button type="button" className={styles.textLink} onClick={loadPopular}>
              다시 확인
            </button>
          </p>
        ) : popular.length ? (
          popular.map((item) => (
            <a key={item.id} className={styles.sideRow} href={listingUrl(item.id)}>
              <strong>{item.title}</strong>
              <span>{formatMoney(item.price)}</span>
            </a>
          ))
        ) : (
          <p className={styles.muted}>아직 판매중인 매물이 없습니다.</p>
        )}
      </section>
      <section className={styles.sideSection}>
        <h2>MY GARAGE</h2>
        <MyGarageMini user={session} />
      </section>
      <section className={styles.sideSection}>
        <h2>최근 본 매물</h2>
        <p className={styles.muted}>이 브라우저에서 본 매물</p>
        {recent.length ? (
          recent.map((item) => (
            <a key={item.id} className={styles.sideRow} href={listingUrl(item.id)}>
              <strong>{item.title}</strong>
              <span>{formatMoney(item.price)}</span>
            </a>
          ))
        ) : (
          <p className={styles.muted}>아직 본 매물이 없습니다.</p>
        )}
      </section>
    </aside>
  );
}
