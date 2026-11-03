import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { createFindCaptureController } from '@/src/state/findCaptureController';
import { submitUserImport } from '@/src/services/userImportApi';
export function useFindCapture() {
  const { user } = useAuth(), owner = user?.id ?? null;
  const ref = useRef<ReturnType<typeof createFindCaptureController> | null>(null);
  if (!ref.current) ref.current = createFindCaptureController(submitUserImport);
  const controller = ref.current, state = useSyncExternalStore(controller.subscribe,controller.getState,controller.getState);
  useEffect(() => { controller.configure(owner); }, [controller,owner]);
  useFocusEffect(useCallback(() => {
    controller.configure(owner); controller.setActive(AppState.currentState === 'active');
    const app = AppState.addEventListener('change',value => controller.setActive(value === 'active'));
    return () => { app.remove(); controller.setActive(false); };
  },[controller,owner]));
  const visible = state.owner === owner;
  return { ...state,input: visible ? state.input : '',ack: visible ? state.ack : null,error: visible ? state.error : null,busy: visible && state.busy,
    setInput: controller.setInput,clearAck: controller.clearAck,submit: controller.submit };
}
