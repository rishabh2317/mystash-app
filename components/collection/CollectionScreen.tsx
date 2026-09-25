import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ProductCard } from '@/components/commerce';
import { PublicCollectionTile } from '@/components/collection/PublicCollectionTile';
import { ContentRail } from '@/components/ui/ContentRail';
import { ListRowGroup, type ListRowSpec } from '@/components/ui/ListRowGroup';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { loadCollectionRelatedProducts } from '@/src/services/collectionRelatedProducts';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { fetchProductPage } from '@/src/services/productPageApi';
import { openProductShopping } from '@/src/services/shoppingClick';
import { softCanvasGradient } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import {
  CREATOR_MORE_COLLECTIONS_PREVIEW,
  filterCreatorCollectionsPreview,
  shouldShowCreatorCollectionsViewAll,
} from '@/src/ui/collectionCreatorMore';
import {
  collectionMediaReference,
  collectionTilePressPath,
  COLLECTION_SCROLL_HORIZONTAL_PADDING,
} from '@/src/ui/collectionLayout';
import { COLLECTION_PRODUCT_COPY } from '@/src/ui/collectionProductActions';
import {
  COLLECTION_SECTION_COPY,
  collectionMerchantPreviewsFromOffers,
  collectionMerchantPreviewsFromProduct,
  productsSectionTitle,
  type CollectionMerchantPreview,
} from '@/src/ui/collectionSections';
import { productPagePath } from '@/src/ui/productPage';
import { railCardWidth } from '@/src/ui/rail';

import { CollectionCuratorCredit } from './CollectionCuratorCredit';
import { CollectionHero } from './CollectionHero';
import { CollectionMediaReference } from './CollectionMediaReference';
import { CollectionPageHeader } from './CollectionPageHeader';

type Props = {
  collection: CollectionDetailViewModel;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  isSaved?: boolean;
  savePending?: boolean;
  onSavePress?: () => void;
  onSharePress?: () => void;
  isFollowing?: boolean;
  followPending?: boolean;
  isSelf?: boolean;
  onFollowPress?: () => void;
};

const RELATED_RAIL = { visible: 2, peek: 56, minWidth: 140, maxWidth: 200 };
const CREATOR_RAIL = { visible: 2.4, peek: 36, minWidth: 120, maxWidth: 148 };

/**
 * Collection: curated editorial page.
 * Title → media → curator credit → products → related → more from creator → explore.
 */
export function CollectionScreen({
  collection,
  isSaved = false,
  savePending = false,
  onSavePress,
  onSharePress,
  isFollowing = false,
  followPending = false,
  isSelf = false,
  onFollowPress,
}: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const tabBarHeight = useBottomTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const onAddToCart = useProductAddToCartHandler();
  const [relatedProducts, setRelatedProducts] = useState<CatalogProductViewModel[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [creatorCollections, setCreatorCollections] = useState<CollectionViewModel[]>([]);
  const [creatorCollectionsNextCursor, setCreatorCollectionsNextCursor] = useState<string | null>(null);
  const [creatorCollectionsLoading, setCreatorCollectionsLoading] = useState(false);
  const [merchantsByProduct, setMerchantsByProduct] = useState<
    Record<string, CollectionMerchantPreview[]>
  >({});

  const gutter = COLLECTION_SCROLL_HORIZONTAL_PADDING;
  const railGap = tokens.space.sm;
  const media = useMemo(() => collectionMediaReference(collection), [collection]);
  const products = collection.products;

  const relatedCardWidth = railCardWidth({
    screenWidth,
    gutter,
    gap: railGap,
    ...RELATED_RAIL,
  });
  const creatorCardWidth = railCardWidth({
    screenWidth,
    gutter,
    gap: railGap,
    ...CREATOR_RAIL,
  });

  const openProduct = useCallback(
    (product: CatalogProductViewModel) => {
      const id = (product.catalogProductId ?? product.id).trim();
      if (!id) return;
      router.push(productPagePath(id) as Href);
    },
    [router],
  );

  const onMerchantPress = useCallback(
    async (merchant: CollectionMerchantPreview, product: CatalogProductViewModel) => {
      const catalogProductId = product.catalogProductId?.trim();
      if (!catalogProductId) {
        openProduct(product);
        return;
      }
      try {
        await openProductShopping({
          catalogProductId,
          offerId: merchant.id.startsWith('merchant-') ? null : merchant.id,
          collectionId: collection.collectionId,
          creatorId: collection.creator.id,
        });
      } catch {
        openProduct(product);
      }
    },
    [collection.collectionId, collection.creator.id, openProduct],
  );

  const creatorHandle = collection.creator.username?.trim() || null;

  const openCreator = useCallback(() => {
    if (creatorHandle) {
      router.push(`/creator/${encodeURIComponent(creatorHandle)}`);
    }
  }, [creatorHandle, router]);

  useEffect(() => {
    let cancelled = false;
    setRelatedLoading(true);
    void loadCollectionRelatedProducts(collection)
      .then((rows) => {
        if (!cancelled) setRelatedProducts(rows);
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collection]);

  useEffect(() => {
    let cancelled = false;
    const ids = products
      .map((p) => (p.catalogProductId ?? p.id).trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setMerchantsByProduct({});
      return;
    }
    void Promise.all(
      products.map(async (product) => {
        const key = (product.catalogProductId ?? product.id).trim();
        const fallback = collectionMerchantPreviewsFromProduct(product);
        if (!product.catalogProductId) return [key, fallback] as const;
        try {
          const page = await fetchProductPage(product.catalogProductId);
          const fromOffers = collectionMerchantPreviewsFromOffers(page.offers);
          if (fromOffers.length === 0) return [key, fallback] as const;
          if (fallback.length === 0) return [key, fromOffers] as const;
          const seen = new Set(fromOffers.map((m) => m.label.toLowerCase()));
          const merged = [...fromOffers];
          for (const row of fallback) {
            if (seen.has(row.label.toLowerCase())) continue;
            seen.add(row.label.toLowerCase());
            merged.push(row);
          }
          return [key, merged] as const;
        } catch {
          return [key, fallback] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setMerchantsByProduct(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [products]);

  useEffect(() => {
    const creatorId = collection.creator.id?.trim();
    if (!creatorId) {
      setCreatorCollections([]);
      setCreatorCollectionsNextCursor(null);
      return;
    }
    let cancelled = false;
    setCreatorCollectionsLoading(true);
    void listCreatorCollections(creatorId, { limit: CREATOR_MORE_COLLECTIONS_PREVIEW + 1 })
      .then((page) => {
        if (cancelled) return;
        setCreatorCollections(page.collections);
        setCreatorCollectionsNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (!cancelled) {
          setCreatorCollections([]);
          setCreatorCollectionsNextCursor(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCreatorCollectionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collection.creator.id, collection.collectionId]);

  const moreFromCreator = useMemo(
    () =>
      filterCreatorCollectionsPreview(
        creatorCollections,
        collection.collectionId,
        CREATOR_MORE_COLLECTIONS_PREVIEW,
      ),
    [collection.collectionId, creatorCollections],
  );

  const showCreatorViewAll = useMemo(() => {
    const others = creatorCollections.filter(
      (c) => c.collectionId !== collection.collectionId,
    );
    return shouldShowCreatorCollectionsViewAll({
      totalOthers: others.length,
      previewLimit: CREATOR_MORE_COLLECTIONS_PREVIEW,
      hasNextCursor: Boolean(creatorCollectionsNextCursor),
      creatorUsername: collection.creator.username,
    });
  }, [
    collection.collectionId,
    collection.creator.username,
    creatorCollections,
    creatorCollectionsNextCursor,
  ]);

  const onPressCreatorCollection = useCallback(
    (item: CollectionViewModel) => {
      router.push(collectionTilePressPath(item.collectionId) as never);
    },
    [router],
  );

  const exploreRows = useMemo<ListRowSpec[]>(() => {
    const rows: ListRowSpec[] = [];
    if (creatorHandle) {
      rows.push({
        id: 'creator',
        icon: 'albums-outline',
        title: COLLECTION_SECTION_COPY.shopMoreCollections,
        subtitle: COLLECTION_SECTION_COPY.shopMoreCollectionsHint,
        onPress: openCreator,
      });
    }
    if (onSavePress) {
      rows.push({
        id: 'save',
        icon: isSaved ? 'bookmark' : 'bookmark-outline',
        title: isSaved
          ? COLLECTION_SECTION_COPY.savedCollection
          : COLLECTION_SECTION_COPY.saveCollection,
        subtitle: isSaved
          ? COLLECTION_SECTION_COPY.savedCollectionHint
          : COLLECTION_SECTION_COPY.saveCollectionHint,
        onPress: onSavePress,
        disabled: savePending,
      });
    }
    return rows;
  }, [creatorHandle, isSaved, onSavePress, openCreator, savePending]);

  const isFocused = useIsFocused();
  const sectionGap = { gap: tokens.space.sm };
  const mutedStyle = typeStyle(tokens, 'bodyMuted');

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...softCanvasGradient(tokens)]} style={StyleSheet.absoluteFill} />
      <CollectionPageHeader
        title="Shop"
        isSaved={isSaved}
        savePending={savePending}
        onSavePress={onSavePress}
        onSharePress={onSharePress}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            paddingTop: tokens.space.md,
            paddingBottom: tabBarHeight + tokens.space.xl,
            gap: tokens.space.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <CollectionHero collection={collection} />

        {media ? (
          <CollectionMediaReference
            media={media}
            collection={collection}
            isActive={isFocused}
          />
        ) : null}

        <CollectionCuratorCredit
          collection={collection}
          onCreatorPress={creatorHandle ? openCreator : undefined}
          isFollowing={isFollowing}
          followPending={followPending}
          onFollowPress={!isSelf && onFollowPress ? onFollowPress : undefined}
        />

        <View style={sectionGap}>
          <SectionHeader title={productsSectionTitle(products.length)} />
          {products.length === 0 ? (
            <Text style={mutedStyle}>No products in this collection yet.</Text>
          ) : (
            <View style={{ gap: tokens.space.sm }}>
              {products.map((product) => {
                const key = (product.catalogProductId ?? product.id).trim();
                return (
                  <ProductCard
                    key={product.id}
                    product={product}
                    variant="collection"
                    onPress={openProduct}
                    onAddToCart={product.catalogProductId ? onAddToCart : undefined}
                    merchantPreviews={merchantsByProduct[key]}
                    onMerchantPress={onMerchantPress}
                    onViewMoreMerchants={openProduct}
                  />
                );
              })}
            </View>
          )}
        </View>

        {relatedLoading || relatedProducts.length > 0 ? (
          <View style={sectionGap}>
            <SectionHeader title={COLLECTION_PRODUCT_COPY.relatedProducts} />
            {relatedLoading && relatedProducts.length === 0 ? (
              <Text style={mutedStyle}>Loading related products…</Text>
            ) : (
              <ContentRail
                gutter={gutter}
                itemPitch={relatedCardWidth + railGap}
                pageCount={relatedProducts.length}
                accessibilityLabel={COLLECTION_PRODUCT_COPY.relatedProducts}
              >
                {relatedProducts.map((product, index) => (
                  <View
                    key={`related-${product.id}`}
                    style={{
                      width: relatedCardWidth,
                      marginRight: index === relatedProducts.length - 1 ? 0 : railGap,
                    }}
                  >
                    <ProductCard
                      product={product}
                      variant="related"
                      onPress={openProduct}
                      onAddToCart={product.catalogProductId ? onAddToCart : undefined}
                    />
                  </View>
                ))}
              </ContentRail>
            )}
          </View>
        ) : null}

        {creatorCollectionsLoading || moreFromCreator.length > 0 ? (
          <View style={sectionGap}>
            <SectionHeader
              title={COLLECTION_PRODUCT_COPY.moreFromCreator}
              actionLabel={showCreatorViewAll ? COLLECTION_PRODUCT_COPY.viewAll : undefined}
              onActionPress={showCreatorViewAll ? openCreator : undefined}
              actionAccessibilityLabel={`${COLLECTION_PRODUCT_COPY.viewAll} ${COLLECTION_PRODUCT_COPY.moreFromCreator}`}
            />
            {creatorCollectionsLoading && moreFromCreator.length === 0 ? (
              <Text style={mutedStyle}>Loading collections…</Text>
            ) : (
              <ContentRail
                gutter={gutter}
                itemPitch={creatorCardWidth + railGap}
                accessibilityLabel={COLLECTION_PRODUCT_COPY.moreFromCreator}
              >
                {moreFromCreator.map((item, index) => (
                  <View
                    key={item.collectionId}
                    style={{
                      width: creatorCardWidth,
                      marginRight: index === moreFromCreator.length - 1 ? 0 : railGap,
                    }}
                  >
                    <PublicCollectionTile
                      collection={item}
                      onPress={onPressCreatorCollection}
                    />
                  </View>
                ))}
              </ContentRail>
            )}
          </View>
        ) : null}

        {exploreRows.length > 0 ? (
          <View style={sectionGap}>
            <SectionHeader title={COLLECTION_SECTION_COPY.exploreMore} />
            <ListRowGroup rows={exploreRows} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    flexGrow: 1,
  },
});
