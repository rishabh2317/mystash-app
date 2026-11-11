import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeMode } from '@/contexts/ThemeContext';

/** Shared, independent media actions; never let a nested tap open card details. */
export function CardMediaActions({ title, onPlay, onRemove }: { title: string; onPlay?: () => void; onRemove?: () => void }) {
  const { tokens } = useThemeMode();
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {([{ action: onPlay, icon: 'play-outline', side: 'left', label: `Source video, ${title}` },
      { action: onRemove, icon: 'trash-outline', side: 'right', label: `Remove ${title} from My Stash` }] as const)
      .map(({ action, icon, side, label }) => action ? <Pressable key={side} accessibilityRole="button"
        accessibilityLabel={label} hitSlop={6} onPress={event => { event.stopPropagation(); action(); }}
        style={({ pressed }) => ({ position: 'absolute', bottom: tokens.space.xs, [side]: tokens.space.xs,
          width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.pill,
          borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.immersive.border,
          backgroundColor: tokens.immersive.controlStrong, opacity: pressed ? tokens.motion.pressOpacity : 1 })}>
        <Ionicons accessible={false} name={icon} size={15} color={tokens.immersive.icon} />
      </Pressable> : null)}
  </View>;
}
