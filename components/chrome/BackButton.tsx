import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { TopBarMode } from '@/src/ui/chrome';

type Props = {
  mode?: TopBarMode;
  accessibilityLabel?: string;
  onPress?: () => void;
};

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
      style={[
        styles.btn,
        {
          backgroundColor: immersive ? tokens.immersive.controlStrong : tokens.color.overlay,
          borderRadius: tokens.radius.pill,
        },
      ]}
    >
      <Ionicons
        name="chevron-back"
        size={22}
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
