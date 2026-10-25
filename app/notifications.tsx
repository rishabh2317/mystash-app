import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { NotificationRowSkeleton } from '@/components/status/NotificationRowSkeleton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { NOTIFICATIONS_HREF, resolveNotificationHref } from '@/src/notifications/linking';
import {
  listNotifications,
  markNotificationsRead,
  markNotificationsSeen,
  recordNotificationOpened,
  type NotificationItem,
} from '@/src/services/notificationsApi';
import { typeStyle } from '@/src/theme/typography';
import { resolveListLoadState } from '@/src/ui/contentLoadState';
import {
  NOTIFICATIONS_COPY,
  NOTIFICATIONS_PAGE_SIZE,
  formatNotificationTime,
  markItemsReadLocally,
  mergeNotificationPages,
  notificationAvatarUrl,
  notificationIcon,
  sectionNotifications,
} from '@/src/ui/notificationsInbox';

type LoadState = 'idle' | 'loading' | 'refreshing' | 'more' | 'error';

export default function NotificationsScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { user, loading: authLoading } = useAuth();
  const { enabled, unread, setUnread, refreshUnread } = useNotificationsContext();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [headCursor, setHeadCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const generation = useRef(0);
  const userId = user?.id ?? null;

  const loadFirst = useCallback(
    async (mode: 'loading' | 'refreshing') => {
      if (!enabled || !userId) return;
      const gen = ++generation.current;
      setState(mode);
      try {
        const page = await listNotifications({ limit: NOTIFICATIONS_PAGE_SIZE });
        if (gen !== generation.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setHeadCursor(page.headCursor);
        setState('idle');
        if (page.headCursor && page.items.some((i) => !i.seen)) {
          void markNotificationsSeen(page.headCursor).catch(() => undefined);
        }
      } catch {
        if (gen === generation.current) setState('error');
      }
    },
    [enabled, userId],
  );

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setHeadCursor(null);
    void loadFirst('loading');
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || state !== 'idle') return;
    const gen = generation.current;
    setState('more');
    try {
      const page = await listNotifications({ cursor: nextCursor, limit: NOTIFICATIONS_PAGE_SIZE });
      if (gen !== generation.current) return;
      setItems((prev) => mergeNotificationPages(prev, page.items));
      setNextCursor(page.nextCursor);
      setState('idle');
    } catch {
      if (gen === generation.current) setState('idle');
    }
  }, [nextCursor, state]);

  const onOpen = useCallback(
    (item: NotificationItem) => {
      if (!item.read) {
        setItems((prev) => markItemsReadLocally(prev, new Set([item.id])));
        setUnread({ unread: Math.max(0, unread.unread - 1), capped: false });
      }
      void recordNotificationOpened(item.id)
        .catch(() => undefined)
        .finally(() => void refreshUnread());
      const href = resolveNotificationHref(item.deepLink);
      if (href !== NOTIFICATIONS_HREF) router.push(href as Href);
    },
    [refreshUnread, router, setUnread, unread.unread],
  );

  const onMarkAllRead = useCallback(async () => {
    setItems((prev) => markItemsReadLocally(prev, 'all'));
    setUnread({ unread: 0, capped: false });
    try {
      await markNotificationsRead({ all: true, before: headCursor });
    } finally {
      void refreshUnread();
    }
  }, [headCursor, refreshUnread, setUnread]);

  const hasUnread = items.some((i) => !i.read);
  const sections = sectionNotifications(items);
  const loadState = resolveListLoadState({
    itemCount: items.length,
    fetching: state === 'loading' || authLoading,
    fetchingMore: state === 'more',
    error: state === 'error',
  });

  const renderBody = () => {
    if (!enabled) return <CenteredMessage body={NOTIFICATIONS_COPY.unavailable} />;
    if (!user && !authLoading) return <CenteredMessage body={NOTIFICATIONS_COPY.signIn} />;
    if (loadState === 'skeleton') {
      return (
        <View style={{ paddingTop: tokens.space.sm }}>
          <NotificationRowSkeleton />
          <NotificationRowSkeleton />
          <NotificationRowSkeleton />
          <NotificationRowSkeleton />
          <NotificationRowSkeleton />
          <NotificationRowSkeleton />
        </View>
      );
    }
    if (state === 'error' && items.length === 0) {
      return (
        <CenteredMessage
          title={NOTIFICATIONS_COPY.errorTitle}
          actionLabel={NOTIFICATIONS_COPY.retry}
          onAction={() => void loadFirst('loading')}
        />
      );
    }
    return (
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: tokens.space.xxl, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={state === 'refreshing'}
            onRefresh={() => void loadFirst('refreshing')}
            tintColor={tokens.color.primary}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        renderSectionHeader={({ section }) => (
          <Text
            style={[
              typeStyle(tokens, 'tileMeta'),
              { paddingHorizontal: tokens.space.lg, paddingTop: tokens.space.md, paddingBottom: tokens.space.xs },
            ]}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <NotificationRow item={item} onPress={() => onOpen(item)} />}
        ListEmptyComponent={
          <CenteredMessage title={NOTIFICATIONS_COPY.emptyTitle} body={NOTIFICATIONS_COPY.emptyBody} />
        }
        ListFooterComponent={
          loadState === 'contentPaginating' ? (
            <View style={{ marginVertical: tokens.space.sm }}>
              <NotificationRowSkeleton />
              <NotificationRowSkeleton />
            </View>
          ) : null
        }
      />
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
      <TopBar
        mode="page"
        title={NOTIFICATIONS_COPY.title}
        showBack
        showBag={false}
        trailing={
          hasUnread ? (
            <Pressable
              onPress={() => void onMarkAllRead()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={NOTIFICATIONS_COPY.markAllRead}
            >
              <Text style={[typeStyle(tokens, 'link'), { color: tokens.color.primary }]}>
                {NOTIFICATIONS_COPY.markAllRead}
              </Text>
            </Pressable>
          ) : undefined
        }
      />
      {renderBody()}
    </View>
  );
}

function NotificationRow({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  const { tokens } = useThemeMode();
  const avatar = notificationAvatarUrl(item);
  const time = formatNotificationTime(item.updatedAt);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}. ${item.body}. ${time}`}
      style={({ pressed }) => [
        styles.row,
        {
          paddingHorizontal: tokens.space.lg,
          paddingVertical: tokens.space.sm,
          gap: tokens.space.sm,
          backgroundColor: item.read ? 'transparent' : tokens.color.primarySurface,
          opacity: pressed ? tokens.motion.pressOpacity : 1,
        },
      ]}
    >
      {avatar ? (
        <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.iconWell, { backgroundColor: tokens.color.surfaceSubtle }]}>
          <Ionicons name={notificationIcon(item.type)} size={20} color={tokens.color.icon} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={3}>
          {item.body}
        </Text>
      </View>
      <View style={styles.meta}>
        <Text style={typeStyle(tokens, 'tileMeta')}>{time}</Text>
        {!item.read ? (
          <View style={[styles.dot, { backgroundColor: tokens.color.primary }]} accessibilityElementsHidden />
        ) : null}
      </View>
    </Pressable>
  );
}

function CenteredMessage(props: { title?: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  const { tokens } = useThemeMode();
  return (
    <View style={[styles.centered, { gap: tokens.space.sm, paddingHorizontal: tokens.space.xl }]}>
      {props.title ? (
        <Text style={[typeStyle(tokens, 'identityTitle'), { textAlign: 'center' }]}>{props.title}</Text>
      ) : null}
      {props.body ? (
        <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>{props.body}</Text>
      ) : null}
      {props.actionLabel && props.onAction ? (
        <Pressable onPress={props.onAction} accessibilityRole="button" hitSlop={8}>
          <Text style={[typeStyle(tokens, 'link'), { color: tokens.color.primary }]}>{props.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  iconWell: { alignItems: 'center', justifyContent: 'center' },
  meta: { alignItems: 'flex-end', gap: 6, minWidth: 28 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
