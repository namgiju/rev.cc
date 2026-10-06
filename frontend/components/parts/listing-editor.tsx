'use client';

import {useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
import {usePathname} from 'next/navigation';
import {ApiError, fetchMember, uploadImage} from '../../lib/community-api';
import type {MemberVehicle} from '../../lib/community-types';
import {createListing, fetchListing, updateListing} from '../../lib/parts-api';
import {LISTING_CATEGORIES, LISTING_STATUSES, type ListingCategory, type ListingInput, type ListingStatus} from '../../lib/parts-types';
import {imageUrl, listingUrl} from '../../lib/format';
import {useCommunitySession} from '../community/use-community-session';
import CommunityHeader from '../community/community-header';
import PartsSidebar from './parts-sidebar';
import SiteFooter from '../footer/site-footer';
import styles from './parts.module.css';

const MAX_IMAGES = 3;
const FIRST_CATEGORY = Object.keys(LISTING_CATEGORIES)[0] as ListingCategory;

type Fields = {
  title: string;
  description: string;
  price: string;
  category: ListingCategory;
  status: ListingStatus;
  vehicle: string;
  region: string;
  contact: string;
  imageIds: number[];
};
type LoadState = 'loading' | 'login' | 'not-found' | 'error' | 'forbidden' | 'ready';
type Vehicles = MemberVehicle[] | 'loading' | 'error';

const emptyFields: Fields = {
  title: '',
  description: '',
  price: '',
  category: FIRST_CATEGORY,
  status: 'selling',
  vehicle: '',
  region: '',
  contact: '',
  imageIds: [],
};
const snapshot = (fields: Fields) => JSON.stringify(fields);

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return '로그인이 만료되었어요. 다시 로그인해주세요.';
  return error instanceof Error ? error.message : '요청을 처리하지 못했어요.';
}

// Listing composer for both /parts/new and /parts/{id}/edit. Ports
// assignment-frontend/js/market.js's edit(): same fields/limits, the "내 등록
// 차량에서 적용 정보 가져오기" prefill (text only, not a vehicle link), up to
// 3 photos through the existing image upload, owner-only editing, and a
// dirty-leave confirmation mirroring the community post editor's.
export default function ListingEditor({listingId}: {listingId?: number}) {
  const isEdit = listingId != null;
  const pathname = usePathname();
  const auth = useCommunitySession();
  const {session, sessionError} = auth;

  const [load, setLoad] = useState<LoadState>('loading');
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [vehicles, setVehicles] = useState<Vehicles>('loading');
  const [baseline, setBaseline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [formError, setFormError] = useState('');

  const version = useRef(0);
  const busyRef = useRef(false);
  const uploadingRef = useRef(false);
  const leaving = useRef(false);

  const dirty = baseline !== null && snapshot(fields) !== baseline;
  const ready = load === 'ready' && Array.isArray(vehicles);
  const returnTo = isEdit ? listingUrl(listingId) : '/parts';

  const loadVehicles = useCallback(async (request: number, userId: number) => {
    setVehicles('loading');
    try {
      const member = await fetchMember(userId);
      if (request !== version.current) return;
      setVehicles(member.vehicles);
    } catch {
      if (request === version.current) setVehicles('error');
    }
  }, []);

  const sessionKey = session === undefined ? 'pending' : (session?.id ?? 'anon');
  useEffect(() => {
    if (sessionKey === 'pending') return;
    const request = ++version.current;
    busyRef.current = false;
    uploadingRef.current = false;
    setBusy(false);
    setUploading(false);
    setUploadStatus('');
    setFormError('');
    setBaseline(null);
    if (sessionKey === 'anon') {
      setFields(emptyFields);
      setLoad('login');
      return;
    }
    setLoad('loading');
    (async () => {
      let initial = emptyFields;
      if (isEdit) {
        let existing;
        try {
          existing = await fetchListing(listingId);
        } catch (error) {
          if (request !== version.current) return;
          setLoad(error instanceof ApiError && error.status === 404 ? 'not-found' : 'error');
          return;
        }
        if (request !== version.current) return;
        if (existing.sellerId !== sessionKey) {
          setLoad('forbidden');
          return;
        }
        initial = {
          title: existing.title,
          description: existing.description,
          price: String(existing.price),
          category: existing.category,
          status: existing.status,
          vehicle: existing.vehicle,
          region: existing.region,
          contact: existing.contact ?? '',
          imageIds: [...existing.imageIds],
        };
      }
      setFields(initial);
      setBaseline(snapshot(initial));
      setLoad('ready');
      await loadVehicles(request, sessionKey as number);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, listingId]);

  // --- Leaving with unsaved changes (post-editor.tsx와 같은 패턴). ---
  const guard = useRef({dirty, busy, uploading});
  guard.current = {dirty, busy, uploading};
  const navigate = useCallback((url: string) => {
    const g = guard.current;
    if ((g.busy || g.uploading) && !window.confirm('처리 중입니다. 이 화면을 나갈까요?')) return;
    if (g.dirty && !window.confirm('작성 중인 내용이 사라집니다. 이동할까요?')) return;
    leaving.current = true;
    window.location.assign(url);
  }, []);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const g = guard.current;
      if (!leaving.current && (g.dirty || g.busy || g.uploading)) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    function onClick(e: MouseEvent) {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      if (a.hash && a.pathname === window.location.pathname) return;
      const g = guard.current;
      if (!g.dirty && !g.busy && !g.uploading) return;
      e.preventDefault();
      navigate(a.href);
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [navigate]);

  // --- Photos ---
  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || uploadingRef.current || busyRef.current) return;
    if (fields.imageIds.length + files.length > MAX_IMAGES) {
      setUploadStatus('사진은 최대 3장까지 첨부할 수 있어요.');
      return;
    }
    const request = version.current;
    uploadingRef.current = true;
    setUploading(true);
    setUploadStatus('사진 업로드 중…');
    try {
      for (const file of files) {
        const id = await uploadImage(file);
        if (request !== version.current) return;
        setFields((f) => ({...f, imageIds: [...f.imageIds, id]}));
      }
      setUploadStatus('사진 업로드 완료');
    } catch (error) {
      if (request === version.current) setUploadStatus(errorText(error));
    } finally {
      if (request === version.current) {
        uploadingRef.current = false;
        setUploading(false);
      }
    }
  }
  function removeImage(id: number) {
    if (busyRef.current || uploadingRef.current) return;
    setFields((f) => ({...f, imageIds: f.imageIds.filter((v) => v !== id)}));
  }

  // --- Submit ---
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || uploadingRef.current || !ready) return;
    const request = version.current;
    busyRef.current = true;
    setBusy(true);
    setFormError('');
    const input: ListingInput = {...fields, price: Number(fields.price)};
    try {
      const result = isEdit ? await updateListing(listingId, input) : await createListing(input);
      if (request !== version.current) return;
      leaving.current = true;
      window.location.assign(listingUrl(result.id));
    } catch (error) {
      if (request !== version.current) return;
      setFormError(errorText(error));
      busyRef.current = false;
      setBusy(false);
    }
  }

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((f) => ({...f, [key]: value}));
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;
  const heading = isEdit ? '판매글 수정' : '판매글 등록';

  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search=""
        onSearchChange={() => {}}
        onSearchSubmit={(value) => navigate(value ? `/community?q=${encodeURIComponent(value)}` : '/community')}
        loginNext={encodeURIComponent(pathname)}
      />
      {sessionError && (
        <p className={styles.notice} role="status">
          로그인 상태를 확인하지 못했어요. 새로고침해주세요.
        </p>
      )}

      <div className={styles.layout}>
        <nav className={styles.leftNav} aria-label="부품장터 메뉴">
          <h2>부품장터</h2>
          <button type="button" className={styles.secondary} onClick={() => navigate('/parts')}>
            ← 목록으로
          </button>
        </nav>

        <section className={styles.editor} aria-labelledby="editor-heading">
          <p className={styles.breadcrumb}>
            <a href="/parts">부품장터</a> / {isEdit ? '수정' : '판매글 등록'}
          </p>
          <h1 id="editor-heading">{heading}</h1>

          {load === 'loading' && <p className={styles.empty}>작성 화면을 준비하고 있어요.</p>}
          {load === 'login' && (
            <div className={styles.loginBox}>
              <p>판매글을 작성하려면 로그인이 필요합니다.</p>
              <a className={styles.primary} href={loginHref}>
                로그인하기
              </a>
            </div>
          )}
          {load === 'not-found' && (
            <p className={styles.empty}>
              삭제되었거나 없는 매물이에요. <a href="/parts">목록으로 돌아가기</a>
            </p>
          )}
          {load === 'error' && <p className={styles.empty}>매물을 불러오지 못했어요. 새로고침해주세요.</p>}
          {load === 'forbidden' && (
            <p className={styles.empty} role="alert">
              본인이 작성한 판매글만 수정할 수 있어요. <a href={listingUrl(listingId!)}>매물로 돌아가기</a>
            </p>
          )}

          {load === 'ready' && (
            <form className={styles.form} onSubmit={submit} aria-busy={busy}>
              <fieldset disabled={busy} className={styles.fieldset}>
                <label htmlFor="listing-title">제목</label>
                <input
                  id="listing-title"
                  required
                  maxLength={150}
                  value={fields.title}
                  onChange={(e) => set('title', e.target.value)}
                />

                <label htmlFor="listing-description">설명</label>
                <textarea
                  id="listing-description"
                  required
                  maxLength={5000}
                  rows={6}
                  placeholder="부품 상태, 사용 기간, 구성품을 설명해주세요."
                  value={fields.description}
                  onChange={(e) => set('description', e.target.value)}
                />

                <div className={styles.formRow}>
                  <label htmlFor="listing-price">
                    가격 (원)
                    <input
                      id="listing-price"
                      type="number"
                      required
                      min={0}
                      max={2000000000}
                      step={1}
                      value={fields.price}
                      onChange={(e) => set('price', e.target.value)}
                    />
                  </label>
                  <label>
                    카테고리
                    <select
                      required
                      value={fields.category}
                      onChange={(e) => set('category', e.target.value as ListingCategory)}
                    >
                      {(Object.keys(LISTING_CATEGORIES) as ListingCategory[]).map((value) => (
                        <option key={value} value={value}>
                          {LISTING_CATEGORIES[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    판매 상태
                    <select value={fields.status} onChange={(e) => set('status', e.target.value as ListingStatus)}>
                      {(Object.keys(LISTING_STATUSES) as ListingStatus[]).map((value) => (
                        <option key={value} value={value}>
                          {LISTING_STATUSES[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div aria-live="polite">
                  {vehicles === 'loading' && <p className={styles.muted}>내 차량을 확인하고 있어요.</p>}
                  {vehicles === 'error' && (
                    <>
                      <p className={styles.muted}>내 차량 정보를 불러오지 못했어요. 적용 차량은 직접 입력할 수 있습니다.</p>
                      <button
                        type="button"
                        className={styles.textLink}
                        onClick={() => session && void loadVehicles(version.current, session.id)}
                      >
                        다시 확인
                      </button>
                    </>
                  )}
                  {Array.isArray(vehicles) && vehicles.length > 0 && (
                    <label>
                      내 등록 차량에서 적용 정보 가져오기
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) set('vehicle', e.target.value);
                          e.target.value = '';
                        }}
                      >
                        <option value="">직접 입력</option>
                        {vehicles.map((v) => {
                          const text = [v.manufacturer, v.model, v.year, v.trim].filter(Boolean).join(' ');
                          return (
                            <option key={v.id} value={text}>
                              {text}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  )}
                </div>

                <label htmlFor="listing-vehicle">판매자 제공 적용 차량</label>
                <input
                  id="listing-vehicle"
                  required
                  maxLength={200}
                  placeholder="차종·연식·세부 규격을 직접 확인해 적어주세요."
                  value={fields.vehicle}
                  onChange={(e) => set('vehicle', e.target.value)}
                />

                <label htmlFor="listing-region">거래 지역</label>
                <input
                  id="listing-region"
                  required
                  maxLength={100}
                  placeholder="예: 경기 성남시 수정구"
                  value={fields.region}
                  onChange={(e) => set('region', e.target.value)}
                />

                <label htmlFor="listing-contact">연락 방법</label>
                <input
                  id="listing-contact"
                  required
                  maxLength={300}
                  placeholder="예: 이메일 또는 카카오 오픈채팅 주소"
                  value={fields.contact}
                  onChange={(e) => set('contact', e.target.value)}
                />
                <p className={styles.muted}>
                  연락 방법은 로그인한 회원에게 공개됩니다. 소개와 적용 차종은 판매자가 직접 제공하며 morethancar가 호환성을
                  판정하지 않습니다.
                </p>

                <p className={styles.uploadLabel}>
                  매물 사진 <span>JPG · PNG · WebP / 장당 3MB, 최대 3장</span>
                </p>
                <label htmlFor="listing-images" className={styles.addPhoto} aria-disabled={uploading}>
                  ＋ 사진 추가
                </label>
                <input
                  id="listing-images"
                  className={styles.srOnly}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={uploading}
                  onChange={onFiles}
                />
                <p className={styles.muted} role="status">
                  {uploadStatus}
                </p>
                <div className={styles.previews}>
                  {fields.imageIds.map((id) => (
                    <div key={id} className={styles.preview}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl(id)} alt="첨부 사진 미리보기" />
                      <button type="button" aria-label="첨부 사진 제거" disabled={uploading} onClick={() => removeImage(id)}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </fieldset>

              {formError && (
                <p className={styles.error} role="alert">
                  {formError}
                </p>
              )}
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => navigate(returnTo)}>
                  취소
                </button>
                <button type="submit" className={styles.primary} disabled={busy || uploading || !ready}>
                  {busy ? '저장 중…' : isEdit ? '수정 저장' : '판매글 등록'}
                </button>
              </div>
            </form>
          )}
        </section>

        <PartsSidebar session={session} />
      </div>

      <SiteFooter />
    </div>
  );
}
