'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {createGuestbookEntry, deleteGuestbookEntry, fetchGuestbook} from '../../lib/community-api';
import type {GuestbookEntry} from '../../lib/community-types';
import type {SessionUser} from '../../lib/home-types';
import {formatDateTime} from '../../lib/format';
import CommunityDialog, {type DialogSpec} from './community-dialog';
import MemberLink from './member-link';
import styles from './post-detail.module.css';

type Props = {
  ownerId: number;
  viewer: SessionUser | null;
  requireLogin: () => boolean;
  notify: (message: string) => void;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 처리하지 못했어요.';
}

// Garage guestbook (guestbook-ui.js) — garage_guestbook, never board_comments.
// 20 per page with a "더 보기" cursor; write needs login; delete is offered to
// the entry's author and the guestbook owner (the server checks the same).
export default function Guestbook({ownerId, viewer, requireLogin, notify}: Props) {
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const ticket = useRef(0);

  const load = useCallback(
    async (more = false, before: number | null = null) => {
      const current = ++ticket.current;
      if (!more) setState('loading');
      try {
        const page = await fetchGuestbook(ownerId, more ? before : null);
        if (current !== ticket.current) return;
        setEntries((prev) => (more ? [...prev, ...page.items] : page.items));
        setTotal(page.total);
        setCursor(page.nextCursor);
        setState('ready');
      } catch (error) {
        if (current !== ticket.current) return;
        if (more) notify(errorText(error));
        else setState('error');
      }
    },
    [ownerId, notify],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || !requireLogin()) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await createGuestbookEntry(ownerId, content);
      setContent('');
      await load();
    } catch (error) {
      notify(errorText(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function requestDelete(entry: GuestbookEntry) {
    setDialog({
      kind: 'confirm',
      title: '삭제할까요?',
      message: '이 방명록 메시지를 삭제할까요?',
      confirmLabel: '삭제',
      onConfirm: async () => {
        await deleteGuestbookEntry(ownerId, entry.id);
        await load();
      },
    });
  }

  return (
    <section className={styles.comments} aria-labelledby="guestbook-title">
      <h3 id="guestbook-title">방명록{total === null ? '' : ` ${total}`}</h3>
      {viewer ? (
        <form className={styles.commentForm} onSubmit={submit}>
          <textarea
            required
            maxLength={1000}
            rows={3}
            aria-label="방명록 내용"
            placeholder="서로를 존중하는 따뜻한 메시지를 남겨주세요."
            readOnly={submitting}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? '등록 중…' : '방명록 등록'}
          </button>
        </form>
      ) : (
        <p className={styles.muted}>방명록을 남기려면 로그인해주세요.</p>
      )}

      {state === 'loading' && <p className={styles.muted}>방명록을 불러오고 있어요.</p>}
      {state === 'error' && (
        <p className={styles.emptyComments}>
          방명록을 불러오지 못했어요.{' '}
          <button type="button" className={styles.textButton} onClick={() => void load()}>
            다시 시도
          </button>
        </p>
      )}
      {state === 'ready' && !entries.length && <p className={styles.emptyComments}>아직 남겨진 메시지가 없습니다.</p>}
      {state === 'ready' &&
        entries.map((entry) => (
          <div key={entry.id} className={styles.comment} data-entry-id={entry.id}>
            <div className={styles.commentMeta}>
              <MemberLink id={entry.authorId} name={entry.username} />
              <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
              {viewer && (viewer.id === entry.authorId || viewer.id === ownerId) && (
                <button type="button" className={styles.dangerText} onClick={() => requestDelete(entry)}>
                  삭제
                </button>
              )}
            </div>
            <p>{entry.content}</p>
          </div>
        ))}
      {state === 'ready' && cursor && (
        <button type="button" className={styles.moreButton} onClick={() => void load(true, cursor)}>
          더 보기
        </button>
      )}
      {dialog && <CommunityDialog spec={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}
