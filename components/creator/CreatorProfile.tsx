import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { CreatorViewModel } from '@/src/types/creator';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { CollectionTile } from '@/components/collection/CollectionTile';
import { ProductCard } from '@/components/commerce';
import {
  CreatorProfileHeader,
  type CreatorProfileTab,
} from './CreatorProfileHeader';
import { CREATOR_PROFILE_FLATLIST_KEYS } from '@/src/ui/creatorProfileFlatList';

type Props = {
  creator: CreatorViewModel;
  collections: CollectionViewModel[];
  products: CatalogProductViewModel[];
  isLight: boolean;
  isSelf: boolean;
  followPending?: boolean;
  activeTab: CreatorProfileTab;
  collectionsLoading?: boolean;
  collectionsLoadingMore?: boolean;
  collectionsError?: string | null;
  productsLoading?: boolean;
  productsLoadingMore?: boolean;
  productsError?: string | null;
  onFollowPress: () => void;
  onTabChange: (tab: CreatorProfileTab) => void;
  onPressCollection: (collection: CollectionViewModel) => void;
  onPressProduct: (product: CatalogProductViewModel) => void;
  onEndReached?: () => void;
  onRetry?: () => void;
};

/**
 * Presentation composition for public Creator Profile / self Profile.
 * No auth / API calls — parents own orchestration.
 */
export function CreatorProfile({
  creator,
  collections,
  products,
  isLight,
  isSelf,
  followPending,
  activeTab,
  collectionsLoading,
  collectionsLoadingMore,
  collectionsError,
  productsLoading,
  productsLoadingMore,
  productsError,
  onFollowPress,
  onTabChange,
  onPressCollection,
  onPressProduct,
  onEndReached,
  onRetry,
}: Props) {
  const muted = isLight ? '#4E5257' : '#AEB8C5';
  const text = isLight ? '#1A1A1B' : '#F8FAFC';

  const header = (
    <CreatorProfileHeader
      creator={creator}
      isLight={isLight}
      isSelf={isSelf}
      followPending={followPending}
      activeTab={activeTab}
      onFollowPress={onFollowPress}
      onTabChange={onTabChange}
    />
  );

  if (activeTab === 'collections') {
    if (collectionsLoading && collections.length === 0) {
      return (
        <View style={styles.centered}>
          {header}
          <ActivityIndicator style={{ marginTop: 24 }} color={text} />
        </View>
      );
    }
    if (collectionsError && collections.length === 0) {
      return (
        <View style={styles.centered}>
          {header}
          <Text style={[styles.message, { color: muted }]}>{collectionsError}</Text>
          {onRetry ? (
            <Pressable onPress={onRetry} style={styles.retry}>
              <Text style={{ color: text, fontWeight: '700' }}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      );
    }
    return (
      <FlatList
        key={CREATOR_PROFILE_FLATLIST_KEYS.collections}
        data={collections}
        keyExtractor={(item) => item.collectionId}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={[styles.message, { color: muted, marginTop: 24 }]}>No collections yet</Text>
        }
        ListFooterComponent={
          collectionsLoadingMore ? (
            <ActivityIndicator style={{ marginVertical: 16 }} color={text} />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <CollectionTile collection={item} isLight={isLight} onPress={onPressCollection} />
          </View>
        )}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
      />
    );
  }

  if (productsLoading && products.length === 0) {
    return (
      <View style={styles.centered}>
        {header}
        <ActivityIndicator style={{ marginTop: 24 }} color={text} />
      </View>
    );
  }
  if (productsError && products.length === 0) {
    return (
      <View style={styles.centered}>
        {header}
        <Text style={[styles.message, { color: muted }]}>{productsError}</Text>
        {onRetry ? (
          <Pressable onPress={onRetry} style={styles.retry}>
            <Text style={{ color: text, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <FlatList
      key={CREATOR_PROFILE_FLATLIST_KEYS.products}
      data={products}
      keyExtractor={(item) => item.catalogProductId ?? item.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Text style={[styles.message, { color: muted, marginTop: 24 }]}>No products yet</Text>
      }
      ListFooterComponent={
        productsLoadingMore ? (
          <ActivityIndicator style={{ marginVertical: 16 }} color={text} />
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.productCell}>
          <ProductCard product={item} variant="compact" onPress={onPressProduct} />
        </View>
      )}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  row: {
    gap: 12,
    marginBottom: 12,
  },
  cell: {
    flex: 1,
  },
  productCell: {
    marginBottom: 12,
  },
  centered: {
    flex: 1,
    paddingHorizontal: 20,
  },
  message: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: 12,
  },
  retry: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
