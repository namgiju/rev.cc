'use client';

import {useEffect, useState} from 'react';
import {fetchMyReports, fetchNotifications, markNotificationsRead} from '../../lib/community-api';
import type {CommunityNotification, CommunityReport} from '../../lib/community-types';
import type {SessionUser} from '../../lib/home-types';
import {formatDateTime, postUrl} from '../../lib/format';
import {SCOPE_LABELS} from './categories';
import CommunityPanel from './community-panel';
import styles from './post-detail.module.css';

type Load<T> = T | 'loading' | 'error';

const REPORT_STATUS: Record<string, string> = {pending: '접수됨', resolved: '처리 완료', dismissed: '반려'};

// "내 활동" (app.js's #activity-button panel): the three activity scopes of
// the list, 내 차고 and the member's own report history.
export function ActivityPanel({user, onClose}: {user: SessionUser; onClose: () => void}) {
  const [reports, setReports] = useState<Load<CommunityReport[]> | null>(null);

  async function openReports() {
    setReports('loading');
    try {
      setReports(await fetchMyReports());
    } catch {
      setReports('error');
    }
  }

  if (reports !== null) {
    return (
      <CommunityPanel title="내 신고 내역" onClose={onClose}>
        {reports === 'loading' && <p className={styles.muted}>신고 내역을 불러오고 있어요.</p>}
        {reports === 'error' && (
          <p className={styles.muted}>
            신고 내역을 불러오지 못했어요.{' '}
            <button type="button" className={styles.textButton} onClick={openReports}>
              다시 시도
            </button>
          </p>
        )}
        {Array.isArray(reports) && !reports.length && <p className={styles.emptyComments}>접수한 신고가 없습니다.</p>}
        {Array.isArray(reports) &&
          reports.map((r) => (
            <div key={r.id} className={styles.panelRow}>
              <a href={postUrl({id: r.postId, category: r.category})}>{r.title}</a>
              <p>{r.reason}</p>
              <small>
                {REPORT_STATUS[r.status] || r.status} · {formatDateTime(r.createdAt)}
              </small>
            </div>
          ))}
      </CommunityPanel>
    );
  }

  return (
    <CommunityPanel title={`${user.username} 님의 활동`} onClose={onClose}>
      <div className={styles.panelActions}>
        {(['mine', 'commented', 'bookmarks'] as const).map((scope) => (
          <a key={scope} href={`/community?scope=${scope}`}>
            {SCOPE_LABELS[scope]}
          </a>
        ))}
        <a href="/home">내 차고</a>
        <button type="button" onClick={openReports}>
          내 신고 내역
        </button>
      </div>
    </CommunityPanel>
  );
}

// "알림" (app.js's #notifications-button panel): list, then mark all read.
export function NotificationsPanel({onClose, onRead}: {onClose: () => void; onRead: () => void}) {
  const [notes, setNotes] = useState<Load<CommunityNotification[]>>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchNotifications();
        if (cancelled) return;
        setNotes(list);
        // Shown with their unread state first, then marked read (legacy order).
        if (list.some((n) => !n.isRead)) {
          await markNotificationsRead();
          if (!cancelled) onRead();
        }
      } catch {
        if (!cancelled) setNotes((current) => (Array.isArray(current) ? current : 'error'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CommunityPanel title="알림" onClose={onClose}>
      {notes === 'loading' && <p className={styles.muted}>알림을 불러오고 있어요.</p>}
      {notes === 'error' && <p className={styles.muted}>알림을 불러오지 못했어요.</p>}
      {Array.isArray(notes) && !notes.length && (
        <p className={styles.emptyComments}>아직 새 알림이 없어요. 내 글이나 댓글에 답변이 달리면 알려드릴게요.</p>
      )}
      {Array.isArray(notes) &&
        notes.map((n) => (
          <div key={n.id} className={n.isRead ? styles.panelRow : `${styles.panelRow} ${styles.unread}`}>
            <a href={postUrl({id: n.postId, category: n.category})}>
              {n.username} 님이 댓글을 남겼어요 · {n.title}
            </a>
            <small>{formatDateTime(n.createdAt)}</small>
          </div>
        ))}
    </CommunityPanel>
  );
}
