'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {
  createVehicleRecord,
  deleteVehicleProfile,
  deleteVehicleRecord,
  fetchPublicVehicle,
  updateVehicleProfile,
  uploadImage,
} from '../../lib/community-api';
import type {PublicVehicle, VehicleRecordKind} from '../../lib/community-types';
import {imageUrl} from '../../lib/format';
import CommunityDialog, {type DialogSpec} from '../community/community-dialog';
import styles from './my-garage.module.css';

const RECORD_LABELS: Record<VehicleRecordKind, string> = {maintenance: '정비', tuning: '튜닝', parts: '부품'};

type State = {status: 'loading'} | {status: 'error'} | {status: 'ready'; vehicle: PublicVehicle};

// Vehicle editing/deletion + record management (formerly vehicle-ui.js's
// vehicleForm()/openCar()'s owner actions, reused by both community and
// /home there). Edits only the board-owned columns (model/year/trim/bio/
// photo), same as the legacy form — manufacturer/license plate/verification
// are core-owned and not editable here. No new API, no new public page:
// this lives entirely inside /home.
export default function VehicleManageDialog({
  vehicleId,
  onClose,
  onChanged,
}: {
  vehicleId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({status: 'loading'});
  const [imageId, setImageId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmSpec, setConfirmSpec] = useState<DialogSpec | null>(null);

  function load() {
    setState({status: 'loading'});
    fetchPublicVehicle(vehicleId)
      .then((vehicle) => {
        setState({status: 'ready', vehicle});
        setImageId(vehicle.imageId);
      })
      .catch(() => setState({status: 'error'}));
  }

  useEffect(() => {
    load();
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  async function handleImageChange(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      setImageId(await uploadImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진을 올리지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || state.status !== 'ready') return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await updateVehicleProfile(vehicleId, {
        model: String(form.get('model') || '').trim(),
        year: Number(form.get('year')),
        trim: String(form.get('trim') || '').trim(),
        bio: String(form.get('bio') || '').trim(),
        imageId,
      });
      onChanged();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '차량 정보를 저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  function requestDeleteVehicle() {
    setConfirmSpec({
      kind: 'confirm',
      title: '차량을 삭제할까요?',
      message: '차량과 정비·튜닝 기록을 함께 삭제합니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      onConfirm: async () => {
        await deleteVehicleProfile(vehicleId);
        onChanged();
        onClose();
      },
    });
  }

  function requestDeleteRecord(recordId: number) {
    setConfirmSpec({
      kind: 'confirm',
      title: '기록을 삭제할까요?',
      message: '이 정비·튜닝·부품 기록을 삭제합니다.',
      confirmLabel: '삭제',
      onConfirm: async () => {
        await deleteVehicleRecord(vehicleId, recordId);
        onChanged();
        load();
      },
    });
  }

  async function submitRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const mileage = String(data.get('mileage') || '');
      const cost = String(data.get('cost') || '');
      await createVehicleRecord(vehicleId, {
        kind: String(data.get('kind')) as VehicleRecordKind,
        title: String(data.get('title') || '').trim(),
        content: String(data.get('content') || '').trim(),
        date: String(data.get('date') || ''),
        mileage: mileage === '' ? null : Number(mileage),
        cost: cost === '' ? null : Number(cost),
      });
      onChanged();
      load();
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : '기록을 저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide}`}
      aria-labelledby="vehicle-manage-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="vehicle-manage-title">차량 정보 수정</h2>
      {state.status === 'loading' && <p>차량 정보를 불러오고 있어요.</p>}
      {state.status === 'error' && (
        <p>
          차량 정보를 불러오지 못했어요. <button type="button" onClick={load}>다시 시도</button>
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <form onSubmit={submitEdit}>
            <label>
              차종
              <input name="model" defaultValue={state.vehicle.model} required maxLength={100} disabled={busy} />
            </label>
            <div className={styles.formRow}>
              <label>
                연식
                <input name="year" type="number" defaultValue={state.vehicle.year} min={1900} max={2100} required disabled={busy} />
              </label>
              <label>
                트림
                <input name="trim" defaultValue={state.vehicle.trim ?? ''} maxLength={100} disabled={busy} />
              </label>
            </div>
            <label>
              차 소개
              <textarea name="bio" defaultValue={state.vehicle.bio ?? ''} maxLength={1000} rows={3} disabled={busy} />
            </label>
            <label>
              차량 사진
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => handleImageChange(e.target.files?.[0])}
              />
            </label>
            {imageId && (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.vehiclePhoto} src={imageUrl(imageId)} alt={state.vehicle.model} />{' '}
                <button type="button" className={styles.dangerText} disabled={busy} onClick={() => setImageId(null)}>
                  사진 제거
                </button>
              </div>
            )}
            {error && (
              <p className={styles.dialogError} role="alert">
                {error}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dangerText} disabled={busy} onClick={requestDeleteVehicle}>
                차량 삭제
              </button>
              <button type="button" className={styles.dialogCancel} disabled={busy} onClick={onClose}>
                닫기
              </button>
              <button type="submit" className={styles.primary} disabled={busy}>
                {busy ? '저장 중…' : '차량 저장'}
              </button>
            </div>
          </form>

          <h3>정비 · 튜닝 · 부품 기록 {state.vehicle.records.length}</h3>
          {!state.vehicle.records.length && <p className={styles.empty}>아직 기록이 없어요.</p>}
          <div className={styles.recordList}>
            {state.vehicle.records.map((r) => (
              <div key={r.id} className={styles.recordRow}>
                <div>
                  <small className={styles.empty}>
                    {r.date} · {RECORD_LABELS[r.kind as VehicleRecordKind] ?? r.kind}
                  </small>
                  <strong>{r.title}</strong>
                  {r.content && <p>{r.content}</p>}
                  <small className={styles.empty}>
                    {[r.mileage !== null ? `${r.mileage.toLocaleString()} km` : '', r.cost !== null ? `${r.cost.toLocaleString()}원` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </div>
                <button type="button" className={styles.dangerText} disabled={busy} onClick={() => requestDeleteRecord(r.id)}>
                  삭제
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={submitRecord}>
            <label>
              종류
              <select name="kind" disabled={busy} defaultValue="maintenance">
                {Object.entries(RECORD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              제목
              <input name="title" required maxLength={150} disabled={busy} />
            </label>
            <label>
              날짜
              <input name="date" type="date" required defaultValue={new Date().toLocaleDateString('en-CA')} disabled={busy} />
            </label>
            <label>
              내용
              <textarea name="content" maxLength={2000} rows={2} disabled={busy} />
            </label>
            <div className={styles.formRow}>
              <label>
                주행거리 (km, 선택)
                <input name="mileage" type="number" min={0} max={2000000} disabled={busy} />
              </label>
              <label>
                비용 (원, 선택)
                <input name="cost" type="number" min={0} max={2000000000} disabled={busy} />
              </label>
            </div>
            <div className={styles.dialogActions}>
              <button type="submit" className={styles.primary} disabled={busy}>
                {busy ? '저장 중…' : '기록 저장'}
              </button>
            </div>
          </form>
        </>
      )}
      {confirmSpec && <CommunityDialog spec={confirmSpec} onClose={() => setConfirmSpec(null)} />}
    </dialog>
  );
}
