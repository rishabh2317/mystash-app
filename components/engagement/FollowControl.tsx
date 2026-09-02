import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  isFollowing: boolean;
  pending?: boolean;
  disabled?: boolean;
  /** Compact chip for inline placement beside a name. */
  size?: 'default' | 'compact';
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  labelOverride?: string;
  onPress: () => void;
};

export function FollowControl({
  isFollowing,
  pending = false,
  disabled = false,
  size = 'default',
  labelOverride,
  onPress,
}: Props) {
  const { tokens } = useThemeMode();
  const [pressed, setPressed] = React.useState(false);
  const phase = resolveControlPhase({
    disabled,
    pending,
    success: isFollowing,
    pressed,
  });
  const compact = size === 'compact';
  const hit = compact ? hitSlopToMinTarget(28) : hitSlopToMinTarget(40);
  const label = labelOverride ?? (isFollowing ? 'Following' : 'Follow');
  /** Compact (Home identity) stays secondary; Collection keeps the filled CTA. */
  const onAccent = !isFollowing && !labelOverride && !compact;
  const spinnerColor = onAccent ? tokens.color.textOnAccent : tokens.color.text;
  const labelColor = onAccent ? tokens.color.textOnAccent : tokens.color.text;
  const labelSize = compact ? tokens.fontSize.caption : tokens.fontSize.body;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || pending, busy: pending, selected: isFollowing }}
      hitSlop={hit}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        compact ? styles.compactBtn : styles.btn,
        {
          borderRadius: compact ? tokens.radius.sm : tokens.radius.md,
          borderWidth: tokens.stroke.hairline,
          backgroundColor: onAccent ? tokens.color.text : tokens.color.overlay,
          borderColor: onAccent ? 'transparent' : tokens.color.border,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={spinnerColor} size={compact ? 'small' : undefined} />
      ) : (
        <Text style={[styles.label, { color: labelColor, fontSize: labelSize }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 110,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  compactBtn: {
    minWidth: 0,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  label: {
    fontWeight: '700',
  },
});
