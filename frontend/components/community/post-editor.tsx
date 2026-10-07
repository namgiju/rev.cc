'use client';

import {useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
import {usePathname, useSearchParams} from 'next/navigation';
import {
  ApiError,
  createPost,
  fetchMyVehicles,
  fetchPost,
  updatePost,
  uploadImage,
} from '../../lib/community-api';
import type {CommunityPost, MyVehicle, PostInput} from '../../lib/community-types';
import type {PostCategory} from '../../lib/home-types';
import {imageUrl, postUrl} from '../../lib/format';
import CommunityHeader from './community-header';
import CommunityLeftNav from './community-left-nav';
import CommunitySidebar from './community-sidebar';
import SiteFooter from '../footer/site-footer';
import {HEADINGS, isCategory} from './categories';
import {useCommunitySession} from './use-community-session';
import styles from './community.module.css';
import editorStyles from './post-editor.module.css';

const MAX_IMAGES = 3;
const TITLE_MAX = 150;
const CONTENT_MAX = 5000;

type Fields = Omit<PostInput, 'vehicleId'> & {vehicleId: string};
type LoadState =
  | {status: 'loading'}
  | {status: 'login'}
  | {status: 'not-found'}
  | {status: 'error'}
  | {status: 'forbidden'; post: CommunityPost}
  | {status: 'ready'; post: CommunityPost | null};
type Vehicles = MyVehicle[] | 'loading' | 'error';

const snapshot = (fields: Fields) => JSON.stringify(fields);

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return '로그인이 만료되었어요. 다시 로그인해주세요.';
  return error instanceof Error ? error.message : '요청을 처리하지 못했어요.';
}

// Post composer for both /community/new and /community/{category}/{id}/edit.
// Ports assignment-frontend/js/post-editor.js: same fields and limits, the
// optional "내 차량 연결" select (submit stays locked until the member's
// vehicles are known), up to 3 photos through the existing image upload,
// owner-only editing, dirty-leave confirmation and a submission lock.
export default function PostEditor({postId}: {postId?: number}) {
  const isEdit = postId != null;
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const auth = useCommunitySession();
  const {session, sessionError} = auth;

  const initialCategory = (() => {
    const value = searchParams.get('category');
    return isCategory(value) ? value : 'free';
  })();
  const emptyFields: Fields = {category: initialCategory, title: '', content: '', vehicle: '', vehicleId: '', imageIds: []};

  const [load, setLoad] = useState<LoadState>({status: 'loading'});
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [vehicles, setVehicles] = useState<Vehicles>('loading');
  const [baseline, setBaseline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');

  // Bumped whenever the editor (re)loads, so a late upload/vehicle response
  // from a previous session or post can't land in the current form.
  const version = useRef(0);
  const busyRef = useRef(false);
  const uploadingRef = useRef(false);
  const leaving = useRef(false);

  const dirty = baseline !== null && snapshot(fields) !== baseline;
  const ready = load.status === 'ready' && Array.isArray(vehicles);
  const post = load.status === 'ready' ? load.post : null;
  const returnTo = post ? postUrl(post) : `/community${isCategory(searchParams.get('category')) ? `?category=${initialCategory}` : ''}`;

  // --- Load: wait for the session, then (edit) the post, then my vehicles. ---
  const loadVehicles = useCallback(async (request: number, initial: Fields) => {
    setVehicles('loading');
    try {
      const cars = await fetchMyVehicles();
      if (request !== version.current) return;
      // Like the legacy <select>: a link to a vehicle that isn't mine (any
      // more) falls back to "연결하지 않음".
      const linked = cars.some((c) => String(c.id) === initial.vehicleId) ? initial.vehicleId : '';
      const start = {...initial, vehicleId: linked};
      setVehicles(cars);
      setFields((f) => ({...f, vehicleId: linked}));
      setBaseline(snapshot(start));
    } catch {
      if (request === version.current) setVehicles('error');
    }
  }, []);

  const sessionKey = session === undefined ? 'pending' : session?.id ?? 'anon';
  const loadedFields = useRef<Fields>(emptyFields);
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
      setLoad({status: 'login'});
      return;
    }
    setLoad({status: 'loading'});
    (async () => {
      let existing: CommunityPost | null = null;
      if (isEdit) {
        try {
          existing = await fetchPost(postId);
        } catch (error) {
          if (request !== version.current) return;
          setLoad({status: error instanceof ApiError && error.status === 404 ? 'not-found' : 'error'});
          return;
        }
        if (request !== version.current) return;
        // Editing is author-only for USER and ADMIN alike (PUT checks author_id).
        if (existing.authorId !== sessionKey) {
          setLoad({status: 'forbidden', post: existing});
          return;
        }
        const canonical = `${postUrl(existing)}/edit`;
        if (canonical !== window.location.pathname) window.history.replaceState(null, '', canonical);
      }
      const initial: Fields = existing
        ? {
            category: existing.category,
            title: existing.title,
            content: existing.content,
            vehicle: existing.vehicle || '',
            vehicleId: existing.vehicleId == null ? '' : String(existing.vehicleId),
            imageIds: [...existing.imageIds],
          }
        : emptyFields;
      loadedFields.current = initial;
      setFields(initial);
      setLoad({status: 'ready', post: existing});
      await loadVehicles(request, initial);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, postId]);

  // --- Leaving with unsaved changes (post-editor.js's navigate/beforeunload). ---
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
    // Any plain link on the page (header, sidebar, footer) goes through the
    // same confirmation instead of the browser's generic leave prompt.
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
    if (!fields.title.trim()) return setFormError('제목을 입력해주세요.');
    if (!fields.content.trim()) return setFormError('본문을 입력해주세요.');
    const request = version.current;
    busyRef.current = true;
    setBusy(true);
    setFormError('');
    const input: PostInput = {...fields, vehicleId: fields.vehicleId ? Number(fields.vehicleId) : null};
    try {
      const result = post ? await updatePost(post.id, input) : await createPost(input);
      if (request !== version.current) return;
      leaving.current = true;
      window.location.assign(postUrl({id: result.id, category: result.category || input.category}));
    } catch (error) {
      if (request !== version.current) return;
      setFormError(errorText(error));
      busyRef.current = false;
      setBusy(false);
    }
  }

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((f) => ({...f, [key]: value}));
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;
  const heading = isEdit ? '게시글 수정' : '새 글 작성';

  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={(value) => navigate(value ? `/community?q=${encodeURIComponent(value)}` : '/community')}
        loginNext={encodeURIComponent(pathname)}
      />
      {sessionError && (
        <p className={styles.notice} role="status">
          로그인 상태를 확인하지 못했어요. 새로고침해주세요.
        </p>
      )}

      <div className={styles.layout}>
        <CommunityLeftNav
          category={fields.category}
          scope=""
          onCategory={(value) => navigate(value ? `/community?category=${value}` : '/community')}
          onScope={(value) => navigate(`/community?scope=${value}`)}
        />

        <section className={editorStyles.editor} aria-labelledby="editor-heading">
          <p className={editorStyles.breadcrumb}>
            <a href="/community">커뮤니티</a> / <span>{HEADINGS[fields.category][0]}</span> / {isEdit ? '수정' : '글쓰기'}
          </p>
          <h1 id="editor-heading">{heading}</h1>
          <p className={styles.muted}>자동차와 관련된 다양한 이야기를 자유롭게 공유해주세요.</p>

          {load.status === 'loading' && <p className={styles.empty}>글쓰기 화면을 준비하고 있어요.</p>}
          {load.status === 'login' && (
            <div className={editorStyles.loginBox}>
              <p>글을 작성하려면 로그인이 필요합니다.</p>
              <a className={editorStyles.primary} href={loginHref}>
                로그인하기
              </a>
            </div>
          )}
          {load.status === 'not-found' && (
            <p className={styles.empty}>
              삭제되었거나 없는 이야기예요. <a href="/community">목록으로 돌아가기</a>
            </p>
          )}
          {load.status === 'error' && (
            <p className={styles.empty}>
              글을 불러오지 못했어요. 새로고침해주세요.
            </p>
          )}
          {load.status === 'forbidden' && (
            <p className={styles.empty} role="alert">
              본인이 작성한 글만 수정할 수 있어요. <a href={postUrl(load.post)}>글로 돌아가기</a>
            </p>
          )}

          {load.status === 'ready' && (
            <form className={editorStyles.form} onSubmit={submit} aria-busy={busy}>
              <fieldset disabled={busy} className={editorStyles.fieldset}>
                {isEdit && <div className={editorStyles.editStatus}>게시글 수정 중</div>}
                <label>
                  게시판 선택
                  <select
                    name="category"
                    required
                    value={fields.category}
                    onChange={(e) => set('category', e.target.value as PostCategory)}
                  >
                    <option value="free">자유게시판</option>
                    <option value="maintenance">정비 / DIY</option>
                    <option value="parts">부품 이야기</option>
                    <option value="drive">드라이브</option>
                  </select>
                </label>

                <label htmlFor="post-title">제목</label>
                <input
                  id="post-title"
                  name="title"
                  required
                  maxLength={TITLE_MAX}
                  placeholder="제목을 입력해주세요."
                  value={fields.title}
                  onChange={(e) => set('title', e.target.value)}
                />
                <small className={editorStyles.count}>
                  {fields.title.length} / {TITLE_MAX}
                </small>

                <div className={editorStyles.vehicles} aria-live="polite">
                  {vehicles === 'loading' && <p className={styles.muted}>내 차량을 확인하고 있어요.</p>}
                  {vehicles === 'error' && (
                    <>
                      <p className={styles.muted}>내 차량을 확인하지 못했어요. 다시 확인 후 작성해주세요.</p>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => void loadVehicles(version.current, loadedFields.current)}
                      >
                        다시 확인
                      </button>
                    </>
                  )}
                  {Array.isArray(vehicles) && vehicles.length > 0 && (
                    <label>
                      내 차량 연결 (선택)
                      <select
                        name="vehicleId"
                        value={fields.vehicleId}
                        // A legacy text-only vehicle label is kept unless the link changes.
                        onChange={(e) => setFields((f) => ({...f, vehicleId: e.target.value, vehicle: ''}))}
                      >
                        <option value="">연결하지 않음</option>
                        {vehicles.map((car) => (
                          <option key={car.id} value={String(car.id)}>
                            {`${car.manufacturer || ''} ${car.model} (${car.year})`.trim()}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {Array.isArray(vehicles) && vehicles.length === 0 && (
                    <>
                      <p>등록된 차량이 없습니다.</p>
                      <p className={styles.muted}>차량을 등록하면 게시글에 내 차량을 연결할 수 있습니다.</p>
                      <a className={styles.textLink} href="/home">
                        내 차고에서 차량 등록 →
                      </a>
                    </>
                  )}
                </div>

                <label htmlFor="post-content">본문</label>
                <p className={styles.muted}>일반 텍스트로 저장됩니다. 사진은 아래에서 첨부해주세요.</p>
                <textarea
                  id="post-content"
                  name="content"
                  required
                  maxLength={CONTENT_MAX}
                  rows={14}
                  placeholder="내용을 입력해주세요."
                  value={fields.content}
                  onChange={(e) => set('content', e.target.value)}
                />
                <small className={editorStyles.count}>
                  {fields.content.length} / {CONTENT_MAX}
                </small>

                <p className={editorStyles.uploadLabel}>
                  사진 첨부 <span>JPG · PNG · WebP / 장당 3MB, 최대 3장</span>
                </p>
                <label htmlFor="post-images" className={editorStyles.addPhoto} aria-disabled={uploading}>
                  ＋ 사진 추가
                </label>
                <input
                  id="post-images"
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
                <div className={editorStyles.previews}>
                  {fields.imageIds.map((id) => (
                    <div key={id} className={editorStyles.preview}>
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
                <p className={editorStyles.error} role="alert">
                  {formError}
                </p>
              )}
              <div className={editorStyles.actions}>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => navigate(returnTo)}>
                  취소
                </button>
                <button type="submit" className={editorStyles.primary} disabled={busy || uploading || !ready}>
                  {busy ? '저장 중…' : isEdit ? '수정 저장' : '등록하기'}
                </button>
              </div>
            </form>
          )}
        </section>

        <CommunitySidebar session={session}>
          <section className={styles.sideSection}>
            <h2>커뮤니티 이용 수칙</h2>
            <ul className={editorStyles.helpList}>
              <li>서로 존중하는 마음으로 작성해주세요.</li>
              <li>욕설, 비방, 광고성 글은 제한될 수 있어요.</li>
              <li>자동차와 관련된 유익한 정보를 공유해주세요.</li>
              <li>개인정보 노출에 주의해주세요.</li>
            </ul>
          </section>
          <section className={styles.sideSection}>
            <h2>글 작성 팁</h2>
            <p className={styles.muted}>구체적인 제목과 사진은 이야기를 이해하는 데 도움이 됩니다.</p>
            <p className={styles.muted}>관련된 내 차량을 연결하면 다른 오너들과 더 쉽게 소통할 수 있어요.</p>
          </section>
        </CommunitySidebar>
      </div>

      <SiteFooter />
    </div>
  );
}
