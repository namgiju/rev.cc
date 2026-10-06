'use client';

import {useCallback, useEffect, useState} from 'react';
import {ApiError, decideVehicleVerification, fetchVehicleVerifications, verificationDocumentUrl} from '../../lib/admin-api';
import type {VehicleVerification} from '../../lib/admin-types';
import {VERIFICATION_STATUS_LABELS} from '../../lib/admin-format';
import styles from './admin.module.css';

const CHIP_CLASS = {ok: styles.chipOk, pending: styles.chipPending, blocked: styles.chipBlocked} as const;

// 차량 인증 관리 — assignment-frontend/js/admin.js의
// renderVehicleVerifications()/decide() 포팅. 자동차등록증 원본은 이 화면과
// 신청 본인만 볼 수 있다(쿠키 인증 링크, fetch 없이 새 탭으로 연다).
export default function VehiclesPanel({onAccessDenied}: {onAccessDenied: () => void}) {
  const [items, setItems] = useState<VehicleVerification[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    setError('');
    fetchVehicleVerifications()
      .then(setItems)
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAccessDenied();
          return;
        }
        setError('차량 인증 목록을 불러오지 못했어요.');
      });
  }, [onAccessDenied]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: number, action: 'approve' | 'reject') {
    setBusyId(id);
    try {
      await decideVehicleVerification(id, action);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했어요.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={styles.panel}>
      <h2>차량 인증 관리</h2>
      <p className={styles.empty}>실제 인증 신청 데이터입니다. 자동차등록증 원본은 이 화면(관리자)과 신청 본인만 볼 수 있습니다.</p>
      {error && <p className={styles.empty}>{error}</p>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>사용자</th>
              <th>차량번호</th>
              <th>제조사/모델</th>
              <th>연식</th>
              <th>신청일</th>
              <th>등록증</th>
              <th>상태</th>
              <th>처리</th>
            </tr>
          </thead>
          <tbody>
            {!items ? (
              <tr>
                <td colSpan={8}>불러오는 중…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8}>신청된 인증이 없어요.</td>
              </tr>
            ) : (
              items.map((item) => {
                const [chipText, chipKind] = VERIFICATION_STATUS_LABELS[item.status] || [item.status, 'pending'];
                return (
                  <tr key={item.id}>
                    <td>{item.username}</td>
                    <td>{item.licensePlate}</td>
                    <td>
                      {item.manufacturer} {item.model}
                    </td>
                    <td>{item.modelYear}</td>
                    <td>{new Date(item.requestedAt).toLocaleDateString('ko-KR')}</td>
                    <td>
                      <a className={styles.textLink} href={verificationDocumentUrl(item.id)} target="_blank" rel="noopener">
                        이미지 보기
                      </a>
                    </td>
                    <td>
                      <span className={`${styles.chip} ${CHIP_CLASS[chipKind]}`}>{chipText}</span>
                    </td>
                    <td>
                      {item.status === 'PENDING' ? (
                        <>
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={busyId === item.id}
                            onClick={() => decide(item.id, 'approve')}
                          >
                            승인
                          </button>{' '}
                          <button
                            type="button"
                            className={styles.dangerText}
                            disabled={busyId === item.id}
                            onClick={() => decide(item.id, 'reject')}
                          >
                            거절
                          </button>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
