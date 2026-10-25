import React from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import type { AddToCartOutcome } from '@/src/services/productActionOrchestration';
import type { CreatorViewModel } from '@/src/types/creator';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { PublicCollectionTile } from '@/components/collection/PublicCollectionTile';
import { CollectionTileSkeleton } from '@/components/collection/CollectionTileSkeleton';
import { ProductCard } from '@/components/commerce';
import { ProductCardSkeleton } from '@/components/commerce/ProductCardSkeleton';
import { SkeletonGrid } from '@/components/status/SkeletonStack';
import { DiscoverCreatorsSection } from '@/components/profile/DiscoverCreatorsSection';
import { Text } from '@/components/ui/Text';
import {
  CreatorProfileHeader,
  type CreatorProfileTab,
} from './CreatorProfileHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useDiscoverCreators } from '@/src/hooks/useDiscoverCreators';
import { typeStyle } from '@/src/theme/typography';
import { resolveListLoadState } from '@/src/ui/contentLoadState';
import { CREATOR_PROFILE_FLATLIST_KEYS } from '@/src/ui/creatorProfileFlatList';
import {
  PROFILE_VIDEO_GRID_ASPECT,
  PROFILE_VIDEO_GRID_COLUMNS,
  PROFILE_VIDEO_GRID_GAP,
  PROFILE_VIDEO_GRID_GUTTER,
  profileGridCellWidth,
} from '@/src/ui/personalProfile';

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
  const { width: screenWidth } = useWindowDimensions();
  const muted = tokens.color.textMuted;
  const text = tokens.color.text;
  const gutter = tokens.space.md;
  const gap = tokens.space.sm;
  const videoCellWidth = profileGridCellWidth(
    screenWidth,
    PROFILE_VIDEO_GRID_GUTTER,
    PROFILE_VIDEO_GRID_GAP,
    PROFILE_VIDEO_GRID_COLUMNS,
  );
  const productCellWidth = profileGridCellWidth(screenWidth, gutter, gap);
  const discover = useDiscoverCreators({
    excludeUserId: creator.userId,
    excludeUsername: creator.username,
  });

  const header = (
    <View style={{ paddingHorizontal: activeTab === 'collections' ? gutter : 0 }}>
      <CreatorProfileHeader
        creator={creator}
        isLight={isLight}
        isSelf={isSelf}
        followPending={followPending}
        activeTab={activeTab}
        onFollowPress={onFollowPress}
        onSharePress={onSharePress}
        onTabChange={onTabChange}
        afterIdentity={<DiscoverCreatorsSection items={discover.items} loading={discover.loading} />}
      />
    </View>
  );

  const collectionContentStyle = [
    styles.content,
    { paddingHorizontal: PROFILE_VIDEO_GRID_GUTTER },
  ];
  const productContentStyle = [
    styles.content,
    { paddingHorizontal: gutter, paddingTop: tokens.space.xs },
  ];
  const videoRowStyle = [
    styles.row,
    { gap: PROFILE_VIDEO_GRID_GAP, marginBottom: PROFILE_VIDEO_GRID_GAP },
  ];
  const productRowStyle = [styles.row, { gap, marginBottom: gap }];

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

  const collectionLoad = resolveListLoadState({
    itemCount: collections.length,
    fetching: Boolean(collectionsLoading),
    fetchingMore: collectionsLoadingMore,
    error: Boolean(collectionsError),
  });
  const productLoad = resolveListLoadState({
    itemCount: products.length,
    fetching: Boolean(productsLoading),
    fetchingMore: productsLoadingMore,
    error: Boolean(productsError),
  });

  if (activeTab === 'collections') {
    if (collectionLoad === 'skeleton') {
      return (
        <View style={styles.centered}>
          {header}
          <SkeletonGrid columns={PROFILE_VIDEO_GRID_COLUMNS} gap={PROFILE_VIDEO_GRID_GAP}>
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
            <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
          </SkeletonGrid>
        </View>
      );
    }
    if (collectionsError && collections.length === 0) {
      return (
        <View style={styles.centered}>
          {header}
          <Text style={[styles.message, { color: muted, paddingHorizontal: gutter }]}>
            {collectionsError}
          </Text>
          {onRetry ? retry : null}
        </View>
      );
    }
    return (
      <FlatList
        key={CREATOR_PROFILE_FLATLIST_KEYS.collections}
        data={collections}
        keyExtractor={(item) => item.collectionId}
        numColumns={PROFILE_VIDEO_GRID_COLUMNS}
        columnWrapperStyle={videoRowStyle}
        contentContainerStyle={collectionContentStyle}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: gutter }}>{empty('No collections yet')}</View>
        }
        ListFooterComponent={
          collectionLoad === 'contentPaginating' ? (
            <View style={{ marginVertical: tokens.space.md }}>
              <SkeletonGrid columns={PROFILE_VIDEO_GRID_COLUMNS} gap={PROFILE_VIDEO_GRID_GAP}>
                <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
                <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
                <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
              </SkeletonGrid>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={{ width: videoCellWidth }}>
            <PublicCollectionTile
              collection={item}
              aspectRatio={PROFILE_VIDEO_GRID_ASPECT}
              flush
              onPress={onPressCollection}
            />
          </View>
        )}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
      />
    );
  }

  if (productLoad === 'skeleton') {
    return (
      <View style={[styles.centered, { paddingHorizontal: gutter }]}>
        {header}
        <View style={{ marginTop: tokens.space.md }}>
          <SkeletonGrid columns={2} gap={gap}>
            <ProductCardSkeleton variant="related" />
            <ProductCardSkeleton variant="related" />
            <ProductCardSkeleton variant="related" />
            <ProductCardSkeleton variant="related" />
          </SkeletonGrid>
        </View>
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
      columnWrapperStyle={productRowStyle}
      contentContainerStyle={productContentStyle}
      ListHeaderComponent={header}
      ListEmptyComponent={empty('No products yet')}
      ListFooterComponent={
        productLoad === 'contentPaginating' ? (
          <View style={{ marginVertical: tokens.space.md }}>
            <SkeletonGrid columns={2} gap={gap}>
              <ProductCardSkeleton variant="related" />
              <ProductCardSkeleton variant="related" />
            </SkeletonGrid>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={{ width: productCellWidth }}>
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
