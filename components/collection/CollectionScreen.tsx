import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ProductCard, ProductDetailsSheet } from '@/components/commerce';
import { AiReviewSheet } from '@/components/commerce/AiReviewSheet';
import { ProductAiReviewCard } from '@/components/commerce/ProductAiReviewCard';
import { CollectionTile } from '@/components/collection/CollectionTile';
import { ContentRail } from '@/components/ui/ContentRail';
import { ListRowGroup, type ListRowSpec } from '@/components/ui/ListRowGroup';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { loadCollectionRelatedProducts } from '@/src/services/collectionRelatedProducts';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { openProductShopping } from '@/src/services/shoppingClick';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import type { ProductAiReviewResult } from '@/src/types/productAiReview';
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
  collectionVerificationSummary,
  formatCollectionDate,
  productsSectionTitle,
  shouldGroupProductInsights,
  verificationSummaryLabel,
} from '@/src/ui/collectionSections';
import { railCardWidth } from '@/src/ui/rail';

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
const CREATOR_RAIL = { visible: 3, peek: 28, minWidth: 96, maxWidth: 150 };

/**
 * Collection: an editorial decision environment.
 * Creator context → collection context → evidence (reel) → products →
 * product intelligence → related discovery → more from creator → trust → intent.
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
  const { width: screenWidth } = useWindowDimensions();
  const onAddToCart = useProductAddToCartHandler();
  const [detailsProduct, setDetailsProduct] = useState<CatalogProductViewModel | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [aiReviewProduct, setAiReviewProduct] = useState<CatalogProductViewModel | null>(null);
  const [aiReviewVisible, setAiReviewVisible] = useState(false);
  const [aiResults, setAiResults] = useState<Record<string, ProductAiReviewResult>>({});
  const [relatedProducts, setRelatedProducts] = useState<CatalogProductViewModel[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [creatorCollections, setCreatorCollections] = useState<CollectionViewModel[]>([]);
  const [creatorCollectionsNextCursor, setCreatorCollectionsNextCursor] = useState<string | null>(null);
  const [creatorCollectionsLoading, setCreatorCollectionsLoading] = useState(false);

  const muted = tokens.color.textMuted;
  const gutter = COLLECTION_SCROLL_HORIZONTAL_PADDING;
  const railGap = tokens.space.sm;
  const media = useMemo(() => collectionMediaReference(collection), [collection]);
  const products = collection.products;
  const groupInsights = shouldGroupProductInsights(products.length);
  const insightProducts = useMemo(
    () => products.filter((product) => Boolean(product.catalogProductId)),
    [products],
  );
  const verification = useMemo(
    () => collectionVerificationSummary(products),
    [products],
  );
  const verificationLabel = verificationSummaryLabel(verification);
  const verificationCheckedOn = formatCollectionDate(verification.lastVerifiedAt);

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

  const onBuy = useCallback(
    async (product: CatalogProductViewModel) => {
      if (!product.catalogProductId) {
        Alert.alert('Link unavailable', 'No shopping destination is available for this product yet.');
        return;
      }
      try {
        await openProductShopping({
          catalogProductId: product.catalogProductId,
          collectionId: collection.collectionId,
          creatorId: collection.creator.id,
        });
      } catch {
        Alert.alert('Error', 'Could not open the product link.');
      }
    },
    [collection.collectionId, collection.creator.id],
  );

  const creatorHandle = collection.creator.username?.trim() || null;

  const openCreator = useCallback(() => {
    if (creatorHandle) {
      router.push(`/creator/${encodeURIComponent(creatorHandle)}`);
    }
  }, [creatorHandle, router]);

  const openDetails = useCallback((p: CatalogProductViewModel) => {
    setDetailsProduct(p);
    setDetailsVisible(true);
  }, []);

  const openAiReview = useCallback((p: CatalogProductViewModel) => {
    setAiReviewProduct(p);
    setAiReviewVisible(true);
  }, []);

  const onAiReviewResult = useCallback(
    (catalogProductId: string, result: ProductAiReviewResult) => {
      setAiResults((prev) => ({ ...prev, [catalogProductId]: result }));
    },
    [],
  );

  const onMerchantShortcut = useCallback(
    async (product: CatalogProductViewModel) => {
      await onBuy(product);
    },
    [onBuy],
  );

  const productCardProps = useCallback(
    (product: CatalogProductViewModel) => ({
      onPress: openDetails,
      onAddToCart: product.catalogProductId ? onAddToCart : undefined,
      onAiReview: product.catalogProductId ? openAiReview : undefined,
      onMerchantShortcut: product.catalogProductId ? onMerchantShortcut : undefined,
    }),
    [onAddToCart, onMerchantShortcut, openAiReview, openDetails],
  );

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
  /** Section heading → its content. */
  const sectionGap = { gap: tokens.space.sm };
  /** A product and its own AI Review read as one block, with room to breathe. */
  const productGap = { gap: tokens.space.md };

  return (
    <View style={[styles.root, { backgroundColor: tokens.color.canvas }]}>
      <CollectionPageHeader
        isSaved={isSaved}
        savePending={savePending}
        onSavePress={onSavePress}
        onSharePress={onSharePress}
        overflowItems={[
          { id: 'bag', label: 'View Bag', icon: 'bag-outline', onPress: () => router.push('/cart') },
        ]}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            paddingTop: tokens.space.md,
            paddingBottom: tokens.space.xxl,
            gap: tokens.space.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <CollectionHero
          collection={collection}
          onCreatorPress={creatorHandle ? openCreator : undefined}
          isFollowing={isFollowing}
          followPending={followPending}
          onFollowPress={!isSelf && onFollowPress ? onFollowPress : undefined}
        />

        {media ? (
          <CollectionMediaReference
            media={media}
            collection={collection}
            isActive={isFocused}
          />
        ) : null}

        <View style={sectionGap}>
          <SectionHeader title={productsSectionTitle(products.length)} />
          {products.length === 0 ? (
            <Text
              style={{
                color: muted,
                fontSize: tokens.fontSize.body,
                lineHeight: tokens.lineHeight.body,
              }}
            >
              No products in this collection yet.
            </Text>
          ) : (
            products.map((product) => (
              <View key={product.id} style={productGap}>
                <ProductCard
                  product={product}
                  variant="collection"
                  {...productCardProps(product)}
                />
                {!groupInsights && product.catalogProductId ? (
                  <ProductAiReviewCard
                    product={product}
                    variant="standalone"
                    onOpen={openAiReview}
                    onResult={onAiReviewResult}
                  />
                ) : null}
              </View>
            ))
          )}
        </View>

        {groupInsights && insightProducts.length > 0 ? (
          <View style={sectionGap}>
            <SectionHeader
              title={COLLECTION_SECTION_COPY.productInsights}
              subtitle="AI Review for each product in this collection"
            />
            {/* Multi-product Collections stack one AI Review per product. */}
            {insightProducts.map((product) => (
              <ProductAiReviewCard
                key={`insight-${product.id}`}
                product={product}
                variant="withProduct"
                onOpen={openAiReview}
                onResult={onAiReviewResult}
              />
            ))}
          </View>
        ) : null}

        {relatedLoading || relatedProducts.length > 0 ? (
          <View style={sectionGap}>
            <SectionHeader title={COLLECTION_PRODUCT_COPY.relatedProducts} />
            {relatedLoading && relatedProducts.length === 0 ? (
              <Text
                style={{
                  color: muted,
                  fontSize: tokens.fontSize.body,
                  lineHeight: tokens.lineHeight.body,
                }}
              >
                Loading related products…
              </Text>
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
                      onPress={openDetails}
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
              <Text
                style={{
                  color: muted,
                  fontSize: tokens.fontSize.body,
                  lineHeight: tokens.lineHeight.body,
                }}
              >
                Loading collections…
              </Text>
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
                    <CollectionTile
                      collection={item}
                      variant="creatorRail"
                      onPress={onPressCreatorCollection}
                    />
                  </View>
                ))}
              </ContentRail>
            )}
          </View>
        ) : null}

        {verificationLabel ? (
          <View
            style={[
              styles.trustCard,
              {
                backgroundColor: tokens.color.surface,
                borderColor: tokens.color.border,
                borderRadius: tokens.radius.xl,
                padding: tokens.space.md,
                gap: tokens.space.sm,
              },
            ]}
          >
            <Ionicons name="shield-checkmark" size={20} color={tokens.color.primary} />
            <View style={styles.trustCopy}>
              <Text
                style={{
                  color: tokens.color.text,
                  fontSize: tokens.fontSize.bodyStrong,
                  lineHeight: tokens.lineHeight.bodyStrong,
                  fontWeight: tokens.fontWeight.bold,
                }}
              >
                {verificationLabel}
              </Text>
              {verificationCheckedOn ? (
                <Text
                  style={{
                    color: muted,
                    fontSize: tokens.fontSize.caption,
                    lineHeight: tokens.lineHeight.caption,
                    marginTop: tokens.space.xxs / 2,
                  }}
                >
                  {`${COLLECTION_SECTION_COPY.lastVerified} ${verificationCheckedOn}`}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {exploreRows.length > 0 ? (
          <View style={sectionGap}>
            <SectionHeader title={COLLECTION_SECTION_COPY.exploreMore} />
            <ListRowGroup rows={exploreRows} />
          </View>
        ) : null}
      </ScrollView>

      <AiReviewSheet
        visible={aiReviewVisible}
        product={aiReviewProduct}
        preloaded={
          aiReviewProduct?.catalogProductId
            ? aiResults[aiReviewProduct.catalogProductId] ?? null
            : null
        }
        onClose={() => {
          setAiReviewVisible(false);
          setAiReviewProduct(null);
        }}
      />
      <ProductDetailsSheet
        visible={detailsVisible}
        product={detailsProduct}
        onClose={() => setDetailsVisible(false)}
        onAddToCart={detailsProduct?.catalogProductId ? onAddToCart : undefined}
        onBuy={detailsProduct?.catalogProductId ? onBuy : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    flexGrow: 1,
  },
  trustCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  trustCopy: {
    flex: 1,
    minWidth: 0,
  },
});
