'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useSearchParams} from 'next/navigation';
import {fetchAuthMe, login} from '../../lib/auth-api';
import {safeNext, withNext} from '../../lib/auth-next';
import {ApiError} from '../../lib/home-api';
import AuthShell from './auth-shell';
import PasswordField from './password-field';
import styles from './auth.module.css';

type Message = {text: string; kind: 'error' | 'success'} | null;

// /login (assignment-frontend/auth/index.html + js/auth.js, login mode).
// Same flow: POST /api/auth/login → GET /api/auth/me → `next` or the role's
// default page. Already-signed-in visitors see the form as before (no
// redirect). One deliberate change: a 429 (account lock / rate limit) shows
// the server's message instead of the generic error.
export default function LoginForm() {
  const searchParams = useSearchParams();
  const [next, setNext] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<Message>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setNext(safeNext(searchParams.get('next'), window.location.origin));
    if (searchParams.get('joined') === '1')
      setMessage({text: '회원가입이 완료되었습니다. 새 계정으로 로그인해주세요.', kind: 'success'});
    else if (searchParams.get('reset') === '1')
      setMessage({text: '비밀번호가 변경되었습니다. 다시 로그인해주세요.', kind: 'success'});
  }, [searchParams]);

  // Like the legacy message(): move focus to the status line so it's read out.
  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  // Don't leave the password on a page kept in the back/forward cache.
  useEffect(() => {
    const onPageHide = () => {
      setPassword('');
      setShown(false);
    };
    const onPageShow = () => {
      busyRef.current = false;
      setBusy(false);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    if (!username.trim() || !password.trim()) return fail('아이디와 비밀번호를 입력해주세요.');
    if (!event.currentTarget.reportValidity()) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    let leaving = false;
    try {
      await login(username, password);
      let user;
      try {
        user = await fetchAuthMe();
      } catch {
        return fail('로그인 세션을 확인하지 못했습니다. 쿠키 설정을 확인하고 다시 로그인해주세요.');
      }
      leaving = true;
      window.location.replace(next ?? (user.role === 'ADMIN' ? '/admin' : '/'));
    } catch (error) {
      if (!(error instanceof ApiError)) fail('서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.');
      else if (error.status === 400 || error.status === 401) fail('아이디 또는 비밀번호가 올바르지 않습니다.');
      else if (error.status === 429) fail(error.message || '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.');
      else fail('요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setPassword('');
      setShown(false);
      // Success keeps the form locked while the page navigates away.
      if (!leaving) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <AuthShell
      title="Welcome back,"
      description={
        <>
          좋은 차는 좋은 사람을 만듭니다.
          <br />
          다시 만나서 반가워요.
        </>
      }
    >
      {message && (
        <p ref={messageRef} className={styles.message} data-kind={message.kind} role="status" tabIndex={-1}>
          {message.text}
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset className={styles.form} disabled={busy}>
          <label htmlFor="username">아이디</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            maxLength={100}
            required
            placeholder="아이디를 입력해주세요"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <PasswordField
            id="password"
            label="비밀번호"
            value={password}
            onChange={setPassword}
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            autoComplete="current-password"
            placeholder="비밀번호를 입력해주세요"
          />
          <button type="submit" className={styles.submit}>
            {busy ? '로그인 중...' : '로그인'}
          </button>
        </fieldset>
      </form>
      <p className={styles.switch}>
        <a href="/password-reset">비밀번호를 잊으셨나요?</a>
      </p>
      <div className={styles.divider}>또는</div>
      <a className={styles.kakao} href="/api/auth/kakao/login">
        카카오로 로그인
      </a>
      <p className={styles.switch}>
        아직 회원이 아니신가요? <a href={withNext('/signup', next)}>회원가입 →</a>
      </p>
    </AuthShell>
  );
}
