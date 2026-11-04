import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { createFindCaptureController } from '@/src/state/findCaptureController';
import { submitUserImport } from '@/src/services/userImportApi';
import {captureCapabilities,enqueueFindUrl} from '@/src/services/captureRuntime';
import {observeFind} from '@/src/analytics/findMeasurement';
export function useFindCapture(observeOnFocus = true) {
  const { user } = useAuth(), owner = user?.id ?? null;
  const ref = useRef<ReturnType<typeof createFindCaptureController> | null>(null);
  if (!ref.current) ref.current = createFindCaptureController(async(text,account)=>{
    observeFind(account,'find.capture_submitted',{origin:'url'});
    return (await captureCapabilities()).urls?enqueueFindUrl(text,account):submitUserImport(text,account);});
  const controller = ref.current, state = useSyncExternalStore(controller.subscribe,controller.getState,controller.getState);
  useEffect(() => { controller.configure(owner); }, [controller,owner]);
  useFocusEffect(useCallback(() => {
    if (observeOnFocus) observeFind(owner,'find.capture_action_chosen',{origin:'url'});
    controller.configure(owner); controller.setActive(AppState.currentState === 'active');
    const app = AppState.addEventListener('change',value => controller.setActive(value === 'active'));
    return () => { app.remove(); controller.setActive(false); };
  },[controller,owner,observeOnFocus]));
  const visible = state.owner === owner;
  return { ...state,input: visible ? state.input : '',ack: visible ? state.ack : null,error: visible ? state.error : null,busy: visible && state.busy,
    setInput: controller.setInput,clearAck: controller.clearAck,submit: controller.submit };
}
