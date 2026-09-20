import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';

export type ProfileContentTab<Id extends string = string> = {
  id: Id;
  label: string;
};

type Props<Id extends string> = {
  tabs: readonly ProfileContentTab<Id>[];
  active: Id;
  onChange: (id: Id) => void;
};

/** Collections / Products (public) and Collections / Saved (personal). */
export function ProfileContentTabs<Id extends string>({ tabs, active, onChange }: Props<Id>) {
  const { tokens } = useThemeMode();

  return (
    <View
      style={[
        styles.tabs,
        {
          borderBottomColor: tokens.color.divider,
          gap: tokens.space.lg,
        },
      ]}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            style={[
              styles.tab,
              {
                borderBottomWidth: tokens.stroke.strong,
                borderBottomColor: selected ? tokens.color.primary : 'transparent',
              },
            ]}
          >
            <Text
              style={{
                color: selected ? tokens.color.text : tokens.color.textMuted,
                fontSize: tokens.fontSize.bodyStrong,
                fontWeight: selected ? tokens.fontWeight.bold : tokens.fontWeight.semibold,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 2,
    minHeight: 44,
    justifyContent: 'center',
  },
});
