'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {usePathname} from 'next/navigation';
import {
  ApiError,
  createComment,
  deleteComment,
  deletePost,
  fetchComments,
  fetchMember,
  fetchPost,
  recordPostView,
  reportPost,
  setPostBookmark,
  setPostLike,
} from '../../lib/community-api';
import type {CommunityComment, CommunityMember, CommunityPost} from '../../lib/community-types';
import {postUrl} from '../../lib/format';
import {forgetRecentPost, rememberRecentPost} from '../../lib/recent-posts';
import CommunityHeader from './community-header';
import {useCommunitySession} from './use-community-session';
import AuthorCard from './author-card';
import PostArticle from './post-article';
import CommentSection from './comment-section';
import PostContext from './post-context';
import CommunityDialog, {type DialogSpec} from './community-dialog';
import SiteFooter from '../footer/site-footer';
import styles from './community.module.css';
import detailStyles from './post-detail.module.css';

// Posts already counted in this page load (assignment-frontend/js/app.js's
// `viewed` Set). Module scope so React's dev double-effect doesn't count twice.
const viewedPosts = new Set<number>();

// Server messages are already user-facing Korean (board-service fail()).
function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return '로그인이 만료되었어요. 다시 로그인해주세요.';
  return error instanceof Error ? error.message : '요청을 처리하지 못했어요.';
}

export type AuthorState =
  | {status: 'loading'}
  | {status: 'withdrawn'}
  | {status: 'error'}
  | {status: 'ready'; member: CommunityMember};

type DetailState =
  | {status: 'loading'}
  | {status: 'not-found'}
  | {status: 'error'}
  | {status: 'ready'; post: CommunityPost; comments: CommunityComment[]};

// Post detail page. Ports showPostDetailPage()/renderPostDetail() from
// assignment-frontend/js/app.js and renderPostContext() from post-context.js.
// Client component: liked/bookmarked and the author-only actions depend on the
// viewer's session cookie.
export default function PostDetail({postId}: {postId: number}) {
  const auth = useCommunitySession();
  const {session, sessionError} = auth;
  const [search, setSearch] = useState('');

  const [detail, setDetail] = useState<DetailState>({status: 'loading'});
  const [author, setAuthor] = useState<AuthorState>({status: 'loading'});
  const [reloadKey, setReloadKey] = useState(0);

  // Post + comments in parallel, then the view counter, like the legacy page.
  // `session` is a dependency because liked/bookmarked are per-viewer: once the
  // session check settles (or the viewer logs out) the post is re-read.
  const sessionKey = session === undefined ? 'pending' : session?.id ?? 'anon';
  useEffect(() => {
    if (sessionKey === 'pending') return;
    let cancelled = false;
    (async () => {
      let post: CommunityPost;
      let comments: CommunityComment[];
      try {
        [post, comments] = await Promise.all([fetchPost(postId), fetchComments(postId)]);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          forgetRecentPost(postId);
          setDetail({status: 'not-found'});
        } else {
          setDetail({status: 'error'});
        }
        return;
      }
      if (cancelled) return;
      // Old link or changed category: quietly correct the URL instead of erroring.
      const canonical = postUrl(post);
      if (canonical !== window.location.pathname) {
        window.history.replaceState(null, '', canonical + window.location.search);
      }
      if (!viewedPosts.has(postId)) {
        viewedPosts.add(postId);
        try {
          post = {...post, views: (await recordPostView(postId)).views};
        } catch {
          viewedPosts.delete(postId);
        }
      }
      if (cancelled) return;
      setDetail({status: 'ready', post, comments});
      rememberRecentPost(post);
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, sessionKey, reloadKey]);

  // Author profile is independent of the viewer; failures never hide the post.
  const authorId = detail.status === 'ready' ? detail.post.authorId : undefined;
  useEffect(() => {
    if (authorId === undefined) return;
    if (authorId === null) {
      setAuthor({status: 'withdrawn'});
      return;
    }
    let cancelled = false;
    setAuthor({status: 'loading'});
    fetchMember(authorId)
      .then((member) => !cancelled && setAuthor({status: 'ready', member}))
      .catch(() => !cancelled && setAuthor({status: 'error'}));
    return () => {
      cancelled = true;
    };
  }, [authorId]);

  // Transient status line (app.js's notify()).
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

  // --- Mutations. Each one goes to the existing board-service endpoint and
  // then re-reads what it changed from the server, like the legacy page's
  // `await showPostDetailPage(id)` after every action. ---
  const patchDetail = useCallback(
    (update: (d: Extract<DetailState, {status: 'ready'}>) => Partial<Extract<DetailState, {status: 'ready'}>>) =>
      setDetail((d) => (d.status === 'ready' ? {...d, ...update(d)} : d)),
    [],
  );

  // Only the newest re-read may land (two toggles in a row can finish out of order).
  const postTicket = useRef(0);
  const refreshPost = useCallback(async () => {
    const ticket = ++postTicket.current;
    try {
      const post = await fetchPost(postId);
      if (ticket === postTicket.current) patchDetail(() => ({post}));
    } catch {
      // Keep the server-confirmed local state; a reload will reconcile counts.
    }
  }, [postId, patchDetail]);

  const commentTicket = useRef(0);
  const refreshComments = useCallback(async () => {
    const ticket = ++commentTicket.current;
    try {
      const comments = await fetchComments(postId);
      if (ticket === commentTicket.current) patchDetail(() => ({comments}));
    } catch {
      notify('댓글 목록을 새로 불러오지 못했어요. 새로고침해주세요.');
    }
  }, [postId, patchDetail, notify]);

  // 추천/북마크: PUT {active} is idempotent on the server, so the request
  // carries the target state, not "flip". One request per kind at a time;
  // the UI changes only after the server answers.
  const [pendingToggles, setPendingToggles] = useState<{like: boolean; bookmark: boolean}>({
    like: false,
    bookmark: false,
  });
  const togglesInFlight = useRef(new Set<'like' | 'bookmark'>());
  async function toggle(kind: 'like' | 'bookmark') {
    if (!requireLogin() || detail.status !== 'ready' || togglesInFlight.current.has(kind)) return;
    const current = kind === 'like' ? detail.post.liked : detail.post.bookmarked;
    togglesInFlight.current.add(kind);
    setPendingToggles((p) => ({...p, [kind]: true}));
    try {
      const {active} = await (kind === 'like' ? setPostLike : setPostBookmark)(postId, !current);
      patchDetail(({post}) => ({
        post:
          kind === 'like'
            ? {...post, liked: active, likeCount: post.likeCount + (active === post.liked ? 0 : active ? 1 : -1)}
            : {...post, bookmarked: active},
      }));
      void refreshPost();
    } catch (error) {
      notify(errorText(error));
    } finally {
      togglesInFlight.current.delete(kind);
      setPendingToggles((p) => ({...p, [kind]: false}));
    }
  }

  // Returns whether the comment was saved, so the form knows to clear itself.
  async function submitComment(content: string, parentId: number | null): Promise<boolean> {
    if (!requireLogin()) return false;
    try {
      await createComment(postId, content, parentId);
    } catch (error) {
      notify(errorText(error));
      return false;
    }
    await refreshComments();
    void refreshPost();
    return true;
  }

  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  // app.js's requestContentDeletion(): your own content → plain confirm, no
  // reason; anyone else's (only offered to admins) → required reason that
  // board-service writes to moderation_logs.
  function deletionDialog(
    isOwn: boolean,
    confirmMessage: string,
    remove: (reason?: string) => Promise<unknown>,
    after: () => Promise<void> | void,
  ): DialogSpec {
    if (isOwn)
      return {
        kind: 'confirm',
        title: '삭제할까요?',
        message: confirmMessage,
        confirmLabel: '삭제',
        onConfirm: async () => {
          await remove();
          await after();
        },
      };
    return {
      kind: 'reason',
      title: '관리자 콘텐츠 삭제',
      description: '삭제 사유와 삭제 당시 원문이 운영 로그에 기록됩니다.',
      label: '삭제 사유 (필수)',
      emptyError: '삭제 사유를 입력해주세요.',
      submitLabel: '삭제',
      danger: true,
      onSubmit: async (reason) => {
        await remove(reason);
        await after();
      },
    };
  }

  function requestPostDelete() {
    if (!requireLogin() || detail.status !== 'ready') return;
    const {post} = detail;
    setDialog(
      deletionDialog(
        session?.id === post.authorId,
        '게시글과 댓글을 함께 삭제합니다.',
        (reason) => deletePost(postId, reason),
        () => {
          // The post page has nothing left to show: back to its category list.
          window.location.href = `/community?category=${encodeURIComponent(post.category)}`;
        },
      ),
    );
  }

  function requestCommentDelete(comment: CommunityComment) {
    if (!requireLogin()) return;
    setDialog(
      deletionDialog(
        session?.id === comment.authorId,
        '이 댓글을 삭제할까요?',
        (reason) => deleteComment(comment.id, reason),
        async () => {
          await refreshComments();
          void refreshPost();
        },
      ),
    );
  }

  // app.js's openReport(). Resubmitting while the report is still pending
  // updates its reason on the server; an already-handled one answers 409.
  function requestReport() {
    if (!requireLogin()) return;
    setDialog({
      kind: 'reason',
      title: '게시글 신고',
      description: '신고 내역은 내 활동에서 확인할 수 있습니다.',
      label: '신고 사유',
      placeholder: '스팸, 욕설, 허위 정보 등 신고 이유를 적어주세요.',
      emptyError: '신고 사유를 입력해주세요.',
      submitLabel: '신고 접수',
      onSubmit: async (reason) => {
        await reportPost(postId, reason);
        notify('신고를 접수했어요.');
      },
    });
  }

  // The button is only shown to the author; the editor re-checks ownership.
  function requestEdit() {
    if (!requireLogin() || detail.status !== 'ready') return;
    window.location.assign(`${postUrl(detail.post)}/edit`);
  }

  // Legacy edit links were /community/{category}/{id}#write-post.
  useEffect(() => {
    if (window.location.hash === '#write-post') {
      window.location.replace(`${window.location.pathname}/edit`);
    }
  }, []);

  const pathname = usePathname();
  const loginNext = encodeURIComponent(detail.status === 'ready' ? postUrl(detail.post) : pathname);

  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={(value) => {
          window.location.href = value ? `/community?q=${encodeURIComponent(value)}` : '/community';
        }}
        loginNext={loginNext}
      />

      {sessionError && (
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

        {detail.status === 'ready' ? (
          <div className={detailStyles.layout}>
            <aside className={detailStyles.sidebar} aria-label="게시글 작성자">
              <AuthorCard post={detail.post} author={author} />
            </aside>
            <article className={detailStyles.article}>
              <PostArticle
                post={detail.post}
                author={author}
                viewer={session ?? null}
                notify={notify}
                pending={pendingToggles}
                onToggle={toggle}
                onEdit={requestEdit}
                onDelete={requestPostDelete}
                onReport={requestReport}
              />
              <CommentSection
                comments={detail.comments}
                viewer={session ?? null}
                requireLogin={requireLogin}
                onSubmit={submitComment}
                onDelete={requestCommentDelete}
              />
            </article>
            <aside className={detailStyles.sidebar} aria-label="관련 콘텐츠">
              <PostContext post={detail.post} author={author} />
            </aside>
          </div>
        ) : (
          <div className={detailStyles.statusBox} aria-busy={detail.status === 'loading'}>
            {detail.status === 'loading' && <p className={styles.empty}>이야기를 불러오고 있어요.</p>}
            {detail.status === 'not-found' && (
              <p className={styles.empty}>
                삭제되었거나 없는 이야기예요. <a href="/community">목록으로 돌아가기</a>
              </p>
            )}
            {detail.status === 'error' && (
              <p className={styles.empty}>
                이야기를 불러오지 못했어요.{' '}
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
