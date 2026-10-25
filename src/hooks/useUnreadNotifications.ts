import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useNotificationsContext } from '@/contexts/NotificationsContext';

/** Unread count for badges; refreshes whenever the calling screen gains focus. */
export function useUnreadNotifications() {
  const { enabled, unread, refreshUnread } = useNotificationsContext();
  useFocusEffect(
    useCallback(() => {
      if (enabled) void refreshUnread();
      return undefined;
    }, [enabled, refreshUnread]),
  );
  return { enabled, unread };
}
