import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  getCachedCommerceCountry,
  setCommerceCountryOwner,
  getCommerceCountryOwner,
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
  const owner=user?.id??null;
  setCommerceCountryOwner(owner);
  const [scoped,setScoped]=useState<{owner:string|null;snapshot:CommerceCountrySnapshot|null}>(()=>({owner,snapshot:getCachedCommerceCountry()}));
  const snapshot=scoped.owner===owner?scoped.snapshot:null;
  const setSnapshot=useCallback((next:CommerceCountrySnapshot|null)=>{
    if(getCommerceCountryOwner()===owner)setScoped({owner,snapshot:next});
  },[owner]);

  const refresh = useCallback(async () => {
    const next = await getCommerceCountry();
    setSnapshot(next);
    return next;
  }, [setSnapshot]);

  const setManualCountry = useCallback(async (country: string) => {
    if(getCommerceCountryOwner()!==owner)throw new Error('Account changed. Try again.');
    const next = await setManualCommerceCountry(country);
    setSnapshot(next);
    return next;
  }, [setSnapshot,owner]);

  const enableAutomaticLocation = useCallback(async () => {
    if(getCommerceCountryOwner()!==owner)throw new Error('Account changed. Try again.');
    const next = await enableAutomaticCommerceLocation();
    setSnapshot(next);
    return next;
  }, [setSnapshot,owner]);

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
  }, [user, loading,setSnapshot]);

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
  }, [user,setSnapshot]);

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
