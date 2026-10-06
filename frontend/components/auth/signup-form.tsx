'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useSearchParams} from 'next/navigation';
import {checkUsername, signup} from '../../lib/auth-api';
import {safeNext, withNext} from '../../lib/auth-next';
import {ApiError} from '../../lib/home-api';
import AuthShell from './auth-shell';
import PasswordField from './password-field';
import styles from './auth.module.css';

type Message = {text: string; kind: 'error' | 'success'} | null;
type CheckStatus = {text: string; kind: 'success' | 'error'} | null;

// /signup (assignment-frontend/auth/index.html + js/auth.js, signup mode).
// Same flow: username duplicate check (GET /api/auth/check-username) →
// POST /api/auth/signup → /login?joined=1 (no auto-login). `terms`/`privacy`
// are UI-only confirmations, never sent to the server.
export default function SignupForm() {
  const searchParams = useSearchParams();
  const [next, setNext] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [shown, setShown] = useState(false);
  const [confirmShown, setConfirmShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<Message>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const checkButtonRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // Mirrors auth.js's checkedUsername/checkGeneration closure state: refs so
  // a late (stale) check-username response can tell it no longer applies.
  const usernameLiveRef = useRef('');
  const checkedUsernameRef = useRef<string | null>(null);
  const checkGenerationRef = useRef(0);
  const [checking, setChecking] = useState(false);
  const [checkStatus, setCheckStatus] = useState<CheckStatus>(null);

  useEffect(() => {
    setNext(safeNext(searchParams.get('next'), window.location.origin));
  }, [searchParams]);

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  function invalidateUsername() {
    checkedUsernameRef.current = null;
    checkGenerationRef.current++;
    setCheckStatus(null);
  }

  useEffect(() => {
    const onPageHide = () => {
      setPassword('');
      setConfirm('');
      setShown(false);
      setConfirmShown(false);
    };
    const onPageShow = () => {
      busyRef.current = false;
      setBusy(false);
      invalidateUsername();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  function onUsernameChange(value: string) {
    usernameLiveRef.current = value;
    setUsername(value);
    invalidateUsername();
  }

  function fail(text: string) {
    setMessage({text, kind: 'error'});
  }

  async function runCheck() {
    if (checking) return;
    const value = usernameLiveRef.current;
    invalidateUsername();
    if (!value.trim() || value.length > 100) {
      setCheckStatus({text: '아이디는 공백만 입력할 수 없으며 최대 100자입니다.', kind: 'error'});
      return;
    }
    const generation = checkGenerationRef.current;
    setChecking(true);
    try {
      const data = await checkUsername(value);
      if (generation !== checkGenerationRef.current || usernameLiveRef.current !== value) return;
      checkedUsernameRef.current = data.available ? value : null;
      setCheckStatus(
        data.available
          ? {text: '사용 가능한 아이디입니다.', kind: 'success'}
          : {text: '이미 사용 중인 아이디입니다.', kind: 'error'},
      );
    } catch (error) {
      if (generation !== checkGenerationRef.current) return;
      const text =
        error instanceof ApiError && error.status === 429
          ? '요청이 많습니다. 잠시 후 다시 확인해주세요.'
          : '중복확인에 실패했습니다. 다시 시도해주세요.';
      setCheckStatus({text, kind: 'error'});
    } finally {
      if (generation === checkGenerationRef.current) setChecking(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    if (checkedUsernameRef.current !== username) {
      fail('아이디 중복확인을 해주세요.');
      checkButtonRef.current?.focus();
      return;
    }
    if (password !== confirm) {
      fail('비밀번호 확인이 일치하지 않습니다.');
      confirmRef.current?.focus();
      return;
    }
    if (password.length < 8) {
      fail('비밀번호는 8자 이상으로 입력해주세요.');
      passwordRef.current?.focus();
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      fail('비밀번호는 UTF-8 72바이트 이하로 입력해주세요.');
      return;
    }
    if (!username.trim() || !password.trim()) return fail('아이디와 비밀번호를 입력해주세요.');
    if (!event.currentTarget.reportValidity()) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    let leaving = false;
    try {
      await signup(username, password, email.trim());
      leaving = true;
      const target = next === null ? '/login?joined=1' : `${withNext('/login', next)}&joined=1`;
      window.location.replace(target);
    } catch (error) {
      if (!(error instanceof ApiError)) fail('서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.');
      else if (error.status === 409) {
        invalidateUsername();
        fail('이미 사용 중인 아이디 또는 이메일입니다. 아이디 중복확인을 다시 해주세요.');
      } else if (error.status === 400)
        fail('입력 내용을 확인해주세요. 아이디는 최대 100자, 비밀번호는 8자 이상 UTF-8 72바이트까지 가능합니다.');
      else fail('요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setPassword('');
      setConfirm('');
      setShown(false);
      setConfirmShown(false);
      if (!leaving) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <AuthShell title="Join REV.CC" description="차로 연결되는 일상을 시작하세요.">
      {message && (
        <p ref={messageRef} className={styles.message} data-kind={message.kind} role="status" tabIndex={-1}>
          {message.text}
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset className={styles.form} disabled={busy}>
          <label htmlFor="username">아이디</label>
          <div className={styles.usernameField}>
            <input
              id="username"
              name="username"
              autoComplete="username"
              maxLength={100}
              required
              placeholder="아이디를 입력해주세요"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="username-status"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
            />
            <button
              ref={checkButtonRef}
              type="button"
              className={styles.secondary}
              disabled={checking}
              onClick={runCheck}
            >
              중복확인
            </button>
          </div>
          {checkStatus && (
            <p id="username-status" className={styles.fieldHelp} data-kind={checkStatus.kind} role="status">
              {checkStatus.text}
            </p>
          )}
          <p className={styles.fieldHelp}>아이디는 커뮤니티에서 표시 이름으로도 사용됩니다. 최대 100자.</p>

          <label htmlFor="email">이메일 (선택)</label>
          <input
            id="email"
            type="email"
            maxLength={254}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className={styles.fieldHelp}>비밀번호 재설정에 사용할 이메일을 정확히 입력해주세요.</p>

          <PasswordField
            id="password"
            label="비밀번호"
            value={password}
            onChange={setPassword}
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            autoComplete="new-password"
            placeholder="비밀번호를 입력해주세요"
            inputRef={passwordRef}
          />
          <p className={styles.fieldHelp}>8자 이상, 영문·숫자 기준 최대 72자입니다. 한글 등은 UTF-8 72바이트까지 사용할 수 있습니다.</p>

          <PasswordField
            id="password-confirm"
            label="비밀번호 확인"
            value={confirm}
            onChange={setConfirm}
            shown={confirmShown}
            onToggle={() => setConfirmShown((s) => !s)}
            autoComplete="new-password"
            placeholder="비밀번호를 다시 입력해주세요"
            inputRef={confirmRef}
          />

          <fieldset className={styles.consents}>
            <legend className={styles.srOnly}>가입 동의</legend>
            <label>
              <input type="checkbox" required checked={terms} onChange={(e) => setTerms(e.target.checked)} /> 이용약관
              동의 <span>(필수)</span>
            </label>
            <label>
              <input type="checkbox" required checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />{' '}
              개인정보 처리방침 동의 <span>(필수)</span>
            </label>
            <p className={styles.fieldHelp}>
              현재 개발 중인 프로젝트로 정식 약관과 개인정보 처리방침 전문은 준비 중입니다. 동의 항목은 가입 화면의
              확인 절차이며 별도로 저장되지 않습니다.
            </p>
          </fieldset>

          <button type="submit" className={styles.submit}>
            {busy ? '가입 중...' : '회원가입'}
          </button>
        </fieldset>
      </form>
      <p className={styles.switch}>
        <a href="/password-reset">비밀번호를 잊으셨나요?</a>
      </p>
      <div className={styles.divider}>또는</div>
      <a className={styles.kakao} href="/api/auth/kakao/login">
        카카오로 시작하기
      </a>
      <p className={styles.switch}>
        이미 회원이신가요? <a href={withNext('/login', next)}>로그인 →</a>
      </p>
    </AuthShell>
  );
}
