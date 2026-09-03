import { Tabs, usePathname } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeMode } from '@/contexts/ThemeContext';
import { APP_TAB_ITEMS, isImmersiveTabRoute } from '@/src/ui/chrome';

/**
 * Canonical tab bar: Home · Search · Create · Profile.
 * One implementation; immersive routes only switch the surface variant.
 */
export function AppTabBar() {
  const { tokens } = useThemeMode();
  const immersive = isImmersiveTabRoute(usePathname());

  const screenOptions = useMemo(
    () => ({
      /** Immersive surfaces are already on the redesigned `primary`. */
      tabBarActiveTintColor: immersive ? tokens.color.primary : tokens.color.accent,
      tabBarInactiveTintColor: immersive
        ? tokens.immersive.tabInactive
        : tokens.color.tabInactive,
      tabBarStyle: immersive
        ? {
            position: 'absolute' as const,
            backgroundColor: tokens.immersive.surface,
            borderTopColor: tokens.immersive.divider,
            borderTopWidth: StyleSheet.hairlineWidth,
          }
        : {
            backgroundColor: tokens.color.tabBar,
            borderTopColor: tokens.color.border,
          },
      headerShown: false,
      tabBarButton: HapticTab,
    }),
    [
      immersive,
      tokens.color.accent,
      tokens.color.border,
      tokens.color.primary,
      tokens.color.tabBar,
      tokens.color.tabInactive,
      tokens.immersive,
    ],
  );

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name={APP_TAB_ITEMS[0].name}
        options={{
          title: APP_TAB_ITEMS[0].title,
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name={APP_TAB_ITEMS[1].name}
        options={{
          title: APP_TAB_ITEMS[1].title,
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="magnifyingglass" color={color} />,
        }}
      />
      <Tabs.Screen
        name={APP_TAB_ITEMS[2].name}
        options={{
          title: APP_TAB_ITEMS[2].title,
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="plus.circle.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name={APP_TAB_ITEMS[3].name}
        options={{
          title: APP_TAB_ITEMS[3].title,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="person.crop.circle.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
