import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  isLight: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
};

/** Emit-only Share control — parents own native Share.share orchestration. */
export function ShareControl({
  isLight,
  disabled = false,
  accessibilityLabel = 'Share',
  onPress,
}: Props) {
  const color = isLight ? '#1A1A1B' : '#F8FAFC';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)',
          opacity: pressed || disabled ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="share-outline" size={20} color={color} />
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
