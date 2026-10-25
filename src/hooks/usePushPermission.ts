import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import type { OsPermission } from '@/src/notifications/pushPolicy';
import {
  markExplainerShown,
  pushSupported,
  readPushPermission,
  requestPushPermission,
  syncPushRegistration,
} from '@/src/notifications/pushRegistration';

/**
 * Settings row state. Asking from here is an explicit user action, so it is allowed; after a
 * denial the row only deep-links to the OS settings.
 */
export function usePushPermission(): {
  supported: boolean;
  permission: OsPermission | null;
  onPress: () => void;
} {
  const supported = pushSupported();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<{ permission: OsPermission; canAskAgain: boolean } | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) return;
    setState(await readPushPermission().catch(() => null));
  }, [supported]);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const onPress = useCallback(() => {
    void (async () => {
      if (!state || !userId) return;
      if (state.permission === 'undetermined' && state.canAskAgain) {
        await markExplainerShown();
        const granted = await requestPushPermission();
        if (granted === 'granted' || granted === 'provisional') await syncPushRegistration(userId, { force: true });
        await refresh();
        return;
      }
      await Linking.openSettings();
    })().catch(() => undefined);
  }, [state, userId, refresh]);

  return { supported, permission: state?.permission ?? null, onPress };
}
