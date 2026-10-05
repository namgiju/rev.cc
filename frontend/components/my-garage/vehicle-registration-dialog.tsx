'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {createOwnerVehicle, submitVehicleVerification} from '../../lib/community-api';
import type {OwnerVehicle} from '../../lib/community-types';
import styles from './my-garage.module.css';

const currentYear = new Date().getFullYear();

// Vehicle registration (formerly #registration-dialog in
// assignment-frontend/home/index.html): step 1 creates the core vehicle row
// (manufacturer/model/modelYear/licensePlate), step 2 optionally uploads the
// registration document to request owner verification ("나중에 하기" skips
// it — verification can be requested later, but that re-request flow is a
// later STEP, not this one). Editing/deleting/records are out of scope here.
export default function VehicleRegistrationDialog({
  onClose,
  onVehicleCreated,
  notify,
}: {
  onClose: () => void;
  onVehicleCreated: () => void;
  notify: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'info' | 'document'>('info');
  const [vehicle, setVehicle] = useState<OwnerVehicle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function submitInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const created = await createOwnerVehicle({
        manufacturer: String(form.get('manufacturer') || '').trim(),
        model: String(form.get('model') || '').trim(),
        modelYear: Number(form.get('modelYear')),
        licensePlate: String(form.get('licensePlate') || '').trim(),
        trim: '',
        transmission: '',
        color: '',
        nickname: '',
        description: '',
      });
      setVehicle(created);
      onVehicleCreated();
      setStep('document');
    } catch (e) {
      setError(e instanceof Error ? e.message : '차량 등록에 실패했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !vehicle) return;
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await submitVehicleVerification(vehicle.id, file);
      onVehicleCreated();
      onClose();
      notify('오너 인증을 신청했어요. 관리자 검토 후 결과를 알려드릴게요.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '인증 신청에 실패했어요.');
    } finally {
      setBusy(false);
    }
  }

  function skipDocument() {
    onClose();
    notify('차량이 등록되었어요. 준비되면 차고에서 오너 인증을 신청해주세요.');
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="vehicle-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="vehicle-dialog-title">{step === 'info' ? '내 차 등록' : '오너 인증 신청'}</h2>
      {step === 'info' && (
        <form onSubmit={submitInfo}>
          <label>
            제조사
            <input name="manufacturer" required maxLength={100} placeholder="예: 현대" disabled={busy} />
          </label>
          <label>
            모델명
            <input name="model" required maxLength={100} placeholder="예: 아반떼 N" disabled={busy} />
          </label>
          <label>
            연식
            <input name="modelYear" type="number" required min={1900} max={2100} defaultValue={currentYear} disabled={busy} />
          </label>
          <label>
            차량번호
            <input name="licensePlate" required maxLength={20} placeholder="예: 123가4567" disabled={busy} />
          </label>
          {error && (
            <p className={styles.dialogError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.dialogCancel} disabled={busy} onClick={onClose}>
              취소
            </button>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? '등록 중…' : '다음: 등록증 업로드'}
            </button>
          </div>
        </form>
      )}
      {step === 'document' && (
        <form onSubmit={submitDocument}>
          <p>
            자동차등록증의 주민등록번호와 주소는 반드시 가리고 업로드해주세요. JPG, PNG, WebP 형식만 지원하며, 관리자가 직접 확인한 뒤
            오너 인증을 승인합니다.
          </p>
          <label>
            자동차등록증 이미지
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy} />
          </label>
          {error && (
            <p className={styles.dialogError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.dialogCancel} disabled={busy} onClick={skipDocument}>
              나중에 하기
            </button>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? '제출 중…' : '인증 요청 제출'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
