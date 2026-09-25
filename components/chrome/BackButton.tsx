import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { TopBarMode } from '@/src/ui/chrome';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  mode?: TopBarMode;
  accessibilityLabel?: string;
  onPress?: () => void;
};

/** Page chrome: bare icon. Immersive feed keeps a soft control for contrast on media. */
export function BackButton({
  mode = 'page',
  accessibilityLabel = 'Back',
  onPress,
}: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const immersive = mode === 'immersive';

  return (
    <Pressable
      onPress={
        onPress ??
        (() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }
          router.replace('/');
        })
      }
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlopToMinTarget(40)}
      style={({ pressed }) => [
        styles.btn,
        immersive
          ? {
              backgroundColor: tokens.immersive.controlStrong,
              borderRadius: tokens.radius.pill,
            }
          : null,
        {
          opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
        },
      ]}
    >
      <Ionicons
        name="chevron-back-outline"
        size={24}
        color={immersive ? tokens.immersive.icon : tokens.color.icon}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
