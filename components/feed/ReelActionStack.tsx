import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SaveControl } from '@/components/engagement/SaveControl';
import { ShareControl } from '@/components/engagement/ShareControl';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  FEED_MIN_HIT_TARGET,
  hitSlopToMinTarget,
} from '@/src/ui/feedA11y';
import type { BottomDockSave, BottomDockShare } from '@/components/BottomDock';

type Props = {
  onVolumeToggle?: () => void;
  isMuted?: boolean;
  save?: BottomDockSave | null;
  share?: BottomDockShare | null;
  /** Distance from stage bottom to align with BottomDock title-row band. */
  bottomOffset: number;
};

/**
 * Floating Sound → Save → Share rail over the media stage.
 * Sibling of BottomDock — not part of the lower mask.
 */
export function ReelActionStack({
  onVolumeToggle,
  isMuted,
  save,
  share,
  bottomOffset,
}: Props) {
  const { tokens } = useThemeMode();
  if (!onVolumeToggle && !save && !share) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          right: tokens.space.md,
          bottom: Math.max(bottomOffset, tokens.space.xl),
          gap: tokens.space.xs,
        },
      ]}
    >
      {onVolumeToggle ? (
        <Pressable
          onPress={onVolumeToggle}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
          hitSlop={hitSlopToMinTarget(FEED_MIN_HIT_TARGET)}
          style={[
            styles.volumeBtn,
            {
              backgroundColor: tokens.color.overlay,
              borderRadius: tokens.radius.pill,
            },
          ]}
        >
          <Ionicons
            name={isMuted ? 'volume-mute' : 'volume-high'}
            size={18}
            color={tokens.color.icon}
          />
        </Pressable>
      ) : null}
      {save ? (
        <SaveControl
          isSaved={save.isSaved}
          pending={save.pending}
          iconOnly
          onPress={save.onPress}
        />
      ) : null}
      {share ? (
        <ShareControl onPress={share.onPress} accessibilityLabel={share.accessibilityLabel} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 20,
    alignItems: 'center',
  },
  volumeBtn: {
    width: FEED_MIN_HIT_TARGET,
    height: FEED_MIN_HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
