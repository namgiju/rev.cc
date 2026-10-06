'use client';

import {useCallback, useEffect, useState} from 'react';
import {ApiError, fetchAdminOverview, fetchBoardOverview} from '../../lib/admin-api';
import styles from './admin.module.css';

// 대시보드 — assignment-frontend/js/admin.js's refreshOverview(): combines
// Spring's /api/admin/overview (회원/차량) and board-service's
// /api/board/admin/overview (게시글/신고 대기) into four stat tiles.
export default function OverviewPanel({onAccessDenied}: {onAccessDenied: () => void}) {
  const [stats, setStats] = useState<{totalUsers: number; totalVehicles: number; totalPosts: number; pendingReports: number} | null>(
    null,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [core, board] = await Promise.all([fetchAdminOverview(), fetchBoardOverview()]);
      setStats({...core, ...board});
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAccessDenied();
        return;
      }
      setError(e instanceof Error ? e.message : '통계를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [onAccessDenied]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className={styles.panel}>
      <h2>대시보드</h2>
      {error ? (
        <p className={styles.empty}>{error}</p>
      ) : (
        <div className={styles.statRow}>
          {stats ? (
            <>
              <div className={styles.statTile}>
                <p>총 회원 수</p>
                <strong>{stats.totalUsers}</strong>
              </div>
              <div className={styles.statTile}>
                <p>총 등록 차량 수</p>
                <strong>{stats.totalVehicles}</strong>
              </div>
              <div className={styles.statTile}>
                <p>게시글 수</p>
                <strong>{stats.totalPosts}</strong>
              </div>
              <div className={styles.statTile}>
                <p>신고 대기</p>
                <strong>{stats.pendingReports}</strong>
              </div>
            </>
          ) : (
            <p className={styles.empty}>불러오는 중…</p>
          )}
        </div>
      )}
      <button type="button" className={styles.secondary} disabled={loading} onClick={refresh}>
        새로고침
      </button>
      <p className={styles.empty}>실제 회원·차량·커뮤니티 신고 데이터를 집계합니다.</p>
    </section>
  );
}
