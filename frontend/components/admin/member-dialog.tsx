'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {fetchMember, fetchMemberActions, resetMemberPassword, updateMember} from '../../lib/admin-api';
import type {AdminMember, MemberAction, MemberRole, MemberStatus} from '../../lib/admin-types';
import {MEMBER_STATUS_LABELS as STATUS_LABELS} from '../../lib/admin-format';
import styles from './admin.module.css';

// Local datetime-local string <-> ISO, matching assignment-frontend/js/
// admin.js's openMember()/submit handler (device-local time in the input).
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function actionText(entry: MemberAction): string {
  const createdAt = new Date(entry.createdAt).toLocaleString('ko-KR');
  if (entry.action.startsWith('SELF_WITHDRAW')) {
    return `${createdAt} · 본인 탈퇴 (탈퇴 전 상태: ${entry.action.split(':')[1] || '-'})`;
  }
  if (entry.action === 'PASSWORD_RESET_REQUEST') {
    return `${createdAt} · 관리자 #${entry.adminId} · 비밀번호 재설정 메일 요청`;
  }
  const changed = entry.action
    .replace('UPDATE:', '회원 정보 변경: ')
    .replace('NICKNAME', '닉네임')
    .replace('EMAIL', '이메일')
    .replace('ROLE', '권한')
    .replace('STATUS', '상태');
  return `${createdAt} · 관리자 #${entry.adminId} · ${changed}`;
}

type State = {status: 'loading'} | {status: 'error'} | {status: 'ready'; member: AdminMember};

// 회원 상세/수정 다이얼로그 — assignment-frontend/js/admin.js의
// openMember()/setupMembers()/member-form 전체를 포팅. 서버가 마지막 관리자
// 보호·자기 자신 변경 금지·낙관적 잠금을 전부 처리하므로, 이 다이얼로그는
// 서버 메시지를 그대로 보여주기만 한다.
export default function MemberDialog({
  memberId,
  onClose,
  onUpdated,
}: {
  memberId: number;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({status: 'loading'});
  const [actions, setActions] = useState<MemberAction[]>([]);
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Exclude<MemberStatus, 'WITHDRAWN'>>('ACTIVE');
  const [role, setRole] = useState<MemberRole>('USER');
  const [suspendedUntil, setSuspendedUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const viewRef = useRef(0);

  const loadActions = useCallback((view: number) => {
    fetchMemberActions(memberId)
      .then((list) => {
        if (view === viewRef.current) setActions(list);
      })
      .catch(() => {});
  }, [memberId]);

  const load = useCallback(() => {
    const view = ++viewRef.current;
    setState({status: 'loading'});
    fetchMember(memberId)
      .then((member) => {
        if (view !== viewRef.current) return;
        setState({status: 'ready', member});
        setNickname(member.nickname || '');
        setEmail(member.email || '');
        setStatus(member.status === 'WITHDRAWN' ? 'ACTIVE' : member.status);
        setRole(member.role);
        setSuspendedUntil(toLocalInput(member.suspendedUntil));
        setMessage(member.kakaoOnly ? '카카오 전용 계정입니다.' : member.status === 'WITHDRAWN' ? '탈퇴한 회원입니다. 정보를 변경하거나 상태를 되돌릴 수 없습니다.' : '');
        loadActions(view);
      })
      .catch(() => {
        if (view === viewRef.current) setState({status: 'error'});
      });
  }, [memberId, loadActions]);

  useEffect(() => {
    load();
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const withdrawn = state.status === 'ready' && state.member.status === 'WITHDRAWN';
  const readOnly = busy || withdrawn;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || withdrawn) return;
    setBusy(true);
    setMessage('');
    try {
      const updated = await updateMember(memberId, {
        nickname,
        email,
        status,
        role,
        suspendedUntil: status === 'SUSPENDED' && suspendedUntil ? new Date(suspendedUntil).toISOString() : null,
      });
      onUpdated();
      setState({status: 'ready', member: updated});
      setMessage('저장했습니다. 기존 로그인 세션이 만료되었습니다.');
      loadActions(viewRef.current);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset() {
    if (busy || withdrawn || state.status !== 'ready') return;
    setBusy(true);
    setMessage('');
    try {
      const result = await resetMemberPassword(memberId);
      setMessage(result.message);
      loadActions(viewRef.current);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '요청하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide}`}
      aria-labelledby="member-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="member-dialog-title">
        {state.status === 'ready' ? `회원 #${state.member.id} · ${state.member.username}` : '회원 상세'}
      </h2>
      {state.status === 'loading' && <p>불러오는 중…</p>}
      {state.status === 'error' && (
        <p>
          회원 정보를 불러오지 못했어요. <button type="button" onClick={load}>다시 시도</button>
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <form onSubmit={submit}>
            <label>
              닉네임
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={100} disabled={readOnly} />
            </label>
            <label>
              이메일
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} disabled={readOnly} />
            </label>
            <p className={styles.fieldHelp}>
              이메일 변경 시 본인 소유 주소인지 별도로 확인해주세요. 저장하면 해당 회원의 모든 기존 세션과 재설정 권한이 만료됩니다.
            </p>
            <label>
              계정 상태
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Exclude<MemberStatus, 'WITHDRAWN'>)}
                disabled={readOnly}
              >
                <option value="ACTIVE">{STATUS_LABELS.ACTIVE}</option>
                <option value="SUSPENDED">{STATUS_LABELS.SUSPENDED}</option>
                <option value="DISABLED">{STATUS_LABELS.DISABLED}</option>
              </select>
            </label>
            <label>
              정지 종료일 (비우면 무기한, 현재 기기 시간대)
              <input
                type="datetime-local"
                value={suspendedUntil}
                onChange={(e) => setSuspendedUntil(e.target.value)}
                disabled={readOnly}
              />
            </label>
            <label>
              권한
              <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} disabled={readOnly}>
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            {message && <p className={styles.dialogMessage} role="status">{message}</p>}
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} disabled={busy} onClick={onClose}>
                닫기
              </button>
              <button type="submit" className={styles.primary} disabled={readOnly}>
                {busy ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>
          <button
            type="button"
            className={styles.secondary}
            disabled={readOnly || !state.member.email || state.member.kakaoOnly}
            onClick={requestPasswordReset}
          >
            비밀번호 재설정 메일 발송
          </button>
          <h3>최근 회원 관리 기록 (최대 50건)</h3>
          {actions.length === 0 ? (
            <p className={styles.empty}>기록이 없어요.</p>
          ) : (
            <ul className={styles.actionList}>
              {actions.map((a, i) => (
                <li key={i}>{actionText(a)}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </dialog>
  );
}
