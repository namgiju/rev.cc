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
    (async () => {
      try {
        const user = await fetchSession();
        if (cancelled) return;
        setSession(user);
        if (user) setUnread(await fetchUnreadCount());
      } catch {
        if (!cancelled) {
          setSession(null);
          setSessionError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
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
