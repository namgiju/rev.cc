'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {ApiError} from '../../lib/community-api';
import {fetchListings, setListingFavorite} from '../../lib/parts-api';
import {LISTING_CATEGORIES, LISTING_STATUSES, type Listing, type ListingCategory, type ListingStatus} from '../../lib/parts-types';
import {listingUrl} from '../../lib/format';
import {useCommunitySession} from '../community/use-community-session';
import CommunityHeader from '../community/community-header';
import SiteFooter from '../footer/site-footer';
import ListingCard from './listing-card';
import PartsSidebar from './parts-sidebar';
import styles from './parts.module.css';

const PAGE_LIMIT = 12;
type Sort = 'latest' | 'popular' | 'price-low' | 'price-high';
type Scope = '' | 'mine' | 'favorites';

function isCategory(value: string | null): value is ListingCategory | '' {
  return value === '' || value === null ? false : Object.keys(LISTING_CATEGORIES).includes(value);
}
function isStatus(value: string | null): value is ListingStatus {
  return !!value && Object.keys(LISTING_STATUSES).includes(value);
}

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return '로그인이 만료되었어요. 다시 로그인해주세요.';
  return error instanceof Error ? error.message : '요청을 처리하지 못했어요.';
}

// /parts — ports assignment-frontend/parts/index.html + js/market.js's list
// screen: category nav, search/status/region/vehicle/sort filters, scope
// (mine/favorites), numbered pagination, and the popular/MY GARAGE/recent
// sidebar. Parts compatibility is a separate, unrelated feature and is not
// part of this page (2026-10-06 decision).
export default function PartsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const auth = useCommunitySession();
  const {session, sessionError} = auth;

  const [category, setCategory] = useState<ListingCategory | ''>(() => {
    const v = searchParams.get('category');
    return isCategory(v) ? v : '';
  });
  const [status, setStatus] = useState<ListingStatus | ''>(() => {
    const v = searchParams.get('status');
    return isStatus(v) ? v : '';
  });
  const [sort, setSort] = useState<Sort>(() => {
    const v = searchParams.get('sort');
    return v === 'popular' || v === 'price-low' || v === 'price-high' ? v : 'latest';
  });
  const [scope, setScope] = useState<Scope>(() => {
    const v = searchParams.get('scope');
    return v === 'mine' || v === 'favorites' ? v : '';
  });
  const [region, setRegion] = useState(() => (searchParams.get('region') || '').slice(0, 100));
  const [regionInput, setRegionInput] = useState(region);
  const [vehicle, setVehicle] = useState(() => (searchParams.get('vehicle') || '').slice(0, 200));
  const [vehicleInput, setVehicleInput] = useState(vehicle);
  const [q, setQ] = useState(() => (searchParams.get('q') || '').slice(0, 100));
  const [qInput, setQInput] = useState(q);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));

  // Reflect filters back into the URL without pushing a new history entry.
  useEffect(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    if (region) params.set('region', region);
    if (vehicle) params.set('vehicle', vehicle);
    if (q) params.set('q', q);
    if (sort !== 'latest') params.set('sort', sort);
    if (scope) params.set('scope', scope);
    if (page !== 1) params.set('page', String(page));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, {scroll: false});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, status, region, vehicle, q, sort, scope, page]);

  // Legacy /parts#listing-{id} hash opened a detail dialog on this same page;
  // it now has its own route.
  useEffect(() => {
    function route() {
      const match = /^#listing-([1-9]\d*)$/.exec(window.location.hash);
      if (match) window.location.replace(listingUrl(Number(match[1])));
    }
    route();
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  }, []);

  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const feedTicket = useRef(0);

  const loadListings = useCallback(
    async (pageNum: number) => {
      const ticket = ++feedTicket.current;
      setListLoading(true);
      setListFailed(false);
      try {
        const data = await fetchListings({
          q,
          category,
          status,
          region,
          vehicle,
          sort,
          scope,
          page: pageNum,
          limit: PAGE_LIMIT,
        });
        if (ticket !== feedTicket.current) return;
        const pages = Math.max(1, Math.ceil(data.total / data.limit));
        if (pageNum > pages) {
          setPage(pages);
          return;
        }
        setItems(data.items);
        setTotal(data.total);
      } catch {
        if (ticket === feedTicket.current) setListFailed(true);
      } finally {
        if (ticket === feedTicket.current) setListLoading(false);
      }
    },
    [q, category, status, region, vehicle, sort, scope],
  );

  useEffect(() => {
    // scope는 로그인이 필요하다. 세션 확인 전에는 기다리고, 비로그인이면
    // 요청 없이 안내만 보여준다(market.js: `if (filters.scope && !state.user)`).
    if (scope && session === undefined) return;
    if (scope && !session) {
      setItems([]);
      setTotal(0);
      setListFailed(false);
      setListLoading(false);
      return;
    }
    void loadListings(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, status, region, vehicle, q, sort, scope, page, session]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegion(regionInput.trim());
    setVehicle(vehicleInput.trim());
    setQ(qInput.trim());
    setPage(1);
  }
  function resetFilters() {
    setQInput('');
    setQ('');
    setCategory('');
    setStatus('');
    setRegionInput('');
    setRegion('');
    setVehicleInput('');
    setVehicle('');
    setSort('latest');
    setScope('');
    setPage(1);
  }
  function requireLoginScope(target: Scope) {
    if (!session) {
      window.location.href = `/login?next=${encodeURIComponent(pathname)}`;
      return;
    }
    // Unlike picking a category, picking a scope does not clear the category
    // filter (market.js parity).
    setScope(target);
    setPage(1);
  }

  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 7000);
  }, []);

  const [favoriteBusy, setFavoriteBusy] = useState<Set<number>>(new Set());
  async function toggleFavorite(item: Listing) {
    if (!session) {
      notify('로그인 후 이용할 수 있어요. 상단의 로그인 / 가입을 눌러주세요.');
      return;
    }
    if (favoriteBusy.has(item.id)) return;
    setFavoriteBusy((prev) => new Set(prev).add(item.id));
    try {
      await setListingFavorite(item.id, !item.favorited);
      await loadListings(page);
    } catch (error) {
      notify(errorText(error));
    } finally {
      setFavoriteBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  const scopeBlocked = !!scope && session !== undefined && !session;
  const pages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const scopeLabel = scope === 'mine' ? '내 판매글' : scope === 'favorites' ? '관심 매물' : '전체 매물';

  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search={qInput}
        onSearchChange={setQInput}
        onSearchSubmit={(value) => {
          setQ(value);
          setPage(1);
        }}
        loginNext={encodeURIComponent('/parts')}
      />
      {sessionError && (
        <p className={styles.notice} role="status">
          로그인 상태를 확인하지 못했어요. 새로고침해주세요.
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <div className={styles.layout}>
        <nav className={styles.leftNav} aria-label="부품장터 메뉴">
          <h2>부품장터</h2>
          <div className={styles.categoryList} role="group" aria-label="부품 카테고리">
            <button
              type="button"
              aria-pressed={category === ''}
              onClick={() => {
                setCategory('');
                setScope('');
                setPage(1);
              }}
            >
              전체 매물
            </button>
            {(Object.keys(LISTING_CATEGORIES) as ListingCategory[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => {
                  setCategory(value);
                  setScope('');
                  setPage(1);
                }}
              >
                {LISTING_CATEGORIES[value]}
              </button>
            ))}
          </div>
          <a className={styles.primary} href="/parts/new">
            ＋ 판매글 등록
          </a>
          <div className={styles.shortcuts}>
            <h3>내 거래</h3>
            <button type="button" aria-pressed={scope === 'mine'} onClick={() => requireLoginScope('mine')}>
              내 판매글
            </button>
            <button type="button" aria-pressed={scope === 'favorites'} onClick={() => requireLoginScope('favorites')}>
              관심 매물
            </button>
          </div>
          <a className={styles.textLink} href="/community?category=parts">
            부품 질문·후기 게시판 →
          </a>
        </nav>

        <section className={styles.main} aria-labelledby="parts-title">
          <div className={styles.heading}>
            <div>
              <p className={styles.eyebrow}>MORETHANCAR PARTS MARKET</p>
              <h1 id="parts-title">좋은 부품, 새로운 드라이브.</h1>
              <p className={styles.muted}>오너와 오너를 연결하는 자동차 부품 직거래 장터</p>
            </div>
          </div>

          <form className={styles.filters} onSubmit={submitFilters}>
            <div className={styles.search}>
              <label className={styles.srOnly} htmlFor="market-query">
                매물 검색
              </label>
              <input
                id="market-query"
                maxLength={100}
                placeholder="부품명, 적용 차종, 키워드 검색"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
              <button className={styles.secondary} type="submit">
                검색
              </button>
            </div>
            <div className={styles.filterRow}>
              <label>
                카테고리
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value as ListingCategory | '');
                    setPage(1);
                  }}
                >
                  <option value="">전체 카테고리</option>
                  {(Object.keys(LISTING_CATEGORIES) as ListingCategory[]).map((value) => (
                    <option key={value} value={value}>
                      {LISTING_CATEGORIES[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                거래 상태
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as ListingStatus | '');
                    setPage(1);
                  }}
                >
                  <option value="">전체 상태</option>
                  {(Object.keys(LISTING_STATUSES) as ListingStatus[]).map((value) => (
                    <option key={value} value={value}>
                      {LISTING_STATUSES[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                지역
                <input
                  maxLength={100}
                  placeholder="예: 성남"
                  value={regionInput}
                  onChange={(e) => setRegionInput(e.target.value)}
                />
              </label>
              <label>
                적용 차종
                <input
                  maxLength={200}
                  placeholder="판매자 제공 차종"
                  value={vehicleInput}
                  onChange={(e) => setVehicleInput(e.target.value)}
                />
              </label>
              <label>
                정렬
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as Sort);
                    setPage(1);
                  }}
                >
                  <option value="latest">최신순</option>
                  <option value="popular">인기순</option>
                  <option value="price-low">낮은 가격순</option>
                  <option value="price-high">높은 가격순</option>
                </select>
              </label>
              <button type="submit" className={styles.secondary}>
                적용
              </button>
              <button type="button" className={styles.textLink} onClick={resetFilters}>
                필터 초기화
              </button>
            </div>
          </form>

          <p className={styles.summary}>
            {scopeBlocked ? '' : `${scopeLabel} ${total}개`}
          </p>

          <div className={styles.cards} aria-live="polite" aria-busy={listLoading}>
            {scopeBlocked ? (
              <p className={styles.empty}>
                내 판매글과 관심 매물을 보려면 로그인이 필요합니다. <a href="/login">로그인하기</a>
              </p>
            ) : listFailed ? (
              <p className={styles.empty}>
                매물을 불러오지 못했어요.{' '}
                <button type="button" className={styles.textLink} onClick={() => void loadListings(page)}>
                  다시 시도
                </button>
              </p>
            ) : !items.length && listLoading ? (
              <p className={styles.empty}>매물을 불러오고 있어요.</p>
            ) : !items.length ? (
              <p className={styles.empty}>조건에 맞는 매물이 없습니다. 필터를 바꾸거나 첫 판매글을 등록해보세요.</p>
            ) : (
              items.map((item) => (
                <ListingCard
                  key={item.id}
                  item={item}
                  favoriteBusy={favoriteBusy.has(item.id)}
                  onToggleFavorite={toggleFavorite}
                />
              ))
            )}
          </div>

          {!scopeBlocked && items.length > 0 && (
            <nav className={styles.pagination} aria-label="매물 페이지">
              <button type="button" className={styles.secondary} disabled={page === 1} onClick={() => setPage(page - 1)}>
                이전
              </button>
              {Array.from(
                {length: Math.min(pages, Math.max(5, page + 2)) - Math.max(1, Math.min(page - 2, pages - 4)) + 1},
                (_, i) => Math.max(1, Math.min(page - 2, pages - 4)) + i,
              ).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={styles.secondary}
                  aria-current={p === page ? 'page' : undefined}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <button type="button" className={styles.secondary} disabled={page >= pages} onClick={() => setPage(page + 1)}>
                다음
              </button>
            </nav>
          )}
        </section>

        <PartsSidebar session={session} />
      </div>

      <SiteFooter />
    </div>
  );
}
