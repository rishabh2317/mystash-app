import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { FEED_MIN_HIT_TARGET, hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  isLiked: boolean;
  pending?: boolean;
  disabled?: boolean;
  immersive?: boolean;
  onPress: () => void;
};

/** Emit-only Reel Like control; parent owns auth, API, and optimistic state. */
export function LikeControl({
  isLiked,
  pending = false,
  disabled = false,
  immersive = false,
  onPress,
}: Props) {
  const { tokens } = useThemeMode();
  const [pressed, setPressed] = React.useState(false);
  const phase = resolveControlPhase({
    disabled,
    pending,
    success: isLiked,
    pressed,
  });
  const color = immersive ? tokens.immersive.icon : tokens.color.icon;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={isLiked ? 'Unlike Reel' : 'Like Reel'}
      accessibilityState={{ disabled: disabled || pending, busy: pending, selected: isLiked }}
      hitSlop={hitSlopToMinTarget(40)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.button,
        {
          backgroundColor: immersive ? tokens.immersive.control : tokens.color.overlay,
          borderRadius: tokens.radius.pill,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Ionicons
          name={isLiked ? 'heart' : 'heart-outline'}
          size={22}
          color={color}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: FEED_MIN_HIT_TARGET,
    height: FEED_MIN_HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
