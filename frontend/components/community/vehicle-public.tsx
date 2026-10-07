'use client';

import {useEffect, useState} from 'react';
import {ApiError, fetchPublicVehicle} from '../../lib/community-api';
import type {PublicVehicle} from '../../lib/community-types';
import {imageUrl} from '../../lib/format';
import CommunityPage, {useNotice} from './community-page';
import MemberLink from './member-link';
import {useCommunitySession} from './use-community-session';
import styles from './post-detail.module.css';

const RECORD_LABELS: Record<string, string> = {maintenance: '정비', tuning: '튜닝', parts: '부품'};

type State =
  | {status: 'loading'}
  | {status: 'not-found'; message: string}
  | {status: 'error'}
  | {status: 'ready'; vehicle: PublicVehicle};

// Public vehicle page, formerly the #car-{id} dialog (vehicle-ui.js openCar):
// owner, year/trim, photo, intro and the maintenance/tuning/parts records.
// Editing the vehicle and adding/removing records belong to the personal
// garage (/home), which this STEP does not port — the owner gets a link there.
export default function VehiclePublic({vehicleId}: {vehicleId: number}) {
  const auth = useCommunitySession();
  const {session} = auth;
  const {notice} = useNotice();
  const [state, setState] = useState<State>({status: 'loading'});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({status: 'loading'});
    fetchPublicVehicle(vehicleId)
      .then((vehicle) => !cancelled && setState({status: 'ready', vehicle}))
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) setState({status: 'not-found', message: error.message});
        else setState({status: 'error'});
      });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, reloadKey]);

  return (
    <CommunityPage auth={auth} notice={notice}>
      {state.status === 'loading' && <p className={styles.emptyComments}>차고를 불러오고 있어요.</p>}
      {state.status === 'not-found' && (
        <p className={styles.emptyComments}>
          {state.message} <a href="/community">목록으로 돌아가기</a>
        </p>
      )}
      {state.status === 'error' && (
        <p className={styles.emptyComments}>
          차고를 불러오지 못했어요.{' '}
          <button type="button" className={styles.textButton} onClick={() => setReloadKey((k) => k + 1)}>
            다시 시도
          </button>
        </p>
      )}
      {state.status === 'ready' && <VehicleBody vehicle={state.vehicle} own={session?.id === state.vehicle.ownerId} />}
    </CommunityPage>
  );
}

function VehicleBody({vehicle: v, own}: {vehicle: PublicVehicle; own: boolean}) {
  return (
    <>
      <span className={styles.category}>OWNER’S GARAGE</span>
      <h1 className={styles.title}>{v.model}</h1>
      <div className={styles.meta}>
        <MemberLink id={v.ownerId} name={v.username} />
        <span>
          {v.year}년 · {v.trim || '오너 차량'}
        </span>
      </div>
      {v.imageId && (
        <div className={styles.gallery}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(v.imageId)} alt={v.model} />
        </div>
      )}
      <p className={styles.text}>{v.bio || '차량 소개를 기다리고 있어요.'}</p>
      {own && (
        <a className={styles.boardLink} href="/home">
          내 차고에서 차량·기록 관리 →
        </a>
      )}
      <section className={styles.comments} aria-labelledby="records-title">
        <h3 id="records-title">정비 · 튜닝 · 부품 기록 {v.records.length}</h3>
        {!v.records.length && <p className={styles.emptyComments}>아직 기록이 없어요. 첫 정비나 장착 경험을 남겨보세요.</p>}
        {v.records.map((r) => {
          const facts = [r.mileage !== null ? `${r.mileage.toLocaleString()} km` : '', r.cost !== null ? `${r.cost.toLocaleString()}원` : '']
            .filter(Boolean)
            .join(' · ');
          return (
            <div key={r.id} className={styles.comment}>
              <small className={styles.muted}>
                {r.date} · {RECORD_LABELS[r.kind] || r.kind}
              </small>
              <h4 className={styles.recordTitle}>{r.title}</h4>
              {r.content && <p>{r.content}</p>}
              {facts && <small className={styles.muted}>{facts}</small>}
            </div>
          );
        })}
      </section>
    </>
  );
}
