'use client';

import {createContext, useContext, useEffect, useState, type FormEvent, type ReactNode} from 'react';
import Link from 'next/link';
import {ApiError, errorMessage, garageApi, type SessionUser} from '../../lib/garage-api';
import styles from './garage.module.css';

type Session = {user: SessionUser | null; loading: boolean; error: string; refresh: () => Promise<void>};
const SessionContext = createContext<Session | null>(null);
export function useGarageSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('GarageSessionProvider is required');
  return value;
}
export function GarageSessionProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setLoading(true); setError('');
    try {setUser(await garageApi<SessionUser>('/api/auth/me'));}
    catch (err) {setUser(null); if (!(err instanceof ApiError && err.status === 401)) setError(errorMessage(err));}
    finally {setLoading(false);}
  }
  useEffect(() => {void refresh();}, []);
  async function logout() {
    setBusy(true); setError('');
    try {await garageApi('/api/auth/logout', {method:'POST', body:{}}); setUser(null);}
    catch (err) {setError(errorMessage(err));}
    finally {setBusy(false);}
  }
  return <SessionContext.Provider value={{user, loading, error, refresh}}><div className={styles.shell}>
    <header className={styles.header}><Link href="/" className={styles.brand}>REV.CC</Link><nav className={styles.navigation} aria-label="차고 메뉴"><Link href="/">커뮤니티</Link><Link href="/garage">My Garage</Link></nav><div className={styles.account}>{user ? <><span>{user.username} 님</span><button className={styles.secondary} disabled={busy} onClick={logout}>로그아웃</button></> : <Link className={styles.secondary} href="/garage">로그인</Link>}</div></header>
    {error && <p role="alert" className={styles.error}>{error} <button onClick={refresh} className={styles.secondary}>다시 확인</button></p>}
    {children}
  </div></SessionContext.Provider>;
}
export function RequireGarageSession({children}: {children: ReactNode}) {
  const session = useGarageSession();
  if (session.loading) return <p className={styles.loading} role="status">로그인 상태를 확인하고 있습니다.</p>;
  if (!session.user) return <GarageLogin />;
  return <>{children}</>;
}
function GarageLogin() {
  const {refresh} = useGarageSession();
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    const form = new FormData(event.currentTarget);
    const credentials = {username:String(form.get('username') || '').trim(), password:String(form.get('password') || '')};
    try {
      if (signup) await garageApi('/api/auth/signup', {method:'POST', body:credentials});
      await garageApi('/api/auth/login', {method:'POST', body:credentials});
      await refresh();
    } catch (err) {setError(errorMessage(err));}
    finally {setBusy(false);}
  }
  return <section className={styles.login}><p className={styles.eyebrow}>MY GARAGE</p><h1>{signup ? '회원가입' : '내 차고에 로그인'}</h1><p className={styles.subtitle}>내 차량을 등록하고, 나만의 차량 프로필을 만들어보세요.</p>
    <form className={styles.form} onSubmit={submit}><label className={styles.field}>아이디<input name="username" required maxLength={100} autoComplete="username" /></label><label className={styles.field}>비밀번호<input name="password" type="password" required maxLength={72} autoComplete={signup ? 'new-password' : 'current-password'} /></label>
      {error && <p className={styles.error} role="alert">{error}</p>}<button className={styles.primary} disabled={busy}>{busy ? '처리 중…' : signup ? '가입하고 시작하기' : '로그인'}</button><button type="button" className={styles.toggle} disabled={busy} onClick={() => {setSignup(!signup);setError('');}}>{signup ? '이미 계정이 있나요? 로그인' : '처음 오셨나요? 회원가입'}</button>
    </form>
  </section>;
}
