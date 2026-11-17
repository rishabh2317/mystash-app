import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DiscoverCreatorsToggle } from './DiscoverCreatorsToggle';

import { ProfileIdentityHeader } from '@/components/profile/ProfileIdentityHeader';
import { ProfileStatsStrip } from '@/components/profile/ProfileStatsStrip';
import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CreatorViewModel } from '@/src/types/creator';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';
import { publicCreatorMetaLine, publicCreatorStats } from '@/src/ui/publicCreatorProfile';

type Props = {
  creator: CreatorViewModel;
  onEditPress: () => void;
  onSharePress: () => void;
  discoverExpanded: boolean;
  onToggleDiscover: () => void;
  onPressStat?: (id: 'collections' | 'following' | 'followers') => void;
};

/**
 * Own-profile identity — same hierarchy + CTA pair as the public storefront,
 * with Edit profile replacing Follow and Share as the second action.
 */
export function PersonalProfileHeader({
  creator,
  onEditPress,
  onSharePress,
  discoverExpanded,
  onToggleDiscover,
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
        <View style={[styles.actions, { gap: tokens.space.xs }]}>
          <View style={styles.btn}>
            <ActionButton
              size="compact"
              radius="md"
              variant="outlinePrimary"
              label={PERSONAL_PROFILE_COPY.editProfile}
              onPress={onEditPress}
              accessibilityLabel={PERSONAL_PROFILE_COPY.editProfile}
              hitSlop={{ top: 6, bottom: 6 }}
            />
          </View>
          <View style={styles.btn}>
            <ActionButton
              size="compact"
              radius="md"
              variant="secondary"
              label="Share"
              onPress={onSharePress}
              accessibilityLabel="Share profile"
              hitSlop={{ top: 6, bottom: 6 }}
            />
          </View>
          <DiscoverCreatorsToggle expanded={discoverExpanded} onPress={onToggleDiscover} />
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
    minWidth: 0,
  },

});
