import React, { useCallback, useState } from 'react';
import { FailureState } from '@/components/status/FailureState';

/** Persistent inline action feedback, scoped to the account that saw the error. */
export function useFailureNotice(scope?: string | null) {
  const [failure, setFailure] = useState<{scope?: string | null; error: unknown} | null>(null);
  const showFailure = useCallback((error: unknown) => setFailure({scope,error}),[scope]);
  const clearFailure = useCallback(()=>setFailure(null),[]);
  return { showFailure, clearFailure, error: failure?.scope === scope ? failure?.error : null, notice: failure && failure.scope === scope ? <FailureState error={failure.error} variant="inline" actionLabel="Dismiss" onRetry={clearFailure} /> : null };
}
