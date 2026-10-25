import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { createImportSharePoller, IMPORT_SHARE_POLL_MS } from '@/src/hooks/importSharePoll';
import type { ImportShare } from '@/src/services/importShareMap';
import { fetchImportShares } from '@/src/services/userImportApi';
import { bagHasInFlightShares } from '@/src/ui/bag';

export { IMPORT_SHARE_POLL_MS } from '@/src/hooks/importSharePoll';

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
 * A refresh that discovers a new looking share arms the same timer, so a
 * submit on an already-open Search screen keeps updating until the share ends.
 */
export function useImportSharesPoll(options: Options = {}) {
  const { user } = useAuth();
  const enabled = options.enabled !== false;
  const onBecameReady = options.onBecameReady;
  const onBecameReadyRef = useRef(onBecameReady);
  onBecameReadyRef.current = onBecameReady;
  const [shares, setShares] = useState<ImportShare[]>([]);
  const [loaded, setLoaded] = useState(false);
  const sharesRef = useRef<ImportShare[]>([]);
  const pollerRef = useRef<ReturnType<typeof createImportSharePoller> | null>(null);
  if (!pollerRef.current) {
    pollerRef.current = createImportSharePoller({
      intervalMs: IMPORT_SHARE_POLL_MS,
      schedule: (callback, ms) => setTimeout(callback, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
  }
  const poller = pollerRef.current;

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!user || !enabled) {
      poller.blur();
      sharesRef.current = [];
      setShares([]);
      setLoaded(false);
      return false;
    }
    const gen = poller.beginFetch();
    try {
      const next = await fetchImportShares();
      const inFlight = bagHasInFlightShares(next);
      if (poller.finishFetch(gen, inFlight) === 'ignore') {
        return bagHasInFlightShares(sharesRef.current);
      }
      if (sharesBecameReady(sharesRef.current, next)) {
        onBecameReadyRef.current?.();
      }
      sharesRef.current = next;
      setShares(next);
      setLoaded(true);
      return inFlight;
    } catch {
      setLoaded(true);
      const inFlight = bagHasInFlightShares(sharesRef.current);
      if (poller.finishFetch(gen, inFlight) === 'ignore') return inFlight;
      return inFlight;
    }
  }, [enabled, poller, user]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  poller.setOnTick(() => {
    void refreshRef.current();
  });

  useFocusEffect(
    useCallback(() => {
      if (!user || !enabled) {
        poller.blur();
        sharesRef.current = [];
        setShares([]);
        setLoaded(false);
        return undefined;
      }
      poller.focus();
      void refresh();
      return () => {
        poller.blur();
      };
    }, [enabled, poller, refresh, user]),
  );

  return { shares, loaded, refresh };
}
