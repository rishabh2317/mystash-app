import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { titaniumRaisedShadow } from '@/src/theme/tokens';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { typeStyle } from '@/src/theme/typography';

export type ActionButtonVariant = 'primary' | 'secondary' | 'quiet' | 'filled' | 'outlinePrimary';
export type ActionButtonSize = 'default' | 'compact';

type Props = {
  label: string;
  onPress: () => void;
  /** `primary` is the one obvious action per group; `quiet` is text-weight. */
  variant?: ActionButtonVariant;
  /** `compact` is identity-row density; default geometry is unchanged. */
  size?: ActionButtonSize;
  /** Override corner radius. Compact defaults to pill; default size uses `md`. */
  radius?: 'md' | 'pill';
  leadingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Trailing affordance for actions that open a destination or sheet. */
  trailingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  pending?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
};

const ICON_SIZE = 16;
const COMPACT_ICON_SIZE = 14;
const COMPACT_HEIGHT = 32;

/** Canonical labelled action. Variant sets emphasis, never the geometry. */
export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  size = 'default',
  radius,
  leadingIcon,
  trailingIcon,
  pending = false,
  disabled = false,
  accessibilityLabel,
}: Props) {
  const { tokens } = useThemeMode();
  const [pressed, setPressed] = useState(false);
  const phase = resolveControlPhase({ pressed, pending, disabled });

  const isCompact = size === 'compact';
  const isOutlinePrimary = variant === 'outlinePrimary';
  const isPrimary = variant === 'primary';
  const isFilled = variant === 'filled';
  const isQuiet = variant === 'quiet';
  const iconSize = isCompact ? COMPACT_ICON_SIZE : ICON_SIZE;
  const fg = isOutlinePrimary
    ? tokens.color.primary
    : isFilled
      ? tokens.color.onPrimary
      : isPrimary
        ? tokens.color.onPrimarySurface
        : isQuiet
          ? tokens.color.primary
          : tokens.color.text;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || pending, busy: pending }}
      style={[
        styles.button,
        {
          paddingVertical: isQuiet ? tokens.space.xs : isCompact ? tokens.space.xxs + 2 : tokens.space.sm,
          paddingHorizontal: isCompact ? tokens.space.sm : tokens.space.md,
          minHeight: isCompact ? COMPACT_HEIGHT : undefined,
          width: isCompact || isFilled || isOutlinePrimary ? '100%' : undefined,
          borderRadius:
            radius === 'md'
              ? tokens.radius.md
              : isCompact
                ? tokens.radius.pill
                : tokens.radius.md,
          backgroundColor: isOutlinePrimary
            ? 'transparent'
            : isFilled
              ? tokens.color.primary
              : isPrimary
                ? tokens.color.primarySurface
                : isQuiet
                  ? 'transparent'
                  : tokens.color.surfaceSubtle,
          borderWidth: isOutlinePrimary ? 1 : isQuiet || isFilled ? 0 : StyleSheet.hairlineWidth,
          borderColor: isOutlinePrimary
            ? tokens.color.primary
            : isPrimary
              ? tokens.color.primarySurface
              : tokens.color.border,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
          ...(isFilled ? titaniumRaisedShadow(tokens) : null),
        },
      ]}
    >
      <View style={[styles.inner, { gap: isCompact ? tokens.space.xxs : tokens.space.xs }]}>
        {pending ? <ActivityIndicator size="small" color={fg} /> : null}
        {!pending && leadingIcon ? (
          <Ionicons name={leadingIcon} size={iconSize} color={fg} />
        ) : null}
        <Text
          style={[
            typeStyle(tokens, 'cta'),
            {
              color: fg,
              fontSize: isCompact ? tokens.fontSize.caption : tokens.fontSize.bodyStrong,
              lineHeight: isCompact ? tokens.lineHeight.caption : tokens.lineHeight.bodyStrong,
              fontFamily: tokens.fontFamily.semibold,
              letterSpacing: isCompact ? 0.2 : 0,
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      {trailingIcon ? (
        <Ionicons
          name={trailingIcon}
          size={iconSize}
          color={fg}
          style={[styles.trailing, { right: isCompact ? tokens.space.sm : tokens.space.md }]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailing: {
    position: 'absolute',
  },
});
