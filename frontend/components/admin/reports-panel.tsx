'use client';

import {useCallback, useRef, useState} from 'react';
import {fetchAdminReports} from '../../lib/admin-api';
import type {AdminReport, ReportStatus} from '../../lib/admin-types';
import {adminDate, REPORT_STATUS_LABELS} from '../../lib/admin-format';
import {postUrl} from '../../lib/format';
import AdminList, {type AdminListHandle} from './admin-list';
import ReportDialog from './report-dialog';
import styles from './admin.module.css';

const STATUS_FILTERS: Record<ReportStatus | '', string> = {
  '': '전체',
  pending: '검토 대기',
  resolved: '처리 완료',
  dismissed: '반려',
};

// 신고 관리 — assignment-frontend/js/admin.js의 reports 패널 포팅.
export default function ReportsPanel({onAccessDenied}: {onAccessDenied: () => void}) {
  const [status, setStatus] = useState<ReportStatus | ''>('');
  const [reviewTarget, setReviewTarget] = useState<AdminReport | null>(null);
  const listRef = useRef<AdminListHandle>(null);

  const load = useCallback(
    (params: {q: string; page: number}) => fetchAdminReports({q: params.q, status, page: params.page}),
    [status],
  );

  return (
    <section className={styles.panel}>
      <h2>신고 관리</h2>
      <AdminList<AdminReport>
        ref={listRef}
        searchLabel="신고 검색"
        searchPlaceholder="제목 / 사용자 검색"
        extraFilters={
          <select aria-label="신고 상태 필터" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus | '')}>
            {(Object.keys(STATUS_FILTERS) as (ReportStatus | '')[]).map((value) => (
              <option key={value} value={value}>
                {STATUS_FILTERS[value]}
              </option>
            ))}
          </select>
        }
        load={load}
        getRowKey={(item) => item.id}
        onAccessDenied={onAccessDenied}
        emptyText="조회 결과가 없습니다."
        columns={[
          {
            header: '대상 게시글',
            render: (item) => (
              <a className={styles.textLink} href={postUrl({id: item.postId, category: item.category})} target="_blank" rel="noopener">
                {item.title}
              </a>
            ),
          },
          {header: '신고자', render: (item) => item.reporter},
          {header: '사유', render: (item) => item.reason},
          {
            header: '처리 기록',
            render: (item) => (
              <div>
                <span>{REPORT_STATUS_LABELS[item.status] || item.status}</span>
                {item.postDeleted && (
                  <>
                    <p>{item.deletedReason === 'AUTHOR' ? '작성자가 삭제한 글' : '관리자가 삭제한 글'}</p>
                    {item.deletedContent != null && (
                      <details>
                        <summary>삭제된 글 원문</summary>
                        <p className={styles.detailText}>{item.deletedContent}</p>
                      </details>
                    )}
                  </>
                )}
                {item.reviewedAt && (
                  <>
                    <p>
                      {item.reviewer || '삭제된 담당자'} · {adminDate(item.reviewedAt)}
                    </p>
                    <p>{item.resolutionNote}</p>
                  </>
                )}
              </div>
            ),
          },
          {
            header: '검토',
            render: (item) =>
              item.status === 'pending' ? (
                <button type="button" className={styles.secondary} onClick={() => setReviewTarget(item)}>
                  검토
                </button>
              ) : null,
          },
        ]}
      />
      {reviewTarget && (
        <ReportDialog
          reportId={reviewTarget.id}
          postTitle={reviewTarget.title}
          onClose={() => setReviewTarget(null)}
          onReviewed={() => listRef.current?.reload()}
        />
      )}
    </section>
  );
}
