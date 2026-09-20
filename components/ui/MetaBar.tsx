import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';

export type MetaBarItem = {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
};

type Props = {
  items: MetaBarItem[];
  accessibilityLabel?: string;
};

const ICON_SIZE = 13;

/**
 * Quiet metadata strip (count / views / date). Filled but borderless: metadata
 * should read as supporting evidence, never as a card or a CTA.
 */
export function MetaBar({ items, accessibilityLabel }: Props) {
  const { tokens } = useThemeMode();
  if (items.length === 0) return null;

  const metaText = {
    color: tokens.color.textMuted,
    fontSize: tokens.fontSize.caption,
    lineHeight: tokens.lineHeight.caption,
    fontWeight: tokens.fontWeight.semibold,
  };

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? items.map((item) => item.label).join(', ')}
      style={[
        styles.bar,
        {
          backgroundColor: tokens.color.surfaceSubtle,
          borderRadius: tokens.radius.md,
          paddingHorizontal: tokens.space.sm,
          paddingVertical: tokens.space.xs,
          gap: tokens.space.xs,
        },
      ]}
    >
      {items.map((item, index) => (
        <View key={item.id} style={[styles.group, { gap: tokens.space.xs }]}>
          {index > 0 ? <Text style={metaText}>·</Text> : null}
          <View style={[styles.item, { gap: tokens.space.xxs }]}>
            <Ionicons name={item.icon} size={ICON_SIZE} color={tokens.color.textMuted} />
            <Text style={metaText} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexWrap: 'wrap',
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
