'use client';

import {useState} from 'react';
import type {CommunitySession} from './use-community-session';
import {ActivityPanel, NotificationsPanel} from './header-panels';
import Logo from '../common/logo';
import styles from './community.module.css';

type Props = {
  auth: CommunitySession;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  // Where the login page sends the user back to (already URL-encoded path).
  loginNext: string;
};

// Top bar shared by every community screen. Logged-in members get the legacy
// header's "내 활동" and "알림" panels (app.js #activity-button /
// #notifications-button); both are hidden when logged out, like before.
export default function CommunityHeader({auth, search, onSearchChange, onSearchSubmit, loginNext}: Props) {
  const {session, unread, setUnread, logoutBusy, handleLogout} = auth;
  const [panel, setPanel] = useState<'activity' | 'notifications' | null>(null);
  return (
    <header className={styles.header}>
      {session && panel === 'activity' && <ActivityPanel user={session} onClose={() => setPanel(null)} />}
      {session && panel === 'notifications' && (
        <NotificationsPanel onClose={() => setPanel(null)} onRead={() => setUnread(0)} />
      )}
      <div className={styles.headerInner}>
        <a href="/" className={styles.logo} aria-label="REV.CC 홈">
          <Logo height={56} />
        </a>
        <div className={styles.searchWrap}>
          <form
            className={styles.search}
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              onSearchSubmit(search.trim());
            }}
          >
            <label className={styles.srOnly} htmlFor="community-header-search">
              차종, 게시글, 유저 검색
            </label>
            <span className={styles.searchIcon} aria-hidden="true">
              🔍
            </span>
            <input
              id="community-header-search"
              type="search"
              placeholder="차종, 게시글, 유저 검색"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              maxLength={100}
            />
          </form>
        </div>
        <div className={styles.rightGroup}>
          <nav className={styles.nav} aria-label="주 메뉴">
            <a href="/">홈</a>
            <a href="/community" aria-current="page">
              커뮤니티
            </a>
            <a href="/home">내 차고</a>
            <a href="/parts">부품장터</a>
            {session?.role === 'ADMIN' && <a href="/admin">관리</a>}
          </nav>
          <div className={styles.headerActions}>
            {session ? (
              <>
                <button type="button" className={styles.activityButton} onClick={() => setPanel('activity')}>
                  내 활동
                </button>
                <button
                  type="button"
                  className={styles.bell}
                  aria-label={unread ? `알림, 읽지 않은 알림 ${unread}개` : '알림, 새 알림 없음'}
                  onClick={() => setPanel('notifications')}
                >
                  알림{unread > 0 && <span className={styles.bellCount}>{unread}</span>}
                </button>
                <span className={styles.username}>{session.username} 님</span>
                <button type="button" className={styles.secondary} disabled={logoutBusy} onClick={handleLogout}>
                  로그아웃
                </button>
              </>
            ) : (
              <a className={styles.secondary} href={`/login?next=${loginNext}`}>
                로그인 / 가입
              </a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
