'use client';

import type {CommunitySession} from './use-community-session';
import styles from './community.module.css';

type Props = {
  auth: CommunitySession;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  // Where the login page sends the user back to (already URL-encoded path).
  loginNext: string;
};

// Top bar shared by the community list and post detail screens.
export default function CommunityHeader({auth, search, onSearchChange, onSearchSubmit, loginNext}: Props) {
  const {session, unread, logoutBusy, handleLogout} = auth;
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <a href="/" className={styles.logo} aria-label="REV.CC 홈">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/main/logo.png" alt="REV.CC" height={30} />
        </a>
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
          <span className={styles.bell} aria-label={unread ? `읽지 않은 알림 ${unread}개` : '새 알림 없음'}>
            🔔{unread > 0 && <span className={styles.bellCount}>{unread}</span>}
          </span>
          {session ? (
            <>
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
    </header>
  );
}
