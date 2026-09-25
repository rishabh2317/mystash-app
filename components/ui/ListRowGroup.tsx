import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

export type ListRowSpec = {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string | null;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

type Props = {
  rows: ListRowSpec[];
};

const ICON_SIZE = 20;

/**
 * Grouped navigation rows inside one card (icon → copy → chevron).
 * Used for low-emphasis "explore" actions that must not compete with a CTA.
 * The icon is bare — a tile around it would nest a card inside a card.
 */
export function ListRowGroup({ rows }: Props) {
  const { tokens } = useThemeMode();
  if (rows.length === 0) return null;

  return (
    <View
      style={[
        styles.group,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.xl,
        },
      ]}
    >
      {rows.map((row, index) => (
        <Pressable
          key={row.id}
          onPress={row.onPress}
          disabled={row.disabled}
          accessibilityRole="button"
          accessibilityLabel={row.accessibilityLabel ?? row.title}
          accessibilityState={{ disabled: Boolean(row.disabled) }}
          style={({ pressed }) => [
            styles.row,
            {
              paddingHorizontal: tokens.space.md,
              paddingVertical: tokens.space.sm,
              gap: tokens.space.sm,
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: tokens.color.divider,
              opacity: controlOpacity(
                resolveControlPhase({ pressed, disabled: row.disabled }),
                tokens.motion.pressOpacity,
              ),
            },
          ]}
        >
          <Ionicons name={row.icon} size={ICON_SIZE} color={tokens.color.textMuted} />
          <View style={styles.copy}>
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.bodyStrong,
                lineHeight: tokens.lineHeight.bodyStrong,
                fontWeight: tokens.fontWeight.bold,
              }}
              numberOfLines={1}
            >
              {row.title}
            </Text>
            {row.subtitle ? (
              <Text
                style={{
                  color: tokens.color.textMuted,
                  fontSize: tokens.fontSize.caption,
                  lineHeight: tokens.lineHeight.caption,
                  marginTop: tokens.space.xxs / 2,
                }}
                numberOfLines={1}
              >
                {row.subtitle}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward-outline" size={16} color={tokens.color.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
});
