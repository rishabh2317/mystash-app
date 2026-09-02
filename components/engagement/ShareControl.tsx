import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  disabled?: boolean;
  pending?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
};

/** Emit-only Share control — parents own native Share.share orchestration. */
export function ShareControl({
  disabled = false,
  pending = false,
  accessibilityLabel = 'Share',
  onPress,
}: Props) {
  const { tokens } = useThemeMode();
  const [pressed, setPressed] = React.useState(false);
  const phase = resolveControlPhase({ disabled, pending, pressed });

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || pending, busy: pending }}
      hitSlop={hitSlopToMinTarget(40)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.btn,
        {
          backgroundColor: tokens.color.overlay,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
        },
      ]}
    >
      <Ionicons name="paper-plane-outline" size={20} color={tokens.color.icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
