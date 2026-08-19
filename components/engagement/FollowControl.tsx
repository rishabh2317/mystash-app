import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  isFollowing: boolean;
  pending?: boolean;
  disabled?: boolean;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  labelOverride?: string;
  onPress: () => void;
};

export function FollowControl({
  isFollowing,
  pending = false,
  disabled = false,
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
  const label = labelOverride ?? (isFollowing ? 'Following' : 'Follow');
  const onAccent = !isFollowing && !labelOverride;
  const spinnerColor = onAccent ? tokens.color.textOnAccent : tokens.color.text;
  const labelColor = onAccent ? tokens.color.textOnAccent : tokens.color.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || pending, busy: pending, selected: isFollowing }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.btn,
        {
          borderRadius: tokens.radius.md,
          borderWidth: tokens.stroke.hairline,
          backgroundColor: onAccent ? tokens.color.text : tokens.color.overlay,
          borderColor: onAccent ? 'transparent' : tokens.color.border,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <Text style={[styles.label, { color: labelColor, fontSize: tokens.fontSize.body }]}>
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
  label: {
    fontWeight: '700',
  },
});
