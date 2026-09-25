import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import type { ImportShare } from '@/src/services/importShareMap';
import { fetchImportShares } from '@/src/services/userImportApi';
import { bagHasInFlightShares } from '@/src/ui/bag';

export const IMPORT_SHARE_POLL_MS = 4000;

export function sharesBecameReady(previous: ImportShare[], next: ImportShare[]): boolean {
  const prevById = new Map(previous.map((share) => [share.importId, share.state]));
  return next.some((share) => prevById.get(share.importId) === 'looking' && share.state === 'ready');
}

type Options = {
  /** Called when a share transitions looking → ready (e.g. refresh Bag). */
  onBecameReady?: () => void;
  enabled?: boolean;
};

/**
 * Polls GET /imports while focused and any share is looking.
 * Shared by Bag and Search Activity so cadence stays consistent.
 */
export function useImportSharesPoll(options: Options = {}) {
  const { user } = useAuth();
  const enabled = options.enabled !== false;
  const onBecameReady = options.onBecameReady;
  const [shares, setShares] = useState<ImportShare[]>([]);
  const [loaded, setLoaded] = useState(false);
  const sharesRef = useRef<ImportShare[]>([]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!user || !enabled) {
      sharesRef.current = [];
      setShares([]);
      setLoaded(false);
      return false;
    }
    try {
      const next = await fetchImportShares();
      if (sharesBecameReady(sharesRef.current, next)) {
        onBecameReady?.();
      }
      sharesRef.current = next;
      setShares(next);
      setLoaded(true);
      return bagHasInFlightShares(next);
    } catch {
      setLoaded(true);
      return false;
    }
  }, [enabled, onBecameReady, user]);

  useFocusEffect(
    useCallback(() => {
      if (!user || !enabled) {
        sharesRef.current = [];
        setShares([]);
        setLoaded(false);
        return undefined;
      }
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const poll = async () => {
        const looking = await refresh();
        if (cancelled || !looking) return;
        timer = setTimeout(() => {
          void poll();
        }, IMPORT_SHARE_POLL_MS);
      };
      void poll();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [enabled, refresh, user]),
  );

  return { shares, loaded, refresh };
}
