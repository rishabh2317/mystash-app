import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname } from 'expo-router';
import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { useAuth } from '@/contexts/AuthContext';
import { useCartOptional } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  APP_TAB_ICON_SIZE,
  APP_TAB_ITEMS,
  bagBadgeCount,
  formatBagBadgeText,
  isImmersiveTabRoute,
} from '@/src/ui/chrome';

/** Solid black Watch footer — always, regardless of theme mode. */
const WATCH_TAB_BAR_BG = '#000000';
/** Content row above safe-area — slightly taller for premium spacing. */
const TAB_BAR_CONTENT_HEIGHT = 56;

function StashTabIcon({ color }: { color: string }) {
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const cart = useCartOptional();
  const count = bagBadgeCount(Boolean(user), cart?.itemCount ?? 0);

  return (
    <View style={styles.stashIconWrap}>
      <Ionicons name={APP_TAB_ITEMS[3].icon} size={APP_TAB_ICON_SIZE} color={color} />
      {count > 0 ? (
        <View
          style={[
            styles.stashBadge,
            {
              backgroundColor: tokens.color.danger,
              borderRadius: tokens.radius.pill,
            },
          ]}
        >
          <Text style={[styles.stashBadgeText, { color: tokens.color.dangerOn }]}>
            {formatBagBadgeText(count)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Canonical tab bar: Watch · Search · Create · Stash · Profile.
 * Watch (feed) keeps a solid black footer; every other screen matches TopBar
 * chrome (`canvasSoft`) so scaffold + header + footer read as one surface.
 */
export function AppTabBar() {
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const pathname = usePathname();
  const watchFeed = isImmersiveTabRoute(pathname);
  const bottomInset = Math.max(insets.bottom, tokens.space.xs);
  /** Same chrome token as page TopBar — not a separate white/grey strip. */
  const pageChrome = tokens.color.canvasSoft;

  const screenOptions = useMemo(
    () => ({
      tabBarActiveTintColor: watchFeed ? tokens.immersive.text : tokens.color.text,
      tabBarInactiveTintColor: watchFeed
        ? tokens.immersive.tabInactive
        : tokens.color.tabInactive,
      tabBarLabelStyle: {
        fontSize: tokens.fontSize.micro,
        lineHeight: tokens.lineHeight.micro,
        fontFamily: tokens.fontFamily.medium,
        fontWeight: tokens.fontWeight.regular,
        marginTop: 2,
      },
      tabBarIconStyle: {
        marginTop: 2,
      },
      tabBarStyle: {
        position: watchFeed ? ('absolute' as const) : ('relative' as const),
        backgroundColor: watchFeed ? WATCH_TAB_BAR_BG : pageChrome,
        borderTopWidth: 0,
        borderTopColor: 'transparent',
        elevation: 0,
        shadowOpacity: 0,
        shadowColor: 'transparent',
        height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
        paddingTop: tokens.space.xs,
        paddingBottom: bottomInset,
        ...Platform.select({
          ios: { shadowOffset: { width: 0, height: 0 } },
          default: {},
        }),
      },
      headerShown: false,
      tabBarButton: HapticTab,
    }),
    [
      bottomInset,
      pageChrome,
      tokens.color.tabInactive,
      tokens.color.text,
      tokens.fontFamily.medium,
      tokens.fontSize.micro,
      tokens.fontWeight.regular,
      tokens.immersive.tabInactive,
      tokens.immersive.text,
      tokens.lineHeight.micro,
      tokens.space.xs,
      watchFeed,
    ],
  );

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name={APP_TAB_ITEMS[0].name}
        options={{
          title: APP_TAB_ITEMS[0].title,
          tabBarIcon: ({ color }) => (
            <Ionicons name={APP_TAB_ITEMS[0].icon} size={APP_TAB_ICON_SIZE} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name={APP_TAB_ITEMS[1].name}
        options={{
          title: APP_TAB_ITEMS[1].title,
          tabBarIcon: ({ color }) => (
            <Ionicons name={APP_TAB_ITEMS[1].icon} size={APP_TAB_ICON_SIZE} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name={APP_TAB_ITEMS[2].name}
        options={{
          title: APP_TAB_ITEMS[2].title,
          tabBarIcon: ({ color }) => (
            <Ionicons name={APP_TAB_ITEMS[2].icon} size={APP_TAB_ICON_SIZE} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name={APP_TAB_ITEMS[3].name}
        options={{
          title: APP_TAB_ITEMS[3].title,
          tabBarIcon: ({ color }) => <StashTabIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name={APP_TAB_ITEMS[4].name}
        options={{
          title: APP_TAB_ITEMS[4].title,
          tabBarIcon: ({ color }) => (
            <Ionicons name={APP_TAB_ITEMS[4].icon} size={APP_TAB_ICON_SIZE} color={color} />
          ),
        }}
      />
      {/* Nested detail stack — keeps bottom nav; not a tab destination. */}
      <Tabs.Screen name="collection" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  stashIconWrap: {
    width: APP_TAB_ICON_SIZE + 8,
    height: APP_TAB_ICON_SIZE + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stashBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  stashBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
});
