import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeMode } from '@/contexts/ThemeContext';

export function DiscoverCreatorsToggle({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const { tokens } = useThemeMode();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide creator suggestions' : 'Show creator suggestions'}
      accessibilityState={{ expanded }}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={({ pressed }) => [styles.discoverToggle, {
        borderRadius: tokens.radius.md,
        borderColor: tokens.color.border,
        backgroundColor: tokens.color.surfaceSubtle,
        opacity: pressed ? tokens.motion.pressOpacity : 1,
      }]}
    >
      <Ionicons name="person-add-outline" size={18} color={tokens.color.text} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  discoverToggle: {
    width: 32,
    height: 32,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
