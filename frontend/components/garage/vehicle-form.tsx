'use client';

import {useEffect, useState, type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ApiError, errorMessage, garageApi, type GarageVehicle, type VehicleInput} from '../../lib/garage-api';
import {RequireGarageSession, useGarageSession} from './garage-session';
import styles from './garage.module.css';

export default function VehicleEditor({vehicleId}: {vehicleId?: number}) {
  return <RequireGarageSession><Editor vehicleId={vehicleId} /></RequireGarageSession>;
}
function Editor({vehicleId}: {vehicleId?: number}) {
  const {user, refresh} = useGarageSession();
  const router = useRouter();
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [loading, setLoading] = useState(!!vehicleId);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!vehicleId) return;
    let active = true;setLoading(true);setLoadError('');
    garageApi<GarageVehicle>(`/api/vehicles/${vehicleId}`).then(data => {
      if (!active) return;
      if (data.userId !== user?.id) {setLoadError('본인 차량만 수정할 수 있습니다.');return;}
      setVehicle(data);
    }).catch(err => {if (active) setLoadError(errorMessage(err));}).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [vehicleId, user?.id, attempt]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    const data = new FormData(event.currentTarget);
    const body: VehicleInput = {
      manufacturer:String(data.get('manufacturer') || '').trim(), model:String(data.get('model') || '').trim(),
      modelYear:Number(data.get('modelYear')), trim:String(data.get('trim') || '').trim(),
      transmission:String(data.get('transmission') || '').trim(), color:String(data.get('color') || '').trim(),
      nickname:String(data.get('nickname') || '').trim(), description:String(data.get('description') || '').trim(),
    };
    if (!body.manufacturer || !body.model) {setError('제조사와 모델을 입력해주세요.');setBusy(false);return;}
    try {
      const saved = await garageApi<GarageVehicle>(vehicleId ? `/api/garage/vehicles/${vehicleId}` : '/api/garage/vehicles', {method:vehicleId ? 'PUT' : 'POST', body});
      router.push(`/vehicles/${saved.id}`);
    } catch (err) {setError(errorMessage(err));if (err instanceof ApiError && err.status === 401) await refresh();setBusy(false);}
  }
  if (loading) return <p className={styles.loading} role="status">차량 정보를 확인하고 있습니다.</p>;
  if (loadError) return <div className={styles.empty}><p role="alert">{loadError}</p><button className={styles.secondary} onClick={() => setAttempt(x => x + 1)}>다시 시도</button> <Link href="/garage" className={styles.back}>내 차고로</Link></div>;
  const fields = [
    {name:'manufacturer', label:'제조사', placeholder:'Hyundai', max:100, required:true},
    {name:'model', label:'모델', placeholder:'Avante N', max:100, required:true},
    {name:'trim', label:'트림', placeholder:'N', max:100},
    {name:'transmission', label:'변속기', placeholder:'DCT', max:50},
    {name:'color', label:'색상', placeholder:'Performance Blue', max:100},
    {name:'nickname', label:'차량 닉네임', placeholder:'기주의 아반떼 N', max:100},
  ] as const;
  return <section><div className={styles.heading}><div><p className={styles.eyebrow}>MY GARAGE</p><h1 className={styles.title}>{vehicleId ? '차량 정보 수정' : '차량 등록'}</h1><p className={styles.subtitle}>차량의 기본 정보부터 차근차근 채워보세요.</p></div><Link href="/garage" className={styles.back}>← 내 차고</Link></div>
    <form className={styles.form} onSubmit={submit}><p className={styles.hint}>제조사·모델·연식은 필수입니다. 등록한 정보와 소유자 이름은 차량 프로필에 공개됩니다.</p><div className={styles.fields}>
      {fields.map(field => <label key={field.name} className={styles.field}>{field.label}{'required' in field ? ' *' : ''}<input name={field.name} defaultValue={vehicle?.[field.name] || ''} placeholder={field.placeholder} maxLength={field.max} required={'required' in field} disabled={busy}/></label>)}
      <label className={styles.field}>연식 *<input name="modelYear" type="number" min={1900} max={2100} step={1} defaultValue={vehicle?.modelYear || new Date().getFullYear()} required disabled={busy}/></label>
      <label className={`${styles.field} ${styles.full}`}>차량 설명<textarea name="description" maxLength={1000} defaultValue={vehicle?.description || ''} placeholder="내 차량을 소개해주세요." rows={5} disabled={busy}/></label>
    </div>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><Link href={vehicleId ? `/vehicles/${vehicleId}` : '/garage'} className={styles.back}>취소</Link><button className={styles.primary} disabled={busy}>{busy ? '저장 중…' : vehicleId ? '변경사항 저장' : '차량 등록'}</button></div></form>
  </section>;
}
