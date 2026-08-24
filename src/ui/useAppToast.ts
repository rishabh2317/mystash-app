import React, { useCallback, useEffect, useRef } from 'react';

import { AppToast } from '@/components/chrome/AppToast';
import { useFeedbackSlot } from '@/components/chrome/FeedbackAnchor';
import {
  TOAST_DEFAULT_TTL_MS,
  type ToastSpec,
} from '@/src/ui/contracts';

/**
 * App-level toast via FeedbackHost (UX-B toast contract).
 * Prefer toast / inline errors; Alert only for destructive confirms.
 */
export function useAppToast() {
  const { setSlot } = useFeedbackSlot();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSlot(null);
  }, [setSlot]);

  const showToast = useCallback(
    (spec: ToastSpec) => {
      const ttl = spec.ttlMs ?? TOAST_DEFAULT_TTL_MS;
      setSlot(
        React.createElement(AppToast, {
          tone: spec.tone,
          title: spec.title,
          onDismiss: clearToast,
        }),
      );
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(clearToast, ttl);
    },
    [setSlot, clearToast],
  );

  useEffect(() => () => clearToast(), [clearToast]);

  return { showToast, clearToast };
}
