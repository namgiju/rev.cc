'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {ApiError, errorMessage, garageApi, vehicleName, type GarageVehicle} from '../../lib/garage-api';
import {RequireGarageSession, useGarageSession} from './garage-session';
import styles from './garage.module.css';

export default function GarageList() {return <RequireGarageSession><VehicleList /></RequireGarageSession>;}
function VehicleList() {
  const {user, refresh} = useGarageSession();
  const [vehicles, setVehicles] = useState<GarageVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;setLoading(true);setError('');
    garageApi<GarageVehicle[]>('/api/garage/vehicles').then(data => {if (active) setVehicles(data);})
      .catch(err => {if (active) {setError(errorMessage(err));if (err instanceof ApiError && err.status === 401) void refresh();}})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [user?.id, attempt]);
  return <section><div className={styles.heading}><div><p className={styles.eyebrow}>MY GARAGE</p><h1 className={styles.title}>나의 차고</h1><p className={styles.subtitle}>{user?.username} 님의 차량을 한곳에서 관리하세요.</p></div><Link href="/garage/new" className={styles.primary}>차량 등록</Link></div>
    {loading ? <p role="status" className={styles.loading}>차량을 불러오고 있습니다.</p> : error ? <div className={styles.error} role="alert">{error} <button className={styles.secondary} onClick={() => setAttempt(value => value + 1)}>다시 시도</button></div> : vehicles.length ? <div className={styles.grid}>{vehicles.map(vehicle => <Link key={vehicle.id} href={`/vehicles/${vehicle.id}`} className={styles.card}>
      <span className={styles.tag}>{vehicle.modelYear}</span><h2>{vehicleName(vehicle)}</h2><p>{[vehicle.manufacturer, vehicle.model, vehicle.trim].filter(Boolean).join(' · ')}</p><p>{[vehicle.transmission, vehicle.color].filter(Boolean).join(' · ') || '추가 정보를 등록해보세요.'}</p><small>차량 프로필 보기 →</small>
    </Link>)}</div> : <div className={styles.empty}><h2>첫 차량을 등록해보세요.</h2><p>차량의 기본 정보를 입력하면 공개 차량 프로필이 만들어집니다.<br/>한 계정에 여러 차량을 등록할 수 있습니다.</p><Link href="/garage/new" className={styles.primary}>첫 차량 등록</Link></div>}
  </section>;
}
