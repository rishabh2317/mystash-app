import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** OS reduced-motion preference for Home thumbnail fades. */
export function usePrefersReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: boolean) => {
      if (!cancelled) setReduceMotion(next);
    };
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(apply)
      .catch(() => apply(false));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', apply);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}
