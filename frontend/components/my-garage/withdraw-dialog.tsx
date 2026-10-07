'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {fetchWithdrawInfo, withdrawAccount} from '../../lib/community-api';
import styles from './my-garage.module.css';

type State = {status: 'loading'} | {status: 'error'} | {status: 'blocked'; message: string} | {status: 'ready'};

// Member withdrawal (formerly home.js's withdrawAccount() panel): same
// notice lines, same server-driven block reasons (admin / reserved listings
// / Kakao / globally unavailable), same password-confirm form. No new API —
// GET/POST /api/auth/withdraw via STEP 3-0's fetchWithdrawInfo/withdrawAccount.
// On success this does a full navigation to "/": the server already revoked
// the session cookie, so a plain reload is enough and matches the legacy
// location.assign("/").
const NOTICE_LINES = [
  '탈퇴하면 되돌릴 수 없고, 같은 아이디·이메일로는 30일 동안 다시 가입할 수 없습니다.',
  '작성한 글과 댓글은 남고 작성자는 "탈퇴한 회원"으로 표시됩니다.',
  '내 차고(차량·정비기록·자동차등록증)와 프로필, 좋아요·북마크·찜·알림은 삭제됩니다.',
  '판매중 매물은 비공개로 닫히고, 판매완료 매물은 연락처만 지워진 채 남습니다.',
];

export default function WithdrawDialog({onClose}: {onClose: () => void}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({status: 'loading'});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    fetchWithdrawInfo()
      .then((info) => {
        if (info.admin) setState({status: 'blocked', message: '관리자 권한을 먼저 해제해야 탈퇴할 수 있습니다.'});
        else if (info.reservedListings > 0)
          setState({
            status: 'blocked',
            message: `예약중인 매물이 ${info.reservedListings}개 있습니다. 거래를 마치거나 판매중으로 바꾼 뒤 탈퇴해주세요.`,
          });
        else if (info.method === 'KAKAO')
          setState({status: 'blocked', message: '카카오 계정은 카카오 재인증으로 탈퇴해야 합니다. 이 기능은 아직 준비 중입니다.'});
        else if (!info.available) setState({status: 'blocked', message: '지금은 회원 탈퇴를 처리할 수 없습니다. 관리자에게 문의해주세요.'});
        else setState({status: 'ready'});
      })
      .catch(() => setState({status: 'error'}));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await withdrawAccount({password: String(form.get('password') || ''), confirm: confirmRef.current?.checked ?? false});
      window.location.assign('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : '회원 탈퇴에 실패했어요.');
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="withdraw-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="withdraw-title">회원 탈퇴</h2>
      {state.status === 'loading' && <p>탈퇴 가능 여부를 확인하고 있어요.</p>}
      {state.status === 'error' && <p>정보를 불러오지 못했어요.</p>}
      {state.status === 'blocked' && (
        <>
          {NOTICE_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className={styles.dialogError} role="alert">
            {state.message}
          </p>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.dialogCancel} onClick={onClose}>
              닫기
            </button>
          </div>
        </>
      )}
      {state.status === 'ready' && (
        <form onSubmit={submit}>
          {NOTICE_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <label>
            현재 비밀번호
            <input type="password" name="password" autoComplete="current-password" required maxLength={255} disabled={busy} />
          </label>
          <label>
            <input ref={confirmRef} type="checkbox" required disabled={busy} /> 위 내용을 확인했고 탈퇴에 동의합니다.
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
            <button type="submit" className={styles.dangerText} disabled={busy}>
              {busy ? '처리 중…' : '회원 탈퇴'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
