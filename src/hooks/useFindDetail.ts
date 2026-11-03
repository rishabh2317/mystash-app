import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useCartOptional } from '@/contexts/CartContext';
import { findApi } from '@/src/services/findApi';
import { createFindDetailController } from '@/src/state/findDetailController';
export function useFindDetail(id: string) {
  const { user } = useAuth(), owner = user?.id ?? null, cart = useCartOptional();
  const changed = useRef(() => { void cart?.refresh(); }); changed.current = () => { void cart?.refresh(); };
  const ref = useRef<ReturnType<typeof createFindDetailController> | null>(null);
  if (!ref.current) ref.current = createFindDetailController(findApi, { schedule: (fn, ms) => setTimeout(fn, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, () => changed.current());
  const controller = ref.current, state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => { controller.configure(owner,id); }, [controller,owner,id]);
  useFocusEffect(useCallback(() => {
    controller.configure(owner,id); controller.setActive(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', value => controller.setActive(value === 'active'));
    return () => { app.remove(); controller.setActive(false); };
  }, [controller,owner,id]));
  const visible = state.owner === owner && state.id === id;
  return { ...state, data: visible ? state.data : null, loaded: visible && state.loaded, error: visible ? state.error : null, actionError: visible ? state.actionError : null, pending: visible ? state.pending : null,
    refresh: () => controller.refresh(), run: controller.run };
}
