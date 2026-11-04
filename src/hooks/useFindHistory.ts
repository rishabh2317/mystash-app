import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCartOptional } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { findApi } from '@/src/services/findApi';
import { subscribePendingShares } from '@/src/services/nativeShare';
import { createFindHistoryController } from '@/src/state/findHistoryController';
import type { FindViewFilter } from '@/src/ui/find';
import {observeFind} from '@/src/analytics/findMeasurement';
import type { FindSourceFilter } from '@/src/services/findClient';
export function useFindHistory(filter: FindViewFilter, options: { supplemental?: boolean; enabled?: boolean; source?: FindSourceFilter } = {}) {
  const { user } = useAuth(), owner = user?.id ?? null, cart = useCartOptional();
  const enabled = options.enabled !== false, supplemental = options.supplemental === true, source = options.source ?? 'all';
  const membership = useRef<string | null>(null);
  const ref = useRef<ReturnType<typeof createFindHistoryController> | null>(null);
  if (!ref.current) ref.current = createFindHistoryController(findApi, { schedule: (fn, ms) => setTimeout(fn, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) });
  const controller = ref.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => { controller.configure(owner, filter, source); }, [controller, owner, filter, source]);
  useFocusEffect(useCallback(() => {
    controller.configure(owner, filter, source);
    controller.setActive(enabled && AppState.currentState === 'active');
    const app = AppState.addEventListener('change', value => controller.setActive(enabled && value === 'active'));
    const pending = subscribePendingShares(() => { if (AppState.currentState === 'active') void controller.refresh(); });
    return () => { app.remove(); pending(); controller.setActive(false); };
  }, [controller, owner, filter, source, enabled]));
  useFocusEffect(useCallback(()=>{if(!supplemental)observeFind(owner,'find.opened');},[owner,supplemental]));
  useEffect(() => {
    if (supplemental || state.owner !== owner || !owner || !state.loaded) { membership.current = null; return; }
    const signature = JSON.stringify([owner,state.counts?.completed,state.counts?.processing,state.counts?.attention,
      state.items.map(item => [item.id,item.outcome.savedProducts,item.outcome.savedPlaces])]);
    if (membership.current !== signature) { membership.current = signature; void cart?.refresh(); }
  },[cart,owner,state.owner,state.loaded,state.counts,state.items,supplemental]);
  const visible = state.owner === owner && state.filter === filter && state.source === source;
  return { ...state, filter, source, items: visible ? state.items : [], counts: visible ? state.counts : null, loaded: visible && state.loaded, cursor: visible ? state.cursor : null, error: visible ? state.error : null, moreError: visible ? state.moreError : null,
    refresh: () => controller.refresh(), loadMore: () => controller.loadMore() };
}
