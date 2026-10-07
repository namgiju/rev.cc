'use client';

import {useCallback, useEffect, useState} from 'react';
import {ApiError, fetchAdminBadges} from '../../lib/admin-api';
import type {AdminBadge} from '../../lib/admin-types';
import styles from './admin.module.css';

// 인장 현황 — assignment-frontend/js/admin.js의 loadBadges() 포팅.
export default function TagsPanel({onAccessDenied}: {onAccessDenied: () => void}) {
  const [badges, setBadges] = useState<AdminBadge[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    fetchAdminBadges()
      .then(setBadges)
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAccessDenied();
          return;
        }
        setError(e instanceof Error ? e.message : '불러오지 못했어요.');
      });
  }, [onAccessDenied]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className={styles.panel}>
      <h2>인장 현황</h2>
      <p>현재 인장은 차량 인증 상태로 자동 계산됩니다.</p>
      <button type="button" className={styles.secondary} onClick={load}>
        새로고침
      </button>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>인장</th>
              <th>획득 조건</th>
              <th>보유 회원 수</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={3}>{error}</td>
              </tr>
            ) : !badges ? (
              <tr>
                <td colSpan={3}>불러오는 중…</td>
              </tr>
            ) : (
              badges.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td>{b.description}</td>
                  <td>{b.holders}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
