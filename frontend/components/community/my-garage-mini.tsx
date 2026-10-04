'use client';

import {useEffect, useRef, useState} from 'react';
import type {SessionUser} from '../../lib/home-types';
import {fetchMember} from '../../lib/community-api';
import type {MemberVehicle} from '../../lib/community-types';
import {imageUrl} from '../../lib/format';
import styles from './community.module.css';

// Mirrors assignment-frontend/js/my-garage-card.js: same representative-
// vehicle lookup and the same three states (not logged in / empty garage /
// has a vehicle), shown as a small sidebar card instead of a shared widget.
export default function MyGarageMini({user}: {user: SessionUser | null | undefined}) {
  const [vehicle, setVehicle] = useState<MemberVehicle | null>(null);
  const [state, setState] = useState<'loading' | 'empty' | 'has-vehicle' | 'error'>('loading');
  const ticket = useRef(0);

  useEffect(() => {
    if (!user) {
      setState('empty');
      return;
    }
    const current = ++ticket.current;
    setState('loading');
    fetchMember(user.id)
      .then((member) => {
        if (current !== ticket.current) return;
        const representative = member.representativeVehicle || member.vehicles[0] || null;
        setVehicle(representative);
        setState(representative ? 'has-vehicle' : 'empty');
      })
      .catch(() => {
        if (current === ticket.current) setState('error');
      });
  }, [user]);

  if (!user) {
    return (
      <div className={styles.garageMini} data-state="not-authenticated">
        <p className={styles.muted}>로그인하고 나의 차량을 만나보세요.</p>
        <a className={styles.textLink} href="/login">
          로그인하기
        </a>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className={styles.garageMini} data-state="loading">
        <p className={styles.muted}>내 차량을 확인하고 있어요.</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={styles.garageMini} data-state="error">
        <p className={styles.muted}>차량 정보를 불러오지 못했어요.</p>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className={styles.garageMini} data-state="empty-garage">
        <p className={styles.muted}>아직 등록된 차량이 없습니다.</p>
        <a className={styles.textLink} href="/home">
          내 차 등록하기 →
        </a>
      </div>
    );
  }

  return (
    <div className={styles.garageMini} data-state="has-vehicle">
      {vehicle.imageId ? (
        <img
          className={styles.garageMiniPhoto}
          src={imageUrl(vehicle.imageId)}
          alt={vehicle.model}
          loading="lazy"
        />
      ) : null}
      <strong>{[vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ')}</strong>
      <p className={styles.muted}>{[vehicle.year, vehicle.trim].filter(Boolean).join(' · ')}</p>
      {vehicle.verified && <span className={styles.verifiedBadge}>인증 오너</span>}
      <a className={styles.textLink} href="/home">
        내 차고 보기 →
      </a>
    </div>
  );
}
