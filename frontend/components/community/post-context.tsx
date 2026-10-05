'use client';

import {useEffect, useState} from 'react';
import {fetchPosts} from '../../lib/community-api';
import type {CommunityPost} from '../../lib/community-types';
import {imageUrl, postUrl} from '../../lib/format';
import type {AuthorState} from './post-detail';
import styles from './post-detail.module.css';

type Related = CommunityPost[] | 'loading' | 'error';

// Right sidebar: post-context.js's renderPostContext(). Model priority is the
// post's linked garage vehicle, then its free-text vehicle, then the author's
// representative vehicle. Only a photo of that exact vehicle/model is shown.
export default function PostContext({post, author}: {post: CommunityPost; author: AuthorState}) {
  const member = author.status === 'ready' ? author.member : null;
  const authorSettled = author.status !== 'loading';
  const model = post.linkedVehicle?.model || post.vehicle || member?.representativeVehicle?.model || '';

  // Latest posts in the same category don't depend on the author lookup.
  const [latest, setLatest] = useState<Related>('loading');
  useEffect(() => {
    let cancelled = false;
    fetchPosts({category: post.category, sort: 'latest', limit: 6})
      .then((posts) => !cancelled && setLatest(posts))
      .catch(() => !cancelled && setLatest('error'));
    return () => {
      cancelled = true;
    };
  }, [post.category]);

  const [popular, setPopular] = useState<Related>('loading');
  useEffect(() => {
    if (!authorSettled || !model) return;
    let cancelled = false;
    setPopular('loading');
    fetchPosts({vehicle: model, sort: 'popular', limit: 6})
      .then((posts) => !cancelled && setPopular(posts))
      .catch(() => !cancelled && setPopular('error'));
    return () => {
      cancelled = true;
    };
  }, [authorSettled, model]);

  const matching = post.linkedVehicle || member?.vehicles.find((v) => v.model === model) || null;

  return (
    <>
      <section className={styles.card}>
        <h3>{post.linkedVehicle ? '이 글에 연결된 차량' : '관련 차종'}</h3>
        {!authorSettled && !post.linkedVehicle && !post.vehicle ? (
          <p className={styles.muted}>정보를 불러오고 있어요.</p>
        ) : !model ? (
          <p className={styles.muted}>연결된 차종이 없어요.</p>
        ) : (
          <>
            {post.linkedVehicle && (
              <p className={styles.muted}>
                {post.linkedVehicle.year} · {post.linkedVehicle.verified ? '인증 오너' : '등록 차량'}
              </p>
            )}
            <strong>{model}</strong>
            {matching?.imageId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.carPhoto} src={imageUrl(matching.imageId)} alt={model} />
            )}
            <a className={styles.boardLink} href={`/community?vehicle=${encodeURIComponent(model)}`}>
              차종 게시판 바로가기 →
            </a>
          </>
        )}
      </section>

      <section className={styles.card}>
        <h3>이 차종의 인기글</h3>
        {authorSettled && !model ? (
          <p className={styles.muted}>차종이 연결되면 관련 글을 볼 수 있어요.</p>
        ) : (
          <RelatedList posts={authorSettled ? popular : 'loading'} currentId={post.id} errorText="인기글을 불러오지 못했어요." />
        )}
      </section>

      <section className={styles.card}>
        <h3>같은 카테고리의 최신글</h3>
        <RelatedList posts={latest} currentId={post.id} errorText="최신글을 불러오지 못했어요." />
      </section>
    </>
  );
}

// renderRelatedPosts(): drop the current post, show up to 5.
function RelatedList({posts, currentId, errorText}: {posts: Related; currentId: number; errorText: string}) {
  if (posts === 'loading') return <p className={styles.muted}>정보를 불러오고 있어요.</p>;
  if (posts === 'error') return <p className={styles.muted}>{errorText}</p>;
  const rows = posts.filter((p) => p.id !== currentId).slice(0, 5);
  if (!rows.length) return <p className={styles.muted}>아직 다른 글이 없어요.</p>;
  return (
    <div>
      {rows.map((p) => (
        <a key={p.id} className={styles.contextRow} href={postUrl(p)}>
          {p.imageIds.length ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl(p.imageIds[0])} alt="" loading="lazy" />
          ) : (
            <span className={styles.relatedAvatar} aria-hidden="true">
              {[...p.username][0] || ''}
            </span>
          )}
          <div>
            <strong>{p.title}</strong>
            <p className={styles.muted}>
              {p.username} · 조회 {p.views} · 추천 {p.likeCount}
            </p>
          </div>
        </a>
      ))}
    </div>
  );
}
