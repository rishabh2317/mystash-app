import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { NOTIFICATIONS_HREF } from '@/src/notifications/linking';
import { NOTIFICATIONS_COPY } from '@/src/ui/notificationsInbox';
export function FindNotificationButton() {
  const router = useRouter(), notifications = useNotificationsContext(), { tokens } = useThemeMode();
  return <Pressable accessibilityRole="button" accessibilityLabel={NOTIFICATIONS_COPY.bellLabel(notifications.unread)}
    onPress={() => router.push(notifications.enabled ? NOTIFICATIONS_HREF : '/settings')}
    style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
    <Ionicons name="notifications-outline" size={23} color={tokens.color.text} />
    {notifications.unread.unread > 0 ? <View accessibilityElementsHidden style={{ position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.color.success }} /> : null}
  </Pressable>;
}
