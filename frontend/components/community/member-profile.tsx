'use client';

import {useCallback, useEffect, useState} from 'react';
import {ApiError, fetchMember, fetchMemberGarage} from '../../lib/community-api';
import type {CommunityMember, GarageCard} from '../../lib/community-types';
import {imageUrl} from '../../lib/format';
import CommunityPage, {useNotice} from './community-page';
import Guestbook from './guestbook';
import PostRow from './post-row';
import {useCommunitySession} from './use-community-session';
import styles from './post-detail.module.css';

type State =
  | {status: 'loading'}
  | {status: 'not-found'; message: string}
  | {status: 'error'}
  | {status: 'ready'; member: CommunityMember; vehicles: GarageCard[]};

// Public member garage, formerly the #member-{id} dialog (app.js openMember):
// "{name} 님의 차고" vehicle cards, the garage guestbook, then their recent
// posts. Registering/managing vehicles is the personal garage (/home), which
// is not part of the community port — the owner gets a link there instead of
// the old inline vehicle form.
export default function MemberProfile({memberId}: {memberId: number}) {
  const auth = useCommunitySession();
  const {session} = auth;
  const {notice, notify} = useNotice();
  const [state, setState] = useState<State>({status: 'loading'});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({status: 'loading'});
    Promise.all([fetchMember(memberId), fetchMemberGarage(memberId)])
      .then(([member, vehicles]) => !cancelled && setState({status: 'ready', member, vehicles}))
      .catch((error) => {
        if (cancelled) return;
        // Withdrawn members have no public profile: the API answers 404.
        if (error instanceof ApiError && error.status === 404) setState({status: 'not-found', message: error.message});
        else setState({status: 'error'});
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, reloadKey]);

  const requireLogin = useCallback(() => {
    if (session) return true;
    notify('로그인 후 이용할 수 있어요. 상단의 로그인 / 가입을 눌러주세요.');
    return false;
  }, [session, notify]);

  return (
    <CommunityPage auth={auth} notice={notice}>
      {state.status === 'loading' && <p className={styles.emptyComments}>오너 정보를 불러오고 있어요.</p>}
      {state.status === 'not-found' && (
        <p className={styles.emptyComments}>
          {state.message} <a href="/community">목록으로 돌아가기</a>
        </p>
      )}
      {state.status === 'error' && (
        <p className={styles.emptyComments}>
          오너 정보를 불러오지 못했어요.{' '}
          <button type="button" className={styles.textButton} onClick={() => setReloadKey((k) => k + 1)}>
            다시 시도
          </button>
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <h1 className={styles.title}>{state.member.username} 님의 차고</h1>
          <div className={styles.garageCards}>
            {state.vehicles.length ? (
              state.vehicles.map((v) => <VehicleCard key={v.id} vehicle={v} />)
            ) : (
              <p className={styles.emptyComments}>아직 등록한 차량이 없어요.</p>
            )}
          </div>
          {session?.id === state.member.id && (
            <a className={styles.boardLink} href="/home">
              내 차고에서 차량 등록·관리 →
            </a>
          )}
          <Guestbook ownerId={state.member.id} viewer={session ?? null} requireLogin={requireLogin} notify={notify} />
          <section className={styles.comments} aria-labelledby="member-posts-title">
            <h3 id="member-posts-title">최근 작성한 이야기</h3>
            {state.member.posts.length ? (
              state.member.posts.map((post) => <PostRow key={post.id} post={post} />)
            ) : (
              <p className={styles.emptyComments}>아직 작성한 이야기가 없어요.</p>
            )}
          </section>
        </>
      )}
    </CommunityPage>
  );
}

// app.js's vehicleCard(): photo (or placeholder), model, year/trim, owner and
// record count, linking to the public vehicle page.
function VehicleCard({vehicle: v}: {vehicle: GarageCard}) {
  return (
    <a className={styles.garageCard} href={`/community/cars/${v.id}`}>
      {v.imageId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl(v.imageId)} alt={v.model} loading="lazy" />
      ) : (
        <span className={styles.garageCardIcon} aria-hidden="true">
          🚗
        </span>
      )}
      <strong>{v.model}</strong>
      <small>
        {v.year}년 · {v.trim || '오너 차량'}
      </small>
      <span className={styles.muted}>
        {v.username} · 기록 {v.recordCount ?? 0}개
      </span>
    </a>
  );
}
