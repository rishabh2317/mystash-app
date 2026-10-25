import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FollowControl } from '@/components/engagement/FollowControl';
import { ProfileContentTabs } from '@/components/profile/ProfileContentTabs';
import { ProfileIdentityHeader } from '@/components/profile/ProfileIdentityHeader';
import { ProfileStatsStrip } from '@/components/profile/ProfileStatsStrip';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { CreatorViewModel } from '@/src/types/creator';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { publicCreatorMetaLine, publicCreatorStats } from '@/src/ui/publicCreatorProfile';

export type CreatorProfileTab = 'collections' | 'products';

type Props = {
  creator: CreatorViewModel;
  isLight: boolean;
  isSelf: boolean;
  followPending?: boolean;
  activeTab: CreatorProfileTab;
  onFollowPress: () => void;
  onSharePress: () => void;
  onTabChange: (tab: CreatorProfileTab) => void;
  /** Inserted between identity/actions and Collection/Products tabs. */
  afterIdentity?: React.ReactNode;
};

/**
 * LTK-style Follow (filled primary) + Share (outlined) pair for the public storefront.
 */
function ProfileActionRow({
  isSelf,
  isLight,
  isFollowing,
  followPending,
  onFollowPress,
  onSharePress,
}: {
  isSelf: boolean;
  isLight: boolean;
  isFollowing: boolean;
  followPending?: boolean;
  onFollowPress: () => void;
  onSharePress: () => void;
}) {
  const { tokens } = useThemeMode();

  return (
    <View style={[styles.actions, { gap: tokens.space.sm }]}>
      <View style={styles.actionFlex}>
        {isSelf ? (
          <FollowControl
            isFollowing
            isLight={isLight}
            disabled
            fullWidth
            slim
            radius="md"
            labelOverride="You"
            onPress={() => {}}
          />
        ) : (
          <FollowControl
            isFollowing={isFollowing}
            pending={followPending}
            isLight={isLight}
            emphasis="brand"
            fullWidth
            slim
            radius="md"
            onPress={onFollowPress}
          />
        )}
      </View>
      <Pressable
        onPress={onSharePress}
        accessibilityRole="button"
        accessibilityLabel="Share profile"
        style={({ pressed }) => [
          styles.shareBtn,
          {
            borderRadius: tokens.radius.md,
            borderWidth: tokens.stroke.hairline,
            borderColor: tokens.color.border,
            backgroundColor: tokens.color.surface,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
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
  );
}

export function CreatorProfileHeader({
  creator,
  isLight,
  isSelf,
  followPending,
  activeTab,
  onFollowPress,
  onSharePress,
  onTabChange,
  afterIdentity,
}: Props) {
  const { tokens } = useThemeMode();
  const metaInput = {
    collectionCount: creator.collectionCount,
    followersCount: creator.followersCount,
    followingCount: creator.followingCount,
  };

  return (
    <View style={[styles.wrap, { gap: tokens.space.md, paddingBottom: tokens.space.xs }]}>
      <ProfileIdentityHeader
        creator={creator}
        showHandle={false}
        statsSlot={
          <ProfileStatsStrip
            compact
            stats={publicCreatorStats(metaInput)}
            accessibilityLabel={publicCreatorMetaLine(metaInput)}
          />
        }
        action={
          <ProfileActionRow
            isSelf={isSelf}
            isLight={isLight}
            isFollowing={Boolean(creator.isFollowing)}
            followPending={followPending}
            onFollowPress={onFollowPress}
            onSharePress={onSharePress}
          />
        }
      />

      {afterIdentity}

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
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  actionFlex: {
    flex: 1,
  },
  shareBtn: {
    flex: 1,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
