import React, { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { PublicCollectionTile } from '@/components/collection/PublicCollectionTile';
import { DiscoverCreatorsSection } from '@/components/profile/DiscoverCreatorsSection';
import { ProfileContentTabs } from '@/components/profile/ProfileContentTabs';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';
import {
  PERSONAL_PROFILE_COPY,
  PERSONAL_PROFILE_FLATLIST_KEYS,
  PERSONAL_PROFILE_TABS,
  type PersonalProfileTab,
} from '@/src/ui/personalProfile';

import { PersonalCreateCollectionCard } from './PersonalCreateCollectionCard';
import { PersonalProfileHeader } from './PersonalProfileHeader';

type Props = {
  creator: CreatorViewModel;
  collections: CollectionViewModel[];
  saved: CollectionViewModel[];
  collectionsLoading?: boolean;
  savedLoading?: boolean;
  onEditPress: () => void;
  onSharePress: () => void;
  onPressCollection: (collection: CollectionViewModel) => void;
  onPressStat: (id: 'collections' | 'following' | 'followers') => void;
  onCreateCollection: () => void;
};

export function PersonalProfile({
  creator,
  collections,
  saved,
  collectionsLoading,
  savedLoading,
  onEditPress,
  onSharePress,
  onPressCollection,
  onPressStat,
  onCreateCollection,
}: Props) {
  const { tokens } = useThemeMode();
  const [activeTab, setActiveTab] = useState<PersonalProfileTab>('collections');
  const gutter = tokens.space.md;
  const gap = tokens.space.sm;

  const header = (
    <View style={{ gap: tokens.space.md, paddingBottom: tokens.space.xs }}>
      <PersonalProfileHeader
        creator={creator}
        onEditPress={onEditPress}
        onSharePress={onSharePress}
        onPressStat={onPressStat}
      />
      <DiscoverCreatorsSection
        excludeUserId={creator.userId}
        excludeUsername={creator.username}
      />
      <ProfileContentTabs tabs={PERSONAL_PROFILE_TABS} active={activeTab} onChange={setActiveTab} />
    </View>
  );

  const contentStyle = [
    styles.content,
    { paddingHorizontal: gutter, paddingTop: tokens.space.xs, paddingBottom: tokens.space.xxl },
  ];
  const rowStyle = [styles.row, { gap, marginBottom: gap }];

  const empty = (message: string) => (
    <Text
      style={{
        color: tokens.color.textMuted,
        marginTop: tokens.space.lg,
        textAlign: 'center',
        fontSize: tokens.fontSize.body,
        lineHeight: tokens.lineHeight.body,
      }}
    >
      {message}
    </Text>
  );

  const items = activeTab === 'collections' ? collections : saved;
  const loading = activeTab === 'collections' ? collectionsLoading : savedLoading;

  if (loading && items.length === 0) {
    return (
      <View style={[styles.centered, { paddingHorizontal: gutter }]}>
        {header}
        <ActivityIndicator style={{ marginTop: tokens.space.lg }} color={tokens.color.text} />
      </View>
    );
  }

  return (
    <FlatList
      key={
        activeTab === 'collections'
          ? PERSONAL_PROFILE_FLATLIST_KEYS.collections
          : PERSONAL_PROFILE_FLATLIST_KEYS.saved
      }
      data={items}
      keyExtractor={(item) => item.collectionId}
      numColumns={2}
      columnWrapperStyle={rowStyle}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={header}
      ListEmptyComponent={empty(
        activeTab === 'collections'
          ? PERSONAL_PROFILE_COPY.emptyCollections
          : PERSONAL_PROFILE_COPY.emptySaved,
      )}
      ListFooterComponent={
        activeTab === 'collections' ? (
          <View style={{ marginTop: tokens.space.md }}>
            <PersonalCreateCollectionCard onPress={onCreateCollection} />
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.cell}>
          <PublicCollectionTile collection={item} onPress={onPressCollection} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {},
  row: {
    alignItems: 'flex-start',
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
  centered: {
    flex: 1,
  },
});
