import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

const PLAY_TARGET = 72;

type Props = {
  visible: boolean;
  onPress: () => void;
};

/** Native play affordance over embed WebViews (tap toggles playback). */
export function FeedPlayOverlay({ visible, onPress }: Props) {
  const { tokens } = useThemeMode();
  if (!visible) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Play or pause video"
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: tokens.immersive.scrim,
            borderRadius: tokens.radius.pill,
            opacity: controlOpacity(
              resolveControlPhase({ pressed }),
              tokens.motion.pressOpacity,
            ),
          },
        ]}
      >
        <Ionicons name="play" size={44} color={tokens.immersive.iconMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 6,
  },
  btn: {
    width: PLAY_TARGET,
    height: PLAY_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
