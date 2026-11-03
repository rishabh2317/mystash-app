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
export function useFindHistory(filter: FindViewFilter) {
  const { user } = useAuth(), owner = user?.id ?? null, cart = useCartOptional();
  const membership = useRef<string | null>(null);
  const ref = useRef<ReturnType<typeof createFindHistoryController> | null>(null);
  if (!ref.current) ref.current = createFindHistoryController(findApi, { schedule: (fn, ms) => setTimeout(fn, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) });
  const controller = ref.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => { controller.configure(owner, filter); }, [controller, owner, filter]);
  useFocusEffect(useCallback(() => {
    controller.configure(owner, filter);
    controller.setActive(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', value => controller.setActive(value === 'active'));
    const pending = subscribePendingShares(() => { if (AppState.currentState === 'active') void controller.refresh(); });
    return () => { app.remove(); pending(); controller.setActive(false); };
  }, [controller, owner, filter]));
  useFocusEffect(useCallback(()=>{observeFind(owner,'find.opened');},[owner]));
  useEffect(() => {
    if (state.owner !== owner || !owner || !state.loaded) { membership.current = null; return; }
    const signature = JSON.stringify([owner,state.counts?.completed,state.counts?.processing,state.counts?.attention,
      state.items.map(item => [item.id,item.outcome.savedProducts,item.outcome.savedPlaces])]);
    if (membership.current !== signature) { membership.current = signature; void cart?.refresh(); }
  },[cart,owner,state.owner,state.loaded,state.counts,state.items]);
  const visible = state.owner === owner && state.filter === filter;
  return { ...state, items: visible ? state.items : [], counts: visible ? state.counts : null, loaded: visible && state.loaded, cursor: visible ? state.cursor : null, error: visible ? state.error : null, moreError: visible ? state.moreError : null,
    refresh: () => controller.refresh(), loadMore: () => controller.loadMore() };
}
