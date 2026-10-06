'use client';

import {useCallback, useRef, useState} from 'react';
import {fetchMembers} from '../../lib/admin-api';
import type {AdminMember, MemberField, MemberStatus} from '../../lib/admin-types';
import {adminDate, MEMBER_STATUS_LABELS} from '../../lib/admin-format';
import AdminList, {type AdminListHandle} from './admin-list';
import MemberDialog from './member-dialog';
import styles from './admin.module.css';

const FIELD_LABELS: Record<MemberField, string> = {username: '아이디', nickname: '닉네임', email: '이메일'};
const STATUS_FILTERS: Record<MemberStatus | '', string> = {
  '': '전체 상태',
  ACTIVE: '정상',
  SUSPENDED: '정지',
  DISABLED: '비활성',
  WITHDRAWN: '탈퇴',
};

// 회원 관리 — assignment-frontend/js/admin.js의 members 패널 포팅.
export default function MembersPanel({onAccessDenied}: {onAccessDenied: () => void}) {
  const [field, setField] = useState<MemberField>('username');
  const [status, setStatus] = useState<MemberStatus | ''>('');
  const [openId, setOpenId] = useState<number | null>(null);
  const listRef = useRef<AdminListHandle>(null);

  const load = useCallback(
    (params: {q: string; page: number}) => fetchMembers({q: params.q, field, status, page: params.page}),
    [field, status],
  );

  return (
    <section className={styles.panel}>
      <h2>회원 관리</h2>
      <AdminList<AdminMember>
        ref={listRef}
        searchLabel="회원 검색"
        searchPlaceholder="회원 검색"
        extraFilters={
          <>
            <select aria-label="검색 항목" value={field} onChange={(e) => setField(e.target.value as MemberField)}>
              {(Object.keys(FIELD_LABELS) as MemberField[]).map((value) => (
                <option key={value} value={value}>
                  {FIELD_LABELS[value]}
                </option>
              ))}
            </select>
            <select aria-label="계정 상태" value={status} onChange={(e) => setStatus(e.target.value as MemberStatus | '')}>
              {(Object.keys(STATUS_FILTERS) as (MemberStatus | '')[]).map((value) => (
                <option key={value} value={value}>
                  {STATUS_FILTERS[value]}
                </option>
              ))}
            </select>
          </>
        }
        load={load}
        getRowKey={(item) => item.id}
        onAccessDenied={onAccessDenied}
        emptyText="조회 결과가 없습니다."
        columns={[
          {header: 'ID', render: (item) => String(item.id)},
          {
            header: '아이디',
            render: (item) => (
              <button type="button" className={styles.secondary} onClick={() => setOpenId(item.id)}>
                {item.username}
              </button>
            ),
          },
          {header: '닉네임', render: (item) => item.nickname || '—'},
          {header: '이메일', render: (item) => item.email || '미등록'},
          {header: '가입일', render: (item) => adminDate(item.joinedAt)},
          {header: '상태', render: (item) => MEMBER_STATUS_LABELS[item.status] || item.status},
          {header: '권한', render: (item) => item.role},
        ]}
      />
      {openId !== null && (
        <MemberDialog
          memberId={openId}
          onClose={() => setOpenId(null)}
          onUpdated={() => listRef.current?.reload()}
        />
      )}
    </section>
  );
}
