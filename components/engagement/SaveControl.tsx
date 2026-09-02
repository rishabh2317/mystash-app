import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  isSaved: boolean;
  pending?: boolean;
  disabled?: boolean;
  /** Icon-only control (matches ShareControl sizing). */
  iconOnly?: boolean;
  /** @deprecated Colors come from ThemeMode tokens. Kept so call sites stay stable. */
  isLight?: boolean;
  onPress: () => void;
};

/** Emit-only Save control — parents own auth + Engagement API. */
export function SaveControl({
  isSaved,
  pending = false,
  disabled = false,
  iconOnly = false,
  onPress,
}: Props) {
  const { tokens } = useThemeMode();
  const [pressed, setPressed] = React.useState(false);
  const phase = resolveControlPhase({
    disabled,
    pending,
    success: isSaved,
    pressed,
  });
  const color = tokens.color.text;
  const label = isSaved ? 'Saved' : 'Save';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || pending, busy: pending, selected: isSaved }}
      hitSlop={hitSlopToMinTarget(40)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        iconOnly ? styles.iconBtn : styles.btn,
        {
          backgroundColor: tokens.color.overlay,
          borderRadius: iconOnly ? 20 : tokens.radius.md,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={color} size={iconOnly ? 'small' : undefined} />
      ) : (
        <>
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={iconOnly ? 20 : 18}
            color={iconOnly ? tokens.color.icon : color}
          />
          {iconOnly ? null : (
            <Text style={[styles.label, { color, fontSize: tokens.fontSize.bodyStrong }]}>{label}</Text>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '700',
  },
});
