import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import { recordNotificationOpened } from '@/src/services/notificationsApi';
import { parsePushData, pushTapTarget, RecentKeys } from './pushPolicy';
import {
  clearPresentedNotifications,
  ensureAndroidChannels,
  pushSupported,
  replayPendingUnlink,
  syncPushRegistration,
} from './pushRegistration';

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const foregroundShown = new RecentKeys(DEDUPE_WINDOW_MS);
const tapsHandled = new RecentKeys(DEDUPE_WINDOW_MS);

/** Renders nothing. Mounted once in the root layout, inside the auth and notifications providers. */
export function PushNotificationsHost() {
  const supported = pushSupported();
  const { user, loading } = useAuth();
  const { refreshUnread } = useNotificationsContext();
  const router = useRouter();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const userId = user?.id ?? null;
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const previousUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!supported) return undefined;
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        // Expo can hand a notification to APNs/FCM more than once; show each notification id once.
        const data = parsePushData(notification.request.content.data);
        const show = data ? foregroundShown.firstSeen(data.nid, Date.now()) : true;
        return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: false, shouldSetBadge: false };
      },
    });
    void ensureAndroidChannels().catch(() => undefined);
    void replayPendingUnlink();
    // Signed-out devices also retry an offline sign-out's unlink when they come back.
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void replayPendingUnlink();
    });
    const received = Notifications.addNotificationReceivedListener(() => void refreshUnread());
    return () => {
      appState.remove();
      received.remove();
    };
  }, [supported, refreshUnread]);

  // A different signed-in user must never see the previous user's notifications or badge.
  useEffect(() => {
    if (!supported || loading) return;
    if (previousUser.current !== undefined && previousUser.current !== userId) {
      void clearPresentedNotifications();
    }
    previousUser.current = userId;
  }, [supported, loading, userId]);

  useEffect(() => {
    if (!supported || !userId) return undefined;
    void syncPushRegistration(userId);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncPushRegistration(userId);
    });
    const tokenChange = Notifications.addPushTokenListener(() => void syncPushRegistration(userId, { force: true }));
    return () => {
      appState.remove();
      tokenChange.remove();
    };
  }, [supported, userId]);

  // Taps: warm start via the listener, cold start via the last response, each handled once.
  useEffect(() => {
    if (!supported || loading || !navigationReady) return undefined;
    const handle = (response: Notifications.NotificationResponse) => {
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (!tapsHandled.firstSeen(key, Date.now())) return;
      const data = parsePushData(response.notification.request.content.data);
      const signedIn = Boolean(userIdRef.current);
      if (signedIn && data) {
        void recordNotificationOpened(data.nid, data.did ? { deliveryId: data.did } : undefined)
          .catch(() => undefined)
          .finally(() => void refreshUnread());
      }
      router.push(pushTapTarget(data, signedIn) as Href);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handle(response);
      })
      .catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [supported, loading, navigationReady, router, refreshUnread]);

  return null;
}
