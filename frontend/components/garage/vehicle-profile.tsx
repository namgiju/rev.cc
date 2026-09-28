'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {errorMessage, garageApi, vehicleName, type GarageVehicle} from '../../lib/garage-api';
import {useGarageSession} from './garage-session';
import styles from './garage.module.css';

export default function VehicleProfile({vehicleId}: {vehicleId:number}) {
  const {user} = useGarageSession();
  const router = useRouter();
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;setVehicle(null);setError('');setConfirm(false);
    garageApi<GarageVehicle>(`/api/vehicles/${vehicleId}`).then(data => {if (active) setVehicle(data);})
      .catch(err => {if (active) setError(errorMessage(err));});
    return () => {active = false;};
  }, [vehicleId, attempt]);
  async function remove() {
    setBusy(true);setActionError('');
    try {await garageApi(`/api/garage/vehicles/${vehicleId}`, {method:'DELETE'});router.push('/garage');}
    catch (err) {setActionError(errorMessage(err));setBusy(false);}
  }
  if (error) return <div className={styles.empty}><h1 className={styles.title}>차량 프로필</h1><p role="alert">{error}</p><button className={styles.secondary} onClick={() => setAttempt(x => x + 1)}>다시 시도</button> <Link href="/garage" className={styles.back}>내 차고로</Link></div>;
  if (!vehicle) return <p role="status" className={styles.loading}>차량 프로필을 불러오고 있습니다.</p>;
  const facts = [['제조사',vehicle.manufacturer],['모델',vehicle.model],['연식',`${vehicle.modelYear}년`],['트림',vehicle.trim],['변속기',vehicle.transmission],['색상',vehicle.color]];
  const owner = user?.id === vehicle.userId;
  return <section><div className={styles.heading}><div><p className={styles.eyebrow}>VEHICLE PROFILE</p><h1 className={styles.title}>{vehicleName(vehicle)}</h1><p className={styles.subtitle}>{[vehicle.manufacturer,vehicle.model].filter(Boolean).join(' ')}</p></div><Link href="/garage" className={styles.back}>← 내 차고</Link></div>
    <article className={styles.profile}><div className={styles.profileTop}><span className={styles.tag}>{vehicle.modelYear} · {vehicle.transmission || 'MY VEHICLE'}</span><p>소유자 <strong>{vehicle.username}</strong></p></div><dl className={styles.facts}>{facts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || '미등록'}</dd></div>)}</dl><div className={styles.description}><h2>차량 설명</h2><p>{vehicle.description || '아직 차량 설명이 없습니다.'}</p></div></article>
    <p className={styles.meta}>등록 {new Date(vehicle.createdAt).toLocaleDateString('ko-KR')} · 수정 {new Date(vehicle.updatedAt).toLocaleDateString('ko-KR')}</p>
    {owner && <><div className={styles.actions}><Link href={`/garage/${vehicle.id}/edit`} className={styles.secondary}>차량 수정</Link><button className={styles.danger} disabled={busy} onClick={() => setConfirm(true)}>차량 삭제</button></div>{confirm && <div className={styles.confirm} role="group" aria-label="차량 삭제 확인"><p>이 차량을 삭제할까요? 기존 차고에 저장한 차량 기록도 함께 삭제되며 복구할 수 없습니다.</p><div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => setConfirm(false)}>취소</button><button className={styles.danger} disabled={busy} onClick={remove}>{busy ? '삭제 중…' : '삭제 확인'}</button></div></div>}</>}
    {actionError && <p className={styles.error} role="alert">{actionError}</p>}
  </section>;
}
