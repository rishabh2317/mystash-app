import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SaveControl } from '@/components/engagement/SaveControl';
import { ShareControl } from '@/components/engagement/ShareControl';
import { useThemeMode } from '@/contexts/ThemeContext';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { formatEngagementCount } from '@/src/ui/formatEngagementCount';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';
import type { FeedReelSave, FeedReelShare } from '@/src/ui/feedReelTypes';

type Props = {
  onVolumeToggle?: () => void;
  isMuted?: boolean;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  /** Distance from stage bottom to the bottom of the action rail. */
  bottomOffset: number;
};

function CountLabel({ value }: { value: number }) {
  const { tokens } = useThemeMode();
  return (
    <Text
      style={[
        styles.count,
        {
          color: tokens.immersive.text,
          fontSize: tokens.fontSize.micro,
          fontWeight: tokens.fontWeight.bold,
        },
      ]}
      numberOfLines={1}
    >
      {formatEngagementCount(value)}
    </Text>
  );
}

/**
 * Floating action rail (mute · save · share) with engagement counts.
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
          gap: tokens.space.sm,
        },
      ]}
    >
      {onVolumeToggle ? (
        <View style={[styles.actionCol, { gap: tokens.space.xxs }]}>
          <Pressable
            onPress={onVolumeToggle}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
            accessibilityState={{ selected: isMuted }}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: tokens.immersive.control,
                borderRadius: tokens.radius.pill,
                opacity: controlOpacity(
                  resolveControlPhase({ pressed }),
                  tokens.motion.pressOpacity,
                ),
              },
            ]}
          >
            <Ionicons
              name={isMuted ? 'volume-mute' : 'volume-high'}
              size={22}
              color={tokens.immersive.icon}
            />
          </Pressable>
        </View>
      ) : null}
      {save ? (
        <View style={[styles.actionCol, { gap: tokens.space.xxs }]}>
          <SaveControl
            isSaved={save.isSaved}
            pending={save.pending}
            iconOnly
            immersive
            onPress={save.onPress}
          />
          <CountLabel value={save.count} />
        </View>
      ) : null}
      {share ? (
        <View style={[styles.actionCol, { gap: tokens.space.xxs }]}>
          <ShareControl
            immersive
            onPress={share.onPress}
            accessibilityLabel={share.accessibilityLabel}
          />
          <CountLabel value={share.count} />
        </View>
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
  actionCol: {
    alignItems: 'center',
    minWidth: FEED_MIN_HIT_TARGET,
  },
  iconBtn: {
    width: FEED_MIN_HIT_TARGET,
    height: FEED_MIN_HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    textAlign: 'center',
    textShadowColor: IMMERSIVE_TOKENS.textShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    minWidth: FEED_MIN_HIT_TARGET,
  },
});
