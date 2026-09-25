import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { typeStyle } from '@/src/theme/typography';

export type ActionButtonVariant = 'primary' | 'secondary' | 'quiet' | 'filled';

type Props = {
  label: string;
  onPress: () => void;
  /** `primary` is the one obvious action per group; `quiet` is text-weight. */
  variant?: ActionButtonVariant;
  leadingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Trailing affordance for actions that open a destination or sheet. */
  trailingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  pending?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
};

const ICON_SIZE = 16;

/** Canonical labelled action. Variant sets emphasis, never the geometry. */
export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  leadingIcon,
  trailingIcon,
  pending = false,
  disabled = false,
  accessibilityLabel,
}: Props) {
  const { tokens } = useThemeMode();
  const [pressed, setPressed] = useState(false);
  const phase = resolveControlPhase({ pressed, pending, disabled });

  const isPrimary = variant === 'primary';
  const isFilled = variant === 'filled';
  const isQuiet = variant === 'quiet';
  const fg = isFilled
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
          paddingVertical: isQuiet ? tokens.space.xs : tokens.space.sm,
          paddingHorizontal: tokens.space.md,
          borderRadius: tokens.radius.md,
          backgroundColor: isFilled
            ? tokens.color.primary
            : isPrimary
              ? tokens.color.primarySurface
              : isQuiet
                ? 'transparent'
                : tokens.color.surfaceSubtle,
          borderWidth: isQuiet || isFilled ? 0 : StyleSheet.hairlineWidth,
          borderColor: isPrimary ? tokens.color.primarySurface : tokens.color.border,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
        },
      ]}
    >
      <View style={[styles.inner, { gap: tokens.space.xs }]}>
        {pending ? <ActivityIndicator size="small" color={fg} /> : null}
        {!pending && leadingIcon ? (
          <Ionicons name={leadingIcon} size={ICON_SIZE} color={fg} />
        ) : null}
        <Text
          style={[
            typeStyle(tokens, 'cta'),
            {
              color: fg,
              fontSize: tokens.fontSize.bodyStrong,
              lineHeight: tokens.lineHeight.bodyStrong,
              fontFamily: tokens.fontFamily.semibold,
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
          size={ICON_SIZE}
          color={fg}
          style={[styles.trailing, { right: tokens.space.md }]}
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
