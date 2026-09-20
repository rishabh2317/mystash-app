import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  title: string;
  /** Quieter supporting line under the title. */
  subtitle?: string | null;
  /** Trailing text action (e.g. "View all"). */
  actionLabel?: string;
  onActionPress?: () => void;
  actionAccessibilityLabel?: string;
};

/**
 * Canonical section heading: strong title, quiet subtitle, one optional
 * trailing action. Sections never style their own heading.
 */
export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onActionPress,
  actionAccessibilityLabel,
}: Props) {
  const { tokens } = useThemeMode();
  const showAction = Boolean(actionLabel && onActionPress);

  return (
    <View style={[styles.row, { gap: tokens.space.sm }]}>
      <View style={styles.copy}>
        <Text
          style={{
            color: tokens.color.text,
            // A step above product titles (`title`) so the page's structure
            // reads before its contents.
            fontSize: tokens.fontSize.section,
            lineHeight: tokens.lineHeight.section,
            fontWeight: tokens.fontWeight.bold,
            letterSpacing: -0.3,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.label,
              lineHeight: tokens.lineHeight.label,
              marginTop: tokens.space.xxs / 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showAction ? (
        <Pressable
          onPress={onActionPress}
          accessibilityRole="button"
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          hitSlop={hitSlopToMinTarget(24)}
          style={({ pressed }) => ({
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          })}
        >
          <Text
            style={{
              color: tokens.color.primary,
              fontSize: tokens.fontSize.label,
              lineHeight: tokens.lineHeight.label,
              fontWeight: tokens.fontWeight.bold,
            }}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
});
