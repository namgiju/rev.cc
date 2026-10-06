'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {completePasswordReset, requestPasswordReset, verifyPasswordReset} from '../../lib/auth-api';
import AuthShell from './auth-shell';
import styles from './auth.module.css';

type Message = {text: string; kind: 'error' | 'success'} | null;
type Stage = 'email' | 'code' | 'password';

// /password-reset (assignment-frontend/auth/reset.html + js/password-reset.js).
// Three stages in one page, same as legacy: request a code (username+email) →
// verify the 6-digit code (→ resetToken, kept only in this component's state,
// never in the URL or storage) → set a new password → /login?reset=1. No
// `next` handling — the legacy page doesn't have any.
export default function PasswordResetForm() {
  const [stage, setStage] = useState<Stage>('email');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const tokenRef = useRef('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<Message>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);

  // Mirrors message()'s n.focus(): on error, focus the status line; on
  // success, focus follows whatever auth.js focuses right after (the next
  // stage's first field) — this effect re-runs on every message (including a
  // resend with the same text) because each message is a fresh object.
  useEffect(() => {
    if (!message) return;
    if (message.kind === 'error') {
      messageRef.current?.focus();
      return;
    }
    if (stage === 'code') codeRef.current?.focus();
    else if (stage === 'password') newPasswordRef.current?.focus();
  }, [message, stage]);

  useEffect(() => {
    const onPageHide = () => {
      tokenRef.current = '';
      setUsername('');
      setEmail('');
      setCode('');
      setNewPassword('');
      setNewConfirm('');
    };
    // auth.js always reloads a bfcache-restored page, so the whole 3-stage
    // state machine (and the resetToken) starts over rather than coming back stale.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  function fail(text: string) {
    setMessage({text, kind: 'error'});
  }

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      fail(error instanceof Error ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(async () => {
      if (!username.trim()) return fail('아이디를 입력해주세요.');
      const trimmedEmail = email.trim();
      const result = await requestPasswordReset(username, trimmedEmail);
      if (result.code !== 'CODE_SENT') return fail('발송 상태를 확인하지 못했습니다. 다시 시도해주세요.');
      setEmail(trimmedEmail);
      setStage('code');
      setMessage({text: result.message, kind: 'success'});
    });
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(async () => {
      const result = await verifyPasswordReset(email, code);
      tokenRef.current = result.resetToken;
      setCode('');
      setStage('password');
      setMessage({text: '인증되었습니다. 새 비밀번호를 입력해주세요.', kind: 'success'});
    });
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(async () => {
      if (
        !newPassword.trim() ||
        newPassword.length < 8 ||
        newPassword !== newConfirm ||
        new TextEncoder().encode(newPassword).length > 72
      )
        return fail('비밀번호는 8자 이상, UTF-8 72바이트 이하이며 확인 값과 같아야 합니다.');
      await completePasswordReset(tokenRef.current, newPassword, newConfirm);
      tokenRef.current = '';
      setNewPassword('');
      setNewConfirm('');
      window.location.replace('/login?reset=1');
    });
  }

  return (
    <AuthShell
      title="비밀번호 재설정"
      description={
        <>
          아이디와 가입 시 등록된 이메일로 인증해주세요.
          <br />
          카카오 계정은 카카오 로그인을 이용해주세요.
        </>
      }
    >
      {message && (
        <p ref={messageRef} className={styles.message} data-kind={message.kind} role="status" tabIndex={-1}>
          {message.text}
        </p>
      )}

      {stage !== 'password' && (
        <form onSubmit={submitEmail}>
          <fieldset className={styles.form} disabled={busy}>
            <label htmlFor="reset-username">아이디</label>
            <input
              id="reset-username"
              autoComplete="username"
              maxLength={100}
              required
              autoCapitalize="none"
              spellCheck={false}
              readOnly={stage === 'code'}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <label htmlFor="reset-email">가입 시 등록한 이메일</label>
            <input
              id="reset-email"
              type="email"
              maxLength={254}
              autoComplete="email"
              required
              readOnly={stage === 'code'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className={styles.submit}>
              인증번호 받기 / 재발송
            </button>
          </fieldset>
        </form>
      )}

      {stage === 'code' && (
        <form onSubmit={submitCode}>
          <fieldset className={styles.form} disabled={busy}>
            <label htmlFor="reset-code">6자리 인증번호</label>
            <input
              id="reset-code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <p className={styles.fieldHelp}>인증번호는 5분 동안 유효합니다. 재발송은 60초 후 가능합니다.</p>
            <button type="submit" className={styles.submit}>
              인증하기
            </button>
          </fieldset>
        </form>
      )}

      {stage === 'password' && (
        <form onSubmit={submitPassword}>
          <fieldset className={styles.form} disabled={busy}>
            <label htmlFor="new-password">새 비밀번호</label>
            <input
              id="new-password"
              ref={newPasswordRef}
              type="password"
              autoComplete="new-password"
              maxLength={255}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <label htmlFor="new-confirm">새 비밀번호 확인</label>
            <input
              id="new-confirm"
              type="password"
              autoComplete="new-password"
              maxLength={255}
              required
              value={newConfirm}
              onChange={(e) => setNewConfirm(e.target.value)}
            />
            <p className={styles.fieldHelp}>
              8자 이상이어야 하며 공백만으로 구성할 수 없고 UTF-8 72바이트 이하입니다. 인증 후 10분 안에
              변경해주세요.
            </p>
            <button type="submit" className={styles.submit}>
              비밀번호 변경
            </button>
          </fieldset>
        </form>
      )}

      <p className={styles.switch}>
        <a href="/password-reset">처음부터 다시 인증</a> · <a href="/login">로그인으로 돌아가기 →</a>
      </p>
    </AuthShell>
  );
}
