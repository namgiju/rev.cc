'use client';

import {useEffect, useState} from 'react';
import type {SessionUser} from '../../lib/home-types';
import {ApiError, fetchSession, fetchUnreadCount, logout} from '../../lib/home-api';

// Session state shared by the community screens (list, post detail). Same
// fetchSession/fetchUnreadCount/logout calls the home page's header uses —
// see components/home/home-shell.tsx. `session` is undefined while the
// first check is still in flight, null when logged out.
export function useCommunitySession() {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [sessionError, setSessionError] = useState(false);
  const [unread, setUnread] = useState(0);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let ticket = 0;
    // Like app.js's focus/pageshow handlers: re-check when the tab regains
    // focus or comes back from the back/forward cache, so a login/logout in
    // another tab reaches this page. The same user keeps the same object, so
    // consumers keyed on `session` don't refetch on every focus.
    async function check(initial: boolean) {
      const current = ++ticket;
      try {
        const user = await fetchSession();
        if (cancelled || current !== ticket) return;
        setSession((prev) =>
          prev && user && prev.id === user.id && prev.username === user.username && prev.role === user.role ? prev : user,
        );
        if (!user) return setUnread(0);
        const count = await fetchUnreadCount().catch(() => null);
        if (count !== null && !cancelled && current === ticket) setUnread(count);
      } catch {
        // A failed re-check keeps the current state; only the first check
        // falls back to logged out.
        if (initial && !cancelled && current === ticket) {
          setSession(null);
          setSessionError(true);
        }
      }
    }
    const onFocus = () => void check(false);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check(false);
    };
    void check(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  async function handleLogout() {
    setLogoutBusy(true);
    try {
      await logout();
      setSession(null);
      setUnread(0);
    } catch (error) {
      if (!(error instanceof ApiError)) setSessionError(true);
      setSession(await fetchSession().catch(() => null));
    } finally {
      setLogoutBusy(false);
    }
  }

  // The header zeroes the badge after the notification panel marks all read.
  return {session, sessionError, unread, setUnread, logoutBusy, handleLogout};
}

export type CommunitySession = ReturnType<typeof useCommunitySession>;
