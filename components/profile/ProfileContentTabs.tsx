import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';

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
                borderBottomWidth: StyleSheet.hairlineWidth * 2,
                borderBottomColor: selected ? tokens.color.primary : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                typeStyle(tokens, selected ? 'tileTitle' : 'tileMeta'),
                { color: selected ? tokens.color.text : tokens.color.textMuted },
              ]}
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
    minHeight: 40,
    justifyContent: 'center',
  },
});
