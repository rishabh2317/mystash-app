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
  const color = tokens.color.text;

  return (
    <Pressable
      onPress={onPress ?? (() => router.back())}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.btn,
        { backgroundColor: mode === 'immersive' ? 'rgba(0,0,0,0.45)' : tokens.color.overlay },
      ]}
    >
      <Ionicons name="chevron-back" size={22} color={mode === 'immersive' ? '#F8FAFC' : color} />
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
