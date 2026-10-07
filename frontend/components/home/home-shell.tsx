'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import type {GarageEntry, Listing, Post, SessionUser} from '../../lib/home-types';
import {ApiError, fetchSession, fetchTodayPosts, fetchUnreadCount, logout} from '../../lib/home-api';
import {CATEGORY_LABELS} from '../../lib/format';
import Logo from '../common/logo';
import SiteFooter from '../footer/site-footer';
import PostCard from './post-card';
import PopularList from './popular-list';
import GarageSpotlight from './garage-spotlight';
import MarketSpotlight from './market-spotlight';
import Reveal from './reveal';
import styles from './home.module.css';

const CATEGORIES: {value: string; label: string}[] = [
  {value: '', label: '전체'},
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({value, label})),
];
const PERIODS: {value: string; label: string}[] = [
  {value: 'today', label: '오늘'},
  {value: 'week', label: '주간'},
  {value: '', label: '전체'},
];

export default function HomeShell({
  initialPosts,
  initialPostsFailed,
  popularPosts,
  garageSpotlight,
  market,
}: {
  initialPosts: Post[];
  initialPostsFailed: boolean;
  popularPosts: Post[];
  garageSpotlight: GarageEntry | null;
  market: Listing[];
}) {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [unread, setUnread] = useState(0);
  const [sessionError, setSessionError] = useState(false);
  const [busy, setBusy] = useState(false);

  const [category, setCategory] = useState('');
  const [period, setPeriod] = useState('today');
  const [posts, setPosts] = useState(initialPosts);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsFailed, setPostsFailed] = useState(initialPostsFailed);
  const feedTicket = useRef(0);
  const isFirstFeed = useRef(true);

  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await fetchSession();
        if (cancelled) return;
        setSession(user);
        if (user) setUnread(await fetchUnreadCount());
      } catch {
        if (!cancelled) {
          setSession(null);
          setSessionError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 최초 렌더는 서버에서 이미 받아온 initialPosts를 그대로 쓰고, 필터를
    // 바꿨을 때만 새로 요청한다(마운트 직후 중복 요청 방지).
    if (isFirstFeed.current) {
      isFirstFeed.current = false;
      return;
    }
    const ticket = ++feedTicket.current;
    setPostsLoading(true);
    setPostsFailed(false);
    fetchTodayPosts({category, period, limit: 4})
      .then((data) => {
        if (ticket !== feedTicket.current) return;
        setPosts(data);
      })
      .catch(() => {
        if (ticket !== feedTicket.current) return;
        setPostsFailed(true);
      })
      .finally(() => {
        if (ticket === feedTicket.current) setPostsLoading(false);
      });
  }, [category, period]);

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      setSession(null);
      setUnread(0);
    } catch (error) {
      // 로그아웃 실패는 조용히 무시하지 않고 세션을 다시 확인해 화면을 맞춘다.
      if (!(error instanceof ApiError)) setSessionError(true);
      setSession(await fetchSession().catch(() => null));
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim();
    window.location.href = value ? `/community?q=${encodeURIComponent(value)}` : '/community';
  }

  const heroHref = session ? '/home' : '/login?next=%2F';
  const moreHref = `/community?sort=popular${category ? `&category=${encodeURIComponent(category)}` : ''}`;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a href="/" className={styles.logo} aria-label="morethancar 홈">
            <Logo height={56} />
          </a>
          <div className={styles.searchWrap}>
            <form className={styles.search} role="search" onSubmit={submitSearch}>
              <label className={styles.srOnly} htmlFor="home-search">
                차종, 게시글, 유저 검색
              </label>
              <span className={styles.searchIcon} aria-hidden="true">
                🔍
              </span>
              <input
                id="home-search"
                type="search"
                placeholder="차종, 게시글, 유저 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
              />
            </form>
          </div>
          <div className={styles.rightGroup}>
            <nav className={styles.nav} aria-label="주 메뉴">
              <a href="/" aria-current="page">
                홈
              </a>
              <a href="/community">커뮤니티</a>
              <a href="/home">내 차고</a>
              <a href="/parts">부품장터</a>
              {session?.role === 'ADMIN' && <a href="/admin">관리</a>}
            </nav>
            <div className={styles.headerActions}>
              <span className={styles.bell} aria-label={unread ? `읽지 않은 알림 ${unread}개` : '새 알림 없음'}>
                알림{unread > 0 && <span className={styles.bellCount}>{unread}</span>}
              </span>
              {session ? (
                <>
                  <span className={styles.avatar} aria-hidden="true">
                    {session.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className={styles.username}>{session.username} 님</span>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={handleLogout}>
                    로그아웃
                  </button>
                </>
              ) : (
                <a className={styles.secondary} href="/login?next=%2F">
                  로그인 / 가입
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      {sessionError && (
        <p className={styles.notice} role="status">
          로그인 상태를 확인하지 못했어요. 새로고침해주세요.
        </p>
      )}

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <h1 id="hero-title" className={styles.heroTitle}>
            <span style={{animationDelay: '80ms'}}>당신의 드라이빙이</span>
            <span style={{animationDelay: '180ms'}}>콘텐츠가 되는 곳</span>
            <span style={{animationDelay: '280ms'}}>morethancar</span>
          </h1>
          <a className={styles.heroCta} href={heroHref}>
            지금, 내 차고 만들기 <span className={styles.arrow}>→</span>
          </a>
        </div>
        <div className={styles.heroVisual} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/main/hero-drive.jpg" alt="" />
          <div className={styles.heroOverlay} />
        </div>
      </section>

      <section className={styles.mainGrid} aria-label="morethancar 메인 콘텐츠">
        <section className={styles.feedSection} aria-labelledby="today-posts-title">
          <div className={styles.sectionHeading}>
            <h2 id="today-posts-title">오늘의 인기글</h2>
            <a className={styles.textLink} href={moreHref}>
              더보기 →
            </a>
          </div>
          <div className={styles.feedFilters}>
            <div className={styles.filterGroup} role="group" aria-label="카테고리 선택">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value || 'all'}
                  type="button"
                  className={category === c.value ? styles.filterActive : ''}
                  aria-pressed={category === c.value}
                  onClick={() => setCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className={styles.filterGroup} role="group" aria-label="기간 선택">
              {PERIODS.map((p) => (
                <button
                  key={p.value || 'all-time'}
                  type="button"
                  className={period === p.value ? styles.filterActive : ''}
                  aria-pressed={period === p.value}
                  onClick={() => setPeriod(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.postGrid} aria-live="polite" aria-busy={postsLoading}>
            {postsFailed ? (
              <p className={styles.empty}>이야기를 불러오지 못했어요. 새로고침해주세요.</p>
            ) : !posts.length ? (
              <p className={styles.empty}>
                {period === 'today' ? '오늘 등록된 이야기가 아직 없어요.' : '조건에 맞는 이야기가 없어요.'}
              </p>
            ) : (
              posts.map((post, i) => (
                <Reveal key={post.id} delayMs={i * 60}>
                  <PostCard post={post} />
                </Reveal>
              ))
            )}
          </div>
        </section>

        <aside className={styles.sidebar} aria-labelledby="popular-title">
          <div className={styles.sectionHeading}>
            <h2 id="popular-title">실시간 인기</h2>
          </div>
          <PopularList posts={popularPosts} />
        </aside>
      </section>

      <section className={styles.lowerGrid} aria-label="내 차고 · 부품장터 미리보기">
        <section className={styles.sidebarSection} aria-labelledby="garage-spotlight-title">
          <div className={styles.sectionHeading}>
            <h2 id="garage-spotlight-title">오늘의 차고</h2>
          </div>
          <Reveal>
            <GarageSpotlight vehicle={garageSpotlight} />
          </Reveal>
        </section>
        <section className={styles.sidebarSection} aria-labelledby="market-spotlight-title">
          <div className={styles.sectionHeading}>
            <h2 id="market-spotlight-title">장터 새 매물</h2>
            <a className={styles.textLink} href="/parts">
              전체보기 →
            </a>
          </div>
          <Reveal>
            <MarketSpotlight listings={market} />
          </Reveal>
        </section>
      </section>

      <SiteFooter />
    </div>
  );
}
