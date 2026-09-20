import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  label: string;
  onPress: () => void;
  /** On-media treatment (Home / reel overlays). */
  immersive?: boolean;
  accessibilityLabel?: string;
};

/**
 * Compact play chip for another existing reel/collection.
 * Secondary to identity and captions — not a primary CTA.
 */
export function ContentPlayChip({
  label,
  onPress,
  immersive = false,
  accessibilityLabel,
}: Props) {
  const { tokens } = useThemeMode();
  const text = immersive ? tokens.immersive.textMuted : tokens.color.textMuted;
  const icon = immersive ? tokens.immersive.iconMuted : tokens.color.icon;
  const surface = immersive ? tokens.immersive.control : tokens.color.surfaceSubtle;
  const iconSize = tokens.fontSize.micro;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Play ${label}`}
      hitSlop={hitSlopToMinTarget(tokens.lineHeight.micro + tokens.space.xxs * 2)}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: surface,
          borderRadius: tokens.radius.pill,
          paddingHorizontal: tokens.space.xs,
          paddingVertical: tokens.space.xxs,
          gap: tokens.space.xxs,
          opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
        },
      ]}
    >
      <Ionicons name="play" size={iconSize} color={icon} />
      <Text
        style={{
          flexShrink: 1,
          color: text,
          fontSize: tokens.fontSize.micro,
          lineHeight: tokens.lineHeight.micro,
          fontWeight: tokens.fontWeight.semibold,
        }}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '72%',
  },
});
