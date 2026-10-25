import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { notificationsEnabled } from '@/src/notifications/linking';
import { fetchUnreadCount, type UnreadCount } from '@/src/services/notificationsApi';
import { UNREAD_POLL_MS } from '@/src/ui/notificationsInbox';

type NotificationsContextValue = {
  enabled: boolean;
  unread: UnreadCount;
  refreshUnread: () => Promise<void>;
  /** Optimistic local update after mark-read; the next poll reconciles. */
  setUnread: (next: UnreadCount) => void;
};

const ZERO: UnreadCount = { unread: 0, capped: false };

const NotificationsContext = createContext<NotificationsContextValue>({
  enabled: false,
  unread: ZERO,
  refreshUnread: async () => {},
  setUnread: () => {},
});

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const enabled = notificationsEnabled();
  const userId = user?.id ?? null;
  const [unread, setUnreadState] = useState<UnreadCount>(ZERO);
  const generation = useRef(0);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const refreshUnread = useCallback(async () => {
    if (!enabled || !userId) return;
    const gen = generation.current;
    try {
      const next = await fetchUnreadCount();
      if (gen === generation.current) setUnreadState(next);
    } catch {
      /* keep the last known count; the next poll retries */
    }
  }, [enabled, userId]);

  // A different signed-in user must never see the previous user's count.
  useEffect(() => {
    generation.current += 1;
    setUnreadState(ZERO);
    if (enabled && userId) void refreshUnread();
  }, [enabled, userId, refreshUnread]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => void refreshUnread(), UNREAD_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (appState.current === 'active') start();
    const sub = AppState.addEventListener('change', (next) => {
      const wasActive = appState.current === 'active';
      appState.current = next;
      if (next === 'active') {
        if (!wasActive) void refreshUnread();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [enabled, userId, refreshUnread]);

  const setUnread = useCallback((next: UnreadCount) => setUnreadState(next), []);

  const value = useMemo(
    () => ({ enabled, unread: enabled && userId ? unread : ZERO, refreshUnread, setUnread }),
    [enabled, userId, unread, refreshUnread, setUnread],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsContext(): NotificationsContextValue {
  return useContext(NotificationsContext);
}
