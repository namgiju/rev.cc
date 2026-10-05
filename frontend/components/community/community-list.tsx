'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {fetchPosts} from '../../lib/community-api';
import type {CommunityPost} from '../../lib/community-types';
import PostRow from './post-row';
import CommunityLeftNav from './community-left-nav';
import CommunitySidebar from './community-sidebar';
import {HEADINGS, isCategory, isScope, newPostHref, SCOPE_LABELS, type Category, type Scope} from './categories';
import CommunityHeader from './community-header';
import {useCommunitySession} from './use-community-session';
import SiteFooter from '../footer/site-footer';
import styles from './community.module.css';

const PAGE_LIMIT = 20;

type Sort = 'latest' | 'popular';

export default function CommunityList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Legacy "new post" links were /community?category=…#write-post.
  useEffect(() => {
    if (window.location.hash === '#write-post') {
      window.location.replace(newPostHref(new URLSearchParams(window.location.search).get('category') || ''));
    }
  }, []);

  const auth = useCommunitySession();
  const {session, sessionError} = auth;

  // --- Filters, seeded once from the URL so the list is shareable/
  // bookmarkable (assignment-frontend/js/community-list.js's sync()). ---
  const [category, setCategory] = useState<Category>(() => {
    const value = searchParams.get('category');
    return isCategory(value) ? value : '';
  });
  const [sort, setSort] = useState<Sort>(() => (searchParams.get('sort') === 'popular' ? 'popular' : 'latest'));
  const [scope, setScope] = useState<Scope>(() => {
    const value = searchParams.get('scope');
    return isScope(value) ? value : '';
  });
  const [vehicleFilter, setVehicleFilter] = useState(() => (searchParams.get('vehicle') || '').slice(0, 100));
  const [vehicleInput, setVehicleInput] = useState(vehicleFilter);
  const [query, setQuery] = useState(() => (searchParams.get('q') || '').slice(0, 100));
  const [searchInput, setSearchInput] = useState(query);

  // Reflect filters back into the URL without pushing a new history entry
  // (history.replaceState's Next.js equivalent).
  useEffect(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (query) params.set('q', query);
    if (vehicleFilter) params.set('vehicle', vehicleFilter);
    if (scope) params.set('scope', scope);
    if (sort !== 'latest') params.set('sort', sort);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, {scroll: false});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, query, vehicleFilter, scope, sort]);

  // --- Post list ---
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [page, setPage] = useState(1);
  const [lastBatchSize, setLastBatchSize] = useState(0);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsFailed, setPostsFailed] = useState(false);
  const feedTicket = useRef(0);

  const loadPosts = useCallback(
    async (pageNum: number, append: boolean) => {
      const ticket = ++feedTicket.current;
      setPostsLoading(true);
      setPostsFailed(false);
      try {
        const batch = await fetchPosts({
          q: query,
          category,
          sort,
          scope,
          vehicle: vehicleFilter,
          page: pageNum,
          limit: PAGE_LIMIT,
        });
        if (ticket !== feedTicket.current) return;
        setPosts((prev) => (append ? [...prev, ...batch] : batch));
        setPage(pageNum);
        setLastBatchSize(batch.length);
      } catch {
        if (ticket === feedTicket.current) setPostsFailed(true);
      } finally {
        if (ticket === feedTicket.current) setPostsLoading(false);
      }
    },
    [query, category, sort, scope, vehicleFilter],
  );

  useEffect(() => {
    // 활동 범위(scope)는 로그인이 필요하다. 세션 확인이 끝나기 전에는 기다리고,
    // 로그인 상태가 아니면 호출 없이(401 방지) 안내만 보여준다.
    if (scope && session === undefined) return;
    if (scope && !session) {
      setPosts([]);
      setLastBatchSize(0);
      setPostsFailed(false);
      setPostsLoading(false);
      return;
    }
    void loadPosts(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sort, scope, vehicleFilter, query, session]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(searchInput.trim());
  }
  function applyVehicleFilter() {
    setVehicleFilter(vehicleInput.trim());
  }
  function resetFilters() {
    setSearchInput('');
    setQuery('');
    setCategory('');
    setVehicleInput('');
    setVehicleFilter('');
    setSort('latest');
    setScope('');
  }
  function requireLoginScope(target: Scope) {
    if (!session) {
      window.location.href = '/login?next=%2Fcommunity';
      return;
    }
    setScope(target);
  }

  const [title, description] = HEADINGS[category];
  const scopeBlocked = !!scope && session !== undefined && !session;

  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={(value) => {
          setCategory('');
          setScope('');
          setQuery(value);
        }}
        loginNext="%2Fcommunity"
      />

      {sessionError && (
        <p className={styles.notice} role="status">
          로그인 상태를 확인하지 못했어요. 새로고침해주세요.
        </p>
      )}

      <div className={styles.layout}>
        <CommunityLeftNav
          category={category}
          scope={scope}
          onCategory={(value) => {
            setCategory(value);
            setScope('');
          }}
          onScope={requireLoginScope}
        />

        <section className={styles.feedSection} aria-labelledby="community-title">
          <div className={styles.feedHeading}>
            <div>
              <p className={styles.eyebrow}>COMMUNITY</p>
              <h1 id="community-title">{title}</h1>
              <p className={styles.muted}>{description}</p>
            </div>
            <a className={styles.secondary} href={newPostHref(category)}>
              ＋ 글쓰기
            </a>
          </div>

          <form className={styles.searchForm} role="search" onSubmit={submitSearch}>
            <label className={styles.srOnly} htmlFor="search-input">
              게시글 검색
            </label>
            <input
              id="search-input"
              type="search"
              maxLength={100}
              placeholder="제목, 내용, 작성자 검색"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button className={styles.secondary} type="submit">
              검색
            </button>
          </form>

          <div className={styles.feedControls}>
            <label>
              정렬
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="latest">최신순</option>
                <option value="popular">추천순</option>
              </select>
            </label>
            <label>
              차종
              <input
                placeholder="예: 아반떼 N"
                maxLength={100}
                value={vehicleInput}
                onChange={(e) => setVehicleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyVehicleFilter();
                  }
                }}
              />
            </label>
            <button type="button" className={styles.secondary} onClick={applyVehicleFilter}>
              적용
            </button>
            <button type="button" className={styles.textLink} onClick={resetFilters}>
              초기화
            </button>
          </div>

          {scope && (
            <div className={styles.activityScope}>
              <strong>{SCOPE_LABELS[scope as 'mine' | 'bookmarks' | 'commented']}</strong>
              <button type="button" className={styles.textLink} onClick={() => setScope('')}>
                전체 글 보기
              </button>
            </div>
          )}

          {query && !scopeBlocked && (
            <p className={styles.searchSummary}>
              “{query}” 검색 · {posts.length}개 표시
            </p>
          )}

          <div className={styles.feedTableHeading} aria-hidden="true">
            <span>제목</span>
            <span>작성자</span>
            <span>작성일</span>
            <span>조회</span>
            <span>추천</span>
            <span>댓글</span>
          </div>

          <div className={styles.feedList} aria-live="polite" aria-busy={postsLoading}>
            {scopeBlocked ? (
              <p className={styles.empty}>
                내 활동을 보려면 로그인이 필요합니다. <a href="/login?next=%2Fcommunity">로그인하기</a>
              </p>
            ) : postsFailed ? (
              <p className={styles.empty}>이야기를 불러오지 못했어요. 새로고침해주세요.</p>
            ) : !posts.length && postsLoading ? (
              <p className={styles.empty}>이야기를 불러오고 있어요.</p>
            ) : !posts.length ? (
              <p className={styles.empty}>
                {query || category || scope || vehicleFilter
                  ? '조건에 맞는 이야기가 없어요. 필터를 바꿔보세요.'
                  : '아직 이야기가 없어요. 첫 자동차 이야기를 남겨주세요.'}
              </p>
            ) : (
              posts.map((post) => <PostRow key={post.id} post={post} />)
            )}
          </div>

          {!scopeBlocked && lastBatchSize >= PAGE_LIMIT && (
            <button
              type="button"
              className={styles.secondary}
              disabled={postsLoading}
              onClick={() => void loadPosts(page + 1, true)}
            >
              이야기 더 보기
            </button>
          )}
        </section>

        <CommunitySidebar session={session} />
      </div>

      <SiteFooter />
    </div>
  );
}
