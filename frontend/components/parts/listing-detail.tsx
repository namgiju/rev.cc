'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ApiError} from '../../lib/community-api';
import {deleteListing, fetchListing, recordListingView, setListingFavorite, setListingStatus} from '../../lib/parts-api';
import {LISTING_CATEGORIES, LISTING_STATUSES, type ListingDetail as ListingDetailType, type ListingStatus} from '../../lib/parts-types';
import {formatMoney, imageUrl, memberUrl} from '../../lib/format';
import {forgetRecentListing, rememberRecentListing} from '../../lib/recent-listings';
import {useCommunitySession} from '../community/use-community-session';
import CommunityHeader from '../community/community-header';
import CommunityDialog, {type DialogSpec} from '../community/community-dialog';
import SiteFooter from '../footer/site-footer';
import PartsSidebar from './parts-sidebar';
import styles from './parts.module.css';

// Listings already view-counted in this page load (market.js's `seen` Set).
const viewedListings = new Set<number>();

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return '로그인이 만료되었어요. 다시 로그인해주세요.';
  return error instanceof Error ? error.message : '요청을 처리하지 못했어요.';
}

type State =
  | {status: 'loading'}
  | {status: 'not-found'}
  | {status: 'error'}
  | {status: 'ready'; item: ListingDetailType};

// /parts/{id}. Ports market.js's route()/renderDetail(): view count once per
// load, favorite toggle, contact revealed only when logged in (board-service
// omits it otherwise), seller link, own edit/delete/status change, admin
// delete with a reason, link copy, "최근 본 매물".
export default function ListingDetail({listingId}: {listingId: number}) {
  const auth = useCommunitySession();
  const {session, sessionError} = auth;

  const [detail, setDetail] = useState<State>({status: 'loading'});
  const [reloadKey, setReloadKey] = useState(0);

  const sessionKey = session === undefined ? 'pending' : (session?.id ?? 'anon');
  useEffect(() => {
    if (sessionKey === 'pending') return;
    let cancelled = false;
    (async () => {
      let item: ListingDetailType;
      try {
        item = await fetchListing(listingId);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          forgetRecentListing(listingId);
          setDetail({status: 'not-found'});
        } else {
          setDetail({status: 'error'});
        }
        return;
      }
      if (cancelled) return;
      if (!viewedListings.has(listingId)) {
        viewedListings.add(listingId);
        try {
          item = {...item, views: (await recordListingView(listingId)).views};
        } catch {
          viewedListings.delete(listingId);
        }
      }
      if (cancelled) return;
      setDetail({status: 'ready', item});
      rememberRecentListing(item);
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId, sessionKey, reloadKey]);

  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 7000);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const requireLogin = useCallback(() => {
    if (session) return true;
    notify('로그인 후 이용할 수 있어요. 상단의 로그인 / 가입을 눌러주세요.');
    return false;
  }, [session, notify]);

  const refreshTicket = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++refreshTicket.current;
    try {
      const item = await fetchListing(listingId);
      if (ticket === refreshTicket.current) setDetail({status: 'ready', item});
    } catch {
      // Keep the current state; a manual reload will reconcile.
    }
  }, [listingId]);

  const [favoriteBusy, setFavoriteBusy] = useState(false);
  async function toggleFavorite() {
    if (!requireLogin() || detail.status !== 'ready' || favoriteBusy) return;
    setFavoriteBusy(true);
    try {
      await setListingFavorite(listingId, !detail.item.favorited);
      await refresh();
    } catch (error) {
      notify(errorText(error));
    } finally {
      setFavoriteBusy(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.origin + `/parts/${listingId}`);
    notify('매물 링크를 복사했어요.');
  }

  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  function requestDelete() {
    if (!requireLogin() || detail.status !== 'ready') return;
    const {item} = detail;
    const isOwn = session?.id === item.sellerId;
    setDialog(
      isOwn
        ? {
            kind: 'confirm',
            title: '삭제할까요?',
            message: '이 판매글을 삭제할까요?',
            confirmLabel: '삭제',
            onConfirm: async () => {
              await deleteListing(listingId);
              forgetRecentListing(listingId);
              window.location.href = '/parts';
            },
          }
        : {
            kind: 'reason',
            title: '관리자 삭제',
            description: '삭제 사유와 삭제 당시 원문이 운영 로그에 기록됩니다.',
            label: '삭제 사유 (필수)',
            emptyError: '삭제 사유를 입력해주세요.',
            submitLabel: '삭제',
            danger: true,
            onSubmit: async (reason) => {
              await deleteListing(listingId, reason);
              forgetRecentListing(listingId);
              window.location.href = '/parts';
            },
          },
    );
  }

  const [statusDraft, setStatusDraft] = useState<ListingStatus>('selling');
  useEffect(() => {
    if (detail.status === 'ready') setStatusDraft(detail.item.status);
  }, [detail]);
  const [statusBusy, setStatusBusy] = useState(false);
  async function saveStatus() {
    if (detail.status !== 'ready' || statusBusy) return;
    setStatusBusy(true);
    try {
      await setListingStatus(listingId, statusDraft);
      await refresh();
    } catch (error) {
      notify(errorText(error));
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search=""
        onSearchChange={() => {}}
        onSearchSubmit={(value) => {
          window.location.href = value ? `/community?q=${encodeURIComponent(value)}` : '/community';
        }}
        loginNext={encodeURIComponent(`/parts/${listingId}`)}
      />
      {sessionError && (
        <p className={styles.notice} role="status">
          로그인 상태를 확인하지 못했어요. 새로고침해주세요.
        </p>
      )}

      <main className={styles.detail}>
        <a href="/parts" className={styles.backLink}>
          ← 부품장터 목록으로
        </a>
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>

        {detail.status === 'ready' ? (
          <div className={styles.detailLayout}>
            <article>
              <span className={styles.detailStatus}>{LISTING_STATUSES[detail.item.status]}</span>
              <h1 className={styles.detailTitle}>{detail.item.title}</h1>
              <strong className={styles.detailPrice}>{formatMoney(detail.item.price)}</strong>
              <p className={styles.muted}>
                {detail.item.sellerId == null ? (
                  <span>{detail.item.username}</span>
                ) : (
                  <a href={memberUrl(detail.item.sellerId)}>{detail.item.username}</a>
                )}{' '}
                · {new Date(detail.item.createdAt).toLocaleString('ko-KR', {dateStyle: 'medium', timeStyle: 'short'})} · 조회{' '}
                {detail.item.views}
              </p>

              {detail.item.imageIds.length > 0 && (
                <div className={styles.gallery}>
                  {detail.item.imageIds.map((id) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={id} src={imageUrl(id)} alt={detail.item.title} />
                  ))}
                </div>
              )}

              <p className={styles.detailText}>{detail.item.description}</p>

              <dl className={styles.specs}>
                <div>
                  <dt>카테고리</dt>
                  <dd>{LISTING_CATEGORIES[detail.item.category]}</dd>
                </div>
                <div>
                  <dt>판매자 제공 적용 차량</dt>
                  <dd>{detail.item.vehicle}</dd>
                </div>
                <div>
                  <dt>거래 지역</dt>
                  <dd>{detail.item.region}</dd>
                </div>
              </dl>
              <p className={styles.muted}>적용 여부와 부품 상태는 판매자에게 확인해주세요. REV.CC가 호환성을 보증하지 않습니다.</p>

              <div className={styles.detailActions}>
                <button
                  type="button"
                  className={styles.favorite}
                  aria-pressed={detail.item.favorited}
                  disabled={favoriteBusy}
                  onClick={toggleFavorite}
                >
                  {detail.item.favorited ? '♥' : '♡'} 관심 {detail.item.favoriteCount}
                </button>
                <button type="button" className={styles.textLink} onClick={copyLink}>
                  매물 링크 복사
                </button>
              </div>

              <section className={styles.contact}>
                <h3>판매자와 직접 거래</h3>
                {session ? (
                  <>
                    <p>{detail.item.contact || '연락 방법을 확인하지 못했습니다.'}</p>
                    <p className={styles.muted}>판매자가 제공한 연락 방법입니다. 제품과 거래 조건을 직접 확인해주세요.</p>
                  </>
                ) : (
                  <>
                    <p>연락 방법은 로그인 후 확인할 수 있습니다.</p>
                    <a className={styles.textLink} href={`/login?next=${encodeURIComponent(`/parts/${listingId}`)}`}>
                      로그인하기
                    </a>
                  </>
                )}
              </section>

              {session?.role === 'ADMIN' && session.id !== detail.item.sellerId && (
                <div className={styles.ownerActions}>
                  <button type="button" className={styles.dangerText} onClick={requestDelete}>
                    관리자 삭제
                  </button>
                </div>
              )}

              {session?.id === detail.item.sellerId && (
                <div className={styles.ownerActions}>
                  <a className={styles.secondary} href={`/parts/${listingId}/edit`}>
                    판매글 수정
                  </a>
                  <button type="button" className={styles.dangerText} onClick={requestDelete}>
                    판매글 삭제
                  </button>
                  <label>
                    판매 상태
                    <select
                      aria-label="판매 상태 변경"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value as ListingStatus)}
                    >
                      {(Object.keys(LISTING_STATUSES) as ListingStatus[]).map((value) => (
                        <option key={value} value={value}>
                          {LISTING_STATUSES[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className={styles.secondary} disabled={statusBusy} onClick={saveStatus}>
                    상태 저장
                  </button>
                </div>
              )}
            </article>
            <PartsSidebar session={session} />
          </div>
        ) : (
          <div aria-busy={detail.status === 'loading'}>
            {detail.status === 'loading' && <p className={styles.empty}>매물을 확인하고 있어요.</p>}
            {detail.status === 'not-found' && (
              <p className={styles.empty}>
                삭제되었거나 없는 매물입니다. <a href="/parts">목록으로 돌아가기</a>
              </p>
            )}
            {detail.status === 'error' && (
              <p className={styles.empty}>
                매물을 불러오지 못했어요.{' '}
                <button
                  type="button"
                  className={styles.textLink}
                  onClick={() => {
                    setDetail({status: 'loading'});
                    setReloadKey((k) => k + 1);
                  }}
                >
                  다시 시도
                </button>
              </p>
            )}
          </div>
        )}
      </main>

      <SiteFooter />
      {dialog && <CommunityDialog spec={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
