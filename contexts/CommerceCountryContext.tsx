import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  getCachedCommerceCountry,
  getCommerceCountry,
  onCommerceCountryAppForeground,
  promptCommerceLocationOnboarding,
  setManualCommerceCountry,
  enableAutomaticCommerceLocation,
  type CommerceCountrySnapshot,
} from '@/src/services/commerceCountry';

type CommerceCountryContextValue = {
  snapshot: CommerceCountrySnapshot | null;
  refresh: () => Promise<CommerceCountrySnapshot>;
  setManualCountry: (country: string) => Promise<CommerceCountrySnapshot>;
  enableAutomaticLocation: () => Promise<CommerceCountrySnapshot>;
};

const CommerceCountryContext = createContext<CommerceCountryContextValue | null>(null);

export function CommerceCountryProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [snapshot, setSnapshot] = useState<CommerceCountrySnapshot | null>(
    getCachedCommerceCountry(),
  );

  const refresh = useCallback(async () => {
    const next = await getCommerceCountry();
    setSnapshot(next);
    return next;
  }, []);

  const setManualCountry = useCallback(async (country: string) => {
    const next = await setManualCommerceCountry(country);
    setSnapshot(next);
    return next;
  }, []);

  const enableAutomaticLocation = useCallback(async () => {
    const next = await enableAutomaticCommerceLocation();
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { snapshot: next } = await promptCommerceLocationOnboarding();
        if (!cancelled) setSnapshot(next);
      } catch {
        if (!cancelled) {
          const next = await getCommerceCountry().catch(() => null);
          if (next) setSnapshot(next);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  useEffect(() => {
    if (!user) return;
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active') return;
      void onCommerceCountryAppForeground()
        .then((next) => {
          if (next) setSnapshot(next);
        })
        .catch(() => undefined);
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [user]);

  const value = useMemo(
    () => ({ snapshot, refresh, setManualCountry, enableAutomaticLocation }),
    [snapshot, refresh, setManualCountry, enableAutomaticLocation],
  );

  return (
    <CommerceCountryContext.Provider value={value}>{children}</CommerceCountryContext.Provider>
  );
}

export function useCommerceCountry(): CommerceCountryContextValue {
  const ctx = useContext(CommerceCountryContext);
  if (!ctx) {
    throw new Error('useCommerceCountry must be used within CommerceCountryProvider');
  }
  return ctx;
}
