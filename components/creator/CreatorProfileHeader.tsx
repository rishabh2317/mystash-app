import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FollowControl } from '@/components/engagement/FollowControl';
import { ProfileContentTabs } from '@/components/profile/ProfileContentTabs';
import { ProfileIdentityHeader } from '@/components/profile/ProfileIdentityHeader';
import { ProfileStatsStrip } from '@/components/profile/ProfileStatsStrip';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CreatorViewModel } from '@/src/types/creator';
import { publicCreatorMetaLine, publicCreatorStats } from '@/src/ui/publicCreatorProfile';

export type CreatorProfileTab = 'collections' | 'products';

type Props = {
  creator: CreatorViewModel;
  isLight: boolean;
  isSelf: boolean;
  followPending?: boolean;
  activeTab: CreatorProfileTab;
  onFollowPress: () => void;
  onTabChange: (tab: CreatorProfileTab) => void;
};

export function CreatorProfileHeader({
  creator,
  isLight,
  isSelf,
  followPending,
  activeTab,
  onFollowPress,
  onTabChange,
}: Props) {
  const { tokens } = useThemeMode();
  const metaInput = {
    collectionCount: creator.collectionCount,
    followersCount: creator.followersCount,
    totalReelLikesReceived: creator.totalReelLikesReceived,
  };

  return (
    <View style={[styles.wrap, { gap: tokens.space.md, paddingBottom: tokens.space.xs }]}>
      <ProfileIdentityHeader
        creator={creator}
        action={
          isSelf ? (
            <FollowControl
              isFollowing
              isLight={isLight}
              disabled
              size="compact"
              labelOverride="You"
              onPress={() => {}}
            />
          ) : (
            <FollowControl
              isFollowing={Boolean(creator.isFollowing)}
              pending={followPending}
              isLight={isLight}
              size="compact"
              onPress={onFollowPress}
            />
          )
        }
      />

      <ProfileStatsStrip
        stats={publicCreatorStats(metaInput)}
        accessibilityLabel={publicCreatorMetaLine(metaInput)}
      />

      <ProfileContentTabs
        tabs={
          [
            { id: 'collections', label: 'Collections' },
            { id: 'products', label: 'Products' },
          ] as const
        }
        active={activeTab}
        onChange={onTabChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 4 },
});
