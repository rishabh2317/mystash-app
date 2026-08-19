import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeMode } from '@/contexts/ThemeContext';
import { APP_TAB_ITEMS } from '@/src/ui/chrome';

/**
 * Canonical tab bar: Home · Search · Create · Profile.
 * ThemeMode drives colors. HapticTab preserves existing press haptics.
 */
export function AppTabBar() {
  const { tokens } = useThemeMode();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tokens.color.accent,
        tabBarInactiveTintColor: tokens.color.tabInactive,
        tabBarStyle: {
          backgroundColor: tokens.color.tabBar,
          borderTopColor: tokens.color.border,
        },
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
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
