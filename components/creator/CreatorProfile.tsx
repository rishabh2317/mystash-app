import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import type { AddToCartOutcome } from '@/src/services/productActionOrchestration';
import type { CreatorViewModel } from '@/src/types/creator';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { PublicCollectionTile } from '@/components/collection/PublicCollectionTile';
import { ProductCard } from '@/components/commerce';
import { Text } from '@/components/ui/Text';
import {
  CreatorProfileHeader,
  type CreatorProfileTab,
} from './CreatorProfileHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
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
  onSharePress: () => void;
  onTabChange: (tab: CreatorProfileTab) => void;
  onPressCollection: (collection: CollectionViewModel) => void;
  onPressProduct: (product: CatalogProductViewModel) => void;
  onAddToCart?: (product: CatalogProductViewModel) => AddToCartOutcome | Promise<AddToCartOutcome>;
  onEndReached?: () => void;
  onRetry?: () => void;
};

/**
 * Public creator storefront only. The logged-in You tab uses PersonalProfile.
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
  onSharePress,
  onTabChange,
  onPressCollection,
  onPressProduct,
  onAddToCart,
  onEndReached,
  onRetry,
}: Props) {
  const { tokens } = useThemeMode();
  const muted = tokens.color.textMuted;
  const text = tokens.color.text;
  const gutter = tokens.space.md;
  const gap = tokens.space.sm;

  const header = (
    <CreatorProfileHeader
      creator={creator}
      isLight={isLight}
      isSelf={isSelf}
      followPending={followPending}
      activeTab={activeTab}
      onFollowPress={onFollowPress}
      onSharePress={onSharePress}
      onTabChange={onTabChange}
    />
  );

  const contentStyle = [
    styles.content,
    { paddingHorizontal: gutter, paddingTop: tokens.space.xs },
  ];
  const rowStyle = [styles.row, { gap, marginBottom: gap }];

  const empty = (message: string) => (
    <Text style={[typeStyle(tokens, 'bodyMuted'), { marginTop: tokens.space.lg, textAlign: 'center' }]}>
      {message}
    </Text>
  );

  const retry = (
    <Pressable onPress={onRetry} style={styles.retry}>
      <Text style={[typeStyle(tokens, 'tileTitle'), { color: text }]}>Retry</Text>
    </Pressable>
  );

  if (activeTab === 'collections') {
    if (collectionsLoading && collections.length === 0) {
      return (
        <View style={[styles.centered, { paddingHorizontal: gutter }]}>
          {header}
          <ActivityIndicator style={{ marginTop: tokens.space.lg }} color={text} />
        </View>
      );
    }
    if (collectionsError && collections.length === 0) {
      return (
        <View style={[styles.centered, { paddingHorizontal: gutter }]}>
          {header}
          <Text style={[styles.message, { color: muted }]}>{collectionsError}</Text>
          {onRetry ? retry : null}
        </View>
      );
    }
    return (
      <FlatList
        key={CREATOR_PROFILE_FLATLIST_KEYS.collections}
        data={collections}
        keyExtractor={(item) => item.collectionId}
        numColumns={2}
        columnWrapperStyle={rowStyle}
        contentContainerStyle={contentStyle}
        ListHeaderComponent={header}
        ListEmptyComponent={empty('No collections yet')}
        ListFooterComponent={
          collectionsLoadingMore ? (
            <ActivityIndicator style={{ marginVertical: tokens.space.md }} color={text} />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <PublicCollectionTile collection={item} onPress={onPressCollection} />
          </View>
        )}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
      />
    );
  }

  if (productsLoading && products.length === 0) {
    return (
      <View style={[styles.centered, { paddingHorizontal: gutter }]}>
        {header}
        <ActivityIndicator style={{ marginTop: tokens.space.lg }} color={text} />
      </View>
    );
  }
  if (productsError && products.length === 0) {
    return (
      <View style={[styles.centered, { paddingHorizontal: gutter }]}>
        {header}
        <Text style={[styles.message, { color: muted }]}>{productsError}</Text>
        {onRetry ? retry : null}
      </View>
    );
  }

  return (
    <FlatList
      key={CREATOR_PROFILE_FLATLIST_KEYS.products}
      data={products}
      keyExtractor={(item) => item.catalogProductId ?? item.id}
      numColumns={2}
      columnWrapperStyle={rowStyle}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={header}
      ListEmptyComponent={empty('No products yet')}
      ListFooterComponent={
        productsLoadingMore ? (
          <ActivityIndicator style={{ marginVertical: tokens.space.md }} color={text} />
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.cell}>
          <ProductCard
            product={item}
            variant="related"
            onPress={onPressProduct}
            onAddToCart={item.catalogProductId ? onAddToCart : undefined}
          />
        </View>
      )}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
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
