'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {usePathname} from 'next/navigation';
import {ApiError, fetchComments, fetchMember, fetchPost, recordPostView} from '../../lib/community-api';
import type {CommunityComment, CommunityMember, CommunityPost} from '../../lib/community-types';
import {postUrl} from '../../lib/format';
import {forgetRecentPost, rememberRecentPost} from '../../lib/recent-posts';
import CommunityHeader from './community-header';
import {useCommunitySession} from './use-community-session';
import AuthorCard from './author-card';
import PostArticle from './post-article';
import CommentSection from './comment-section';
import PostContext from './post-context';
import SiteFooter from '../footer/site-footer';
import styles from './community.module.css';
import detailStyles from './post-detail.module.css';

// Posts already counted in this page load (assignment-frontend/js/app.js's
// `viewed` Set). Module scope so React's dev double-effect doesn't count twice.
const viewedPosts = new Set<number>();

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

  // Mutations (like/bookmark/comment/report/delete: STEP 2-3, edit: STEP 2-4)
  // are wired in later steps. The buttons and their visibility rules are final.
  const notReady = useCallback(
    (label: string) => {
      if (!requireLogin()) return;
      notify(`${label} 기능은 준비 중이에요.`);
    },
    [requireLogin, notify],
  );

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
                onAction={notReady}
              />
              <CommentSection
                comments={detail.comments}
                viewer={session ?? null}
                requireLogin={requireLogin}
                onAction={notReady}
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
    </div>
  );
}
