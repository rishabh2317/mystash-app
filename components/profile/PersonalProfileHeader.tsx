import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ProfileIdentityHeader } from '@/components/profile/ProfileIdentityHeader';
import { ProfileStatsStrip } from '@/components/profile/ProfileStatsStrip';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { CreatorViewModel } from '@/src/types/creator';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';
import { publicCreatorMetaLine, publicCreatorStats } from '@/src/ui/publicCreatorProfile';

type Props = {
  creator: CreatorViewModel;
  onEditPress: () => void;
  onSharePress: () => void;
  onPressStat?: (id: 'collections' | 'following' | 'followers') => void;
};

/**
 * Own-profile identity — same hierarchy + CTA pair as the public storefront,
 * with Edit profile (primary) replacing Follow and Share as secondary.
 */
export function PersonalProfileHeader({
  creator,
  onEditPress,
  onSharePress,
  onPressStat,
}: Props) {
  const { tokens } = useThemeMode();
  const metaInput = {
    collectionCount: creator.collectionCount,
    followersCount: creator.followersCount,
    followingCount: creator.followingCount,
  };
  const stats = publicCreatorStats(metaInput).map((stat) => ({
    ...stat,
    onPress: onPressStat
      ? () => {
          if (stat.id === 'posts') onPressStat('collections');
          else if (stat.id === 'followers') onPressStat('followers');
          else onPressStat('following');
        }
      : undefined,
  }));

  return (
    <ProfileIdentityHeader
      creator={creator}
      showHandle={false}
      statsSlot={
        <ProfileStatsStrip
          compact
          stats={stats}
          accessibilityLabel={publicCreatorMetaLine(metaInput)}
        />
      }
      action={
        <View style={[styles.actions, { gap: tokens.space.sm }]}>
          <Pressable
            onPress={onEditPress}
            accessibilityRole="button"
            accessibilityLabel={PERSONAL_PROFILE_COPY.editProfile}
            style={({ pressed }) => [
              styles.btn,
              {
                borderRadius: tokens.radius.pill,
                borderWidth: tokens.stroke.hairline,
                borderColor: 'transparent',
                backgroundColor: tokens.color.primary,
                opacity: controlOpacity(
                  resolveControlPhase({ pressed }),
                  tokens.motion.pressOpacity,
                ),
              },
            ]}
          >
            <Text
              style={[
                typeStyle(tokens, 'tileMeta'),
                {
                  color: tokens.color.onPrimary,
                  fontFamily: tokens.fontFamily.semibold,
                  fontSize: tokens.fontSize.caption,
                },
              ]}
            >
              {PERSONAL_PROFILE_COPY.editProfile}
            </Text>
          </Pressable>
          <Pressable
            onPress={onSharePress}
            accessibilityRole="button"
            accessibilityLabel="Share profile"
            style={({ pressed }) => [
              styles.btn,
              {
                borderRadius: tokens.radius.pill,
                borderWidth: tokens.stroke.hairline,
                borderColor: tokens.color.border,
                backgroundColor: tokens.color.surface,
                opacity: controlOpacity(
                  resolveControlPhase({ pressed }),
                  tokens.motion.pressOpacity,
                ),
              },
            ]}
          >
            <Text
              style={[
                typeStyle(tokens, 'tileMeta'),
                {
                  color: tokens.color.text,
                  fontFamily: tokens.fontFamily.semibold,
                  fontSize: tokens.fontSize.caption,
                },
              ]}
            >
              Share
            </Text>
          </Pressable>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  btn: {
    flex: 1,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
