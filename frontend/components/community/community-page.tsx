'use client';

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import CommunityHeader from './community-header';
import type {CommunitySession} from './use-community-session';
import SiteFooter from '../footer/site-footer';
import styles from './community.module.css';
import detailStyles from './post-detail.module.css';

// Transient status line (app.js's notify()): message clears after 7s.
export function useNotice() {
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(''), 7000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {notice, notify};
}

// Single-column community page (member profile, public vehicle): shared
// header with a search box that jumps to the list, back link, status line,
// footer. Same frame as the post detail page.
export default function CommunityPage({auth, notice, children}: {auth: CommunitySession; notice: string; children: ReactNode}) {
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={(value) => {
          window.location.href = value ? `/community?q=${encodeURIComponent(value)}` : '/community';
        }}
        loginNext={encodeURIComponent(pathname)}
      />
      {auth.sessionError && (
        <p className={styles.notice} role="status">
          로그인 상태를 확인하지 못했어요. 새로고침해주세요.
        </p>
      )}
      <main className={detailStyles.page}>
        <a href="/community" className={detailStyles.backLink}>
          ← 커뮤니티 목록으로
        </a>
        <p className={detailStyles.notice} role="status" aria-live="polite">
          {notice}
        </p>
        <div className={detailStyles.single}>{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
