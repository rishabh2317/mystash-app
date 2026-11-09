import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  /** Roomier card treatment for the single-scroll Creator Studio. */
  appearance?: 'default' | 'studio';
  title: string;
  body: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  badge?: string;
  selected?: boolean;
  pending?: boolean;
  disabled?: boolean;
  locked?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/**
 * Outlined action surface: choose/do something.
 * Hairline + radius.md + chevron — not an object card.
 */
export function ActionChoiceRow({
  appearance = 'default',
  title,
  body,
  icon,
  badge,
  selected = false,
  pending = false,
  disabled = false,
  locked = false,
  onPress,
  accessibilityLabel,
}: Props) {
  const { tokens } = useThemeMode();
  const studio = appearance === 'studio';
  const inert = disabled || locked || !onPress;
  const chrome = outlineCardChrome(tokens);

  return (
    <Pressable
      onPress={onPress}
      disabled={inert || pending}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inert, busy: pending, selected }}
      style={({ pressed }) => [
        styles.row,
        {
          ...chrome,
          shadowOpacity: 0,
          elevation: 0,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: tokens.radius.md,
          borderColor: selected ? tokens.color.primary : chrome.borderColor,
          backgroundColor: selected ? tokens.color.primarySurface : chrome.backgroundColor,
          paddingHorizontal: tokens.space.md,
          paddingVertical: tokens.space.sm,
          minHeight: studio ? 72 : 56,
          gap: tokens.space.sm,
          opacity: studio && locked ? 1 : controlOpacity(
            resolveControlPhase({ pressed, disabled: inert, pending }),
            tokens.motion.pressOpacity,
          ),
        },
      ]}
    >
      <View
        style={studio ? {
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens.radius.pill,
          backgroundColor: locked ? tokens.color.surfaceSubtle : tokens.color.primarySurface,
        } : undefined}
      >
        <Ionicons
          name={icon}
          size={studio ? 22 : 20}
          color={locked ? tokens.color.textMuted : studio ? tokens.color.onPrimarySurface : tokens.color.primary}
        />
      </View>
      <View style={[styles.copy, { gap: tokens.space.xxs }]}>
        <View style={[styles.titleRow, { gap: tokens.space.xs }, studio && { flexWrap: 'wrap' }]}>
          <Text
            style={[
              typeStyle(tokens, 'tileTitle'),
              { flex: 1 },
              studio && { minWidth: tokens.space.xxl * 2 },
              studio && { color: locked ? tokens.color.textMuted : tokens.color.text },
            ]}
            numberOfLines={studio ? undefined : 1}
          >
            {title}
          </Text>
          {badge ? (
            <Text
              style={[
                typeStyle(tokens, 'tileMeta'),
                { textTransform: 'uppercase', letterSpacing: 0.4 },
                studio && {
                  backgroundColor: tokens.color.surfaceSubtle,
                  borderRadius: tokens.radius.pill,
                  paddingHorizontal: tokens.space.xs,
                  paddingVertical: tokens.space.xxs,
                },
              ]}
            >
              {badge}
            </Text>
          ) : null}
        </View>
        <Text
          style={[
            typeStyle(tokens, 'bodyMuted'),
            { fontSize: tokens.fontSize.caption, lineHeight: tokens.lineHeight.caption },
          ]}
          numberOfLines={studio ? undefined : 2}
        >
          {body}
        </Text>
      </View>
      {pending ? (
        <ActivityIndicator size="small" color={tokens.color.primary} />
      ) : locked ? (
        <Ionicons name="lock-closed-outline" size={16} color={tokens.color.textMuted} />
      ) : (
        <Ionicons name="chevron-forward-outline" size={16} color={tokens.color.textMuted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
