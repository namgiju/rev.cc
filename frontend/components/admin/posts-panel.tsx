'use client';

import {useCallback, useState} from 'react';
import {fetchAdminPosts} from '../../lib/admin-api';
import type {AdminPost} from '../../lib/admin-types';
import {ADMIN_CATEGORY_LABELS, adminDate} from '../../lib/admin-format';
import {postUrl} from '../../lib/format';
import AdminList from './admin-list';
import styles from './admin.module.css';

type Category = '' | keyof typeof ADMIN_CATEGORY_LABELS;

// 게시글 관리 — assignment-frontend/js/admin.js의 posts 패널 포팅.
export default function PostsPanel({onAccessDenied}: {onAccessDenied: () => void}) {
  const [category, setCategory] = useState<Category>('');

  const load = useCallback(
    (params: {q: string; page: number}) => fetchAdminPosts({q: params.q, category, page: params.page}),
    [category],
  );

  return (
    <section className={styles.panel}>
      <h2>게시글 관리</h2>
      <AdminList<AdminPost>
        searchLabel="게시글 검색"
        searchPlaceholder="제목 / 사용자 검색"
        extraFilters={
          <select aria-label="게시판 필터" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            <option value="">전체</option>
            {(Object.keys(ADMIN_CATEGORY_LABELS) as (keyof typeof ADMIN_CATEGORY_LABELS)[]).map((value) => (
              <option key={value} value={value}>
                {ADMIN_CATEGORY_LABELS[value]}
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
            header: '제목',
            render: (item) => (
              <a className={styles.textLink} href={postUrl(item)} target="_blank" rel="noopener">
                {item.title}
              </a>
            ),
          },
          {header: '작성자', render: (item) => item.username},
          {header: '게시판', render: (item) => ADMIN_CATEGORY_LABELS[item.category] || item.category},
          {header: '신고', render: (item) => String(item.reportCount)},
          {header: '작성일', render: (item) => adminDate(item.createdAt)},
        ]}
      />
    </section>
  );
}
