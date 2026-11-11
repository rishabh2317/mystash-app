import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { findApi } from '../services/findApi';
import { subscribePendingShares } from '../services/nativeShare';
import { subscribeFindReceived } from '../services/findActivityEvents';
import { createFindActivityController } from '../state/findActivityController';

export function useFindActivity(owner: string | null) {
  const ref = useRef<ReturnType<typeof createFindActivityController> | null>(null);
  if (!ref.current) ref.current = createFindActivityController(findApi, { schedule: (fn, ms) => setTimeout(fn, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) });
  const controller = ref.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => { controller.configure(owner); }, [controller, owner]);
  useFocusEffect(useCallback(() => {
    controller.configure(owner);
    const receipts = subscribeFindReceived(controller.received);
    const pending = subscribePendingShares(() => { void controller.refresh(); });
    controller.setActive(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', value => controller.setActive(value === 'active'));
    return () => { receipts(); pending(); app.remove(); controller.setActive(false); };
  }, [controller, owner]));
  return { item: state.owner === owner ? state.item : null, refresh: controller.refresh };
}
