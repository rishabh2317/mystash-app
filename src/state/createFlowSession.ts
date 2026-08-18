import { useEffect, useRef, useState } from 'react';

/**
 * Create-tab ingest session. Incremented only after a successful publish
 * or explicit abandon (Reject all) so form screens remount-equivalent reset
 * without wiping in-progress drafts on ordinary Back navigation.
 */
let sessionId = 0;
const listeners = new Set<(id: number) => void>();

export function getCreateFlowSessionId(): number {
  return sessionId;
}

function bumpSession(): number {
  sessionId += 1;
  listeners.forEach((fn) => {
    try {
      fn(sessionId);
    } catch {
      /* ignore */
    }
  });
  return sessionId;
}

/** Call after a successful publish. */
export function completeCreateFlow(): number {
  return bumpSession();
}

/** Call after explicit abandon (Reject all), not after Back. */
export function abandonCreateFlow(): number {
  return bumpSession();
}

export function subscribeCreateFlowSession(fn: (id: number) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useCreateFlowSessionId(): number {
  const [id, setId] = useState(sessionId);
  useEffect(() => subscribeCreateFlowSession(setId), []);
  return id;
}

/** Runs `onReset` when the Create session completes or is abandoned while this screen is mounted. */
export function useCreateFlowReset(onReset: () => void): void {
  const sessionIdNow = useCreateFlowSessionId();
  const prevRef = useRef(sessionIdNow);
  useEffect(() => {
    if (prevRef.current === sessionIdNow) return;
    prevRef.current = sessionIdNow;
    onReset();
  }, [sessionIdNow, onReset]);
}

export type CreateStackRouter = {
  canDismiss: () => boolean;
  dismissAll: () => void;
  replace: (href: '/' | '/(tabs)/create') => void;
};

/** Pop Review/Manual off the Create stack, then leave the tab so Back cannot restore them. */
export function exitCreateFlowAfterSuccess(router: CreateStackRouter): void {
  if (router.canDismiss()) {
    router.dismissAll();
  }
  router.replace('/');
}

/** Pop Review/Manual and stay on a fresh Create root. */
export function exitCreateFlowAfterAbandon(router: CreateStackRouter): void {
  if (router.canDismiss()) {
    router.dismissAll();
  } else {
    router.replace('/(tabs)/create');
  }
}
