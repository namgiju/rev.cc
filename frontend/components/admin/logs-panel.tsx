'use client';

import {useCallback} from 'react';
import {fetchAdminLogs} from '../../lib/admin-api';
import type {ModerationLog} from '../../lib/admin-types';
import {ADMIN_CATEGORY_LABELS, adminDate, MODERATION_ACTION_LABELS} from '../../lib/admin-format';
import AdminList from './admin-list';
import styles from './admin.module.css';

// 운영 로그 — assignment-frontend/js/admin.js의 logs 패널 포팅.
export default function LogsPanel({onAccessDenied}: {onAccessDenied: () => void}) {
  const load = useCallback((params: {q: string; page: number}) => fetchAdminLogs(params), []);

  return (
    <section className={styles.panel}>
      <h2>운영 로그</h2>
      <AdminList<ModerationLog>
        searchLabel="운영 로그 검색"
        searchPlaceholder="제목 / 사용자 검색"
        load={load}
        getRowKey={(item) => item.id}
        onAccessDenied={onAccessDenied}
        emptyText="조회 결과가 없습니다."
        columns={[
          {header: '처리 일시 / 관리자', render: (item) => `${adminDate(item.created_at)} · ${item.admin_username}`},
          {
            header: '게시판 / 게시글',
            render: (item) => `${ADMIN_CATEGORY_LABELS[item.category] || item.category} > ${item.post_title} (#${item.post_id})`,
          },
          {
            header: '대상 / 작성자',
            render: (item) =>
              `${MODERATION_ACTION_LABELS[item.action_type] || item.action_type} #${item.target_id} 삭제 · ${item.target_author_username}`,
          },
          {
            header: '삭제 사유 / 원문',
            render: (item) => (
              <div>
                <p>{item.reason}</p>
                {item.original_content != null && (
                  <details>
                    <summary>삭제 당시 원문</summary>
                    <p className={styles.detailText}>{item.original_content}</p>
                  </details>
                )}
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
