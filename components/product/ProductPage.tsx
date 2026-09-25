import { useRouter, type Href } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { AiReviewSheet } from '@/components/commerce/AiReviewSheet';
import { ProductAiReviewCard } from '@/components/commerce/ProductAiReviewCard';
import { ProductCard } from '@/components/commerce/ProductCard';
import { ProductHeroImage } from '@/components/commerce/ProductHeroImage';
import { PublicCollectionTile } from '@/components/collection/PublicCollectionTile';
import { ContentRail } from '@/components/ui/ContentRail';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { hydrateSearchProducts } from '@/src/mappers/searchProductHydration';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { fetchLivePrices } from '@/src/services/livePricesApi';
import { searchBlended } from '@/src/services/searchApi';
import { openProductShopping } from '@/src/services/shoppingClick';
import { getCommerceCountry } from '@/src/services/commerceCountry';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { LivePriceResult } from '@/src/types/livePrices';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { ProductPageOffer, ProductPageRelatedMedia, ProductPageView } from '@/src/types/productPage';
import { pickRelatedProducts } from '@/src/ui/collectionRelatedProducts';
import { BAG_COPY } from '@/src/ui/contracts';
import {
  PRODUCT_PAGE_COPY,
  catalogViewFromProductPage,
  collectionViewFromRelatedMedia,
  featuredMediaFromPage,
  productAiReviewFromPage,
  productPageAvailabilityLabel,
  productPageBestPriceLabel,
  productPageBuyingFreshnessLine,
  productPageOfferCta,
  productPagePath,
  productPagePriceFreshnessLabel,
  productPagePriceLabel,
  productPagePricesFromLabel,
  productPageSections,
  relatedMediaPath,
  similarProductsQuery,
} from '@/src/ui/productPage';
import { comparePath } from '@/src/ui/productCompare';
import { railCardWidth } from '@/src/ui/rail';

type Props = {
  page: ProductPageView;
};

type OfferDisplay = ProductPageOffer & {
  freshness: 'loading' | 'live' | 'stale' | 'stored';
  merchantUrl?: string | null;
};

const IDENTITY_IMAGE = 128;
const GUTTER = 16;
const CREATOR_RAIL = { visible: 2.35, peek: 32, minWidth: 118, maxWidth: 172 };
const RELATED_RAIL = { visible: 2.4, peek: 20, minWidth: 118, maxWidth: 148 };

function mergeLiveOffer(
  base: ProductPageOffer,
  live: LivePriceResult | undefined,
  loading: boolean,
): OfferDisplay {
  if (loading && !live) {
    return { ...base, freshness: 'loading' };
  }
  if (!live) {
    return { ...base, freshness: 'stored' };
  }
  if (live.source === 'live' && live.status === 'success' && live.price) {
    return {
      ...base,
      price: live.price,
      currency: live.currency ?? base.currency,
      availability: live.availability ?? base.availability,
      merchant: live.merchantName ?? base.merchant,
      freshness: 'live',
      merchantUrl: live.merchantUrl,
    };
  }
  return {
    ...base,
    price: live.price ?? base.price,
    currency: live.currency ?? base.currency,
    availability: live.availability ?? base.availability,
    merchant: live.merchantName ?? base.merchant,
    freshness: 'stale',
    merchantUrl: live.merchantUrl,
  };
}

export function ProductPage({ page }: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { width: screenWidth } = useWindowDimensions();
  const onAddToCart = useProductAddToCartHandler();
  const product = useMemo(() => catalogViewFromProductPage(page), [page]);
  const sections = productPageSections(page);
  const priceLabel = productPagePriceLabel(page);
  // Catalogue shopping id when linked; otherwise discovered id for on-demand AI Review.
  const showAiBanner = Boolean(page.shoppingProductId ?? page.productId);

  const relatedWidth = railCardWidth({
    screenWidth,
    gutter: GUTTER,
    gap: tokens.space.sm,
    visible: RELATED_RAIL.visible,
    peek: RELATED_RAIL.peek,
    minWidth: RELATED_RAIL.minWidth,
    maxWidth: RELATED_RAIL.maxWidth,
  });
  const creatorCardWidth = railCardWidth({
    screenWidth,
    gutter: GUTTER,
    gap: tokens.space.sm,
    ...CREATOR_RAIL,
  });

  const [similar, setSimilar] = useState<CatalogProductViewModel[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [liveByOfferId, setLiveByOfferId] = useState<Record<string, LivePriceResult>>({});
  const [pricesLoading, setPricesLoading] = useState(page.offers.length > 0);
  const [countryCtx, setCountryCtx] = useState<{
    country: string;
    profileCountry: string | null;
    locale: string | null;
  } | null>(null);
  const reviewResult = useMemo(() => productAiReviewFromPage(page), [page]);

  const featuredItems = useMemo(() => featuredMediaFromPage(page), [page]);

  const featuredCollections = useMemo(
    () =>
      featuredItems.map((item) => ({
        media: item,
        collection: collectionViewFromRelatedMedia(item),
      })),
    [featuredItems],
  );

  const displayOffers = useMemo(
    () => page.offers.map((offer) => mergeLiveOffer(offer, liveByOfferId[offer.id], pricesLoading)),
    [page.offers, liveByOfferId, pricesLoading],
  );

  const buyingSummary =
    productPageBestPriceLabel(displayOffers) ?? productPagePricesFromLabel(displayOffers);
  const buyingFreshness = productPageBuyingFreshnessLine(displayOffers.map((o) => o.freshness));

  useEffect(() => {
    if (!sections.similar) {
      setSimilar([]);
      return;
    }
    const query = similarProductsQuery(page);
    if (!query) {
      setSimilar([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await searchBlended({ q: query, presentation: 'typed', limit: 16 });
        const cards = res.lanes?.products ?? res.results.filter((row) => row.entityType === 'product');
        const hydrated = await hydrateSearchProducts(cards);
        if (cancelled) return;
        setSimilar(
          pickRelatedProducts(hydrated, new Set([page.productId, page.shoppingProductId ?? '']), 8),
        );
      } catch {
        if (!cancelled) setSimilar([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, sections.similar]);

  useEffect(() => {
    if (page.offers.length === 0) {
      setPricesLoading(false);
      return;
    }
    let cancelled = false;
    setPricesLoading(true);
    void (async () => {
      try {
        const geo = await getCommerceCountry();
        if (cancelled) return;
        setCountryCtx(geo);
        const live = await fetchLivePrices(page.productId, {
          country: geo.country,
          profileCountry: geo.profileCountry,
          locale: geo.locale,
        });
        if (cancelled) return;
        const map: Record<string, LivePriceResult> = {};
        for (const row of live.results) map[row.offerId] = row;
        setLiveByOfferId(map);
      } catch {
        if (!cancelled) setLiveByOfferId({});
      } finally {
        if (!cancelled) setPricesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page.productId, page.offers]);

  const onShop = async (offerId: string) => {
    try {
      await openProductShopping({
        catalogProductId: page.shoppingProductId ?? page.productId,
        offerId,
        country: countryCtx?.country,
        profileCountry: countryCtx?.profileCountry,
        locale: countryCtx?.locale,
      });
    } catch {
      Alert.alert('Error', 'Could not open the product link.');
    }
  };

  const onFeaturedPress = (
    collection: CollectionViewModel,
    media: ProductPageRelatedMedia,
  ) => {
    const path = relatedMediaPath(media);
    if (path) {
      router.push(path as Href);
    }
    // No external YouTube/Instagram handoff — in-app reel only.
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: GUTTER,
        paddingTop: tokens.space.md,
        paddingBottom: tokens.space.xxl,
        gap: tokens.space.xl,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. Compact product identity */}
      <View style={[styles.identity, { gap: tokens.space.md }]}>
        <View
          style={[
            styles.identityImageWrap,
            {
              padding: 4,
              borderRadius: tokens.radius.lg,
              ...outlineCardChrome(tokens),
            },
          ]}
        >
          <ProductHeroImage
            productId={page.productId}
            uri={page.heroImage ?? page.galleryImages[0] ?? null}
            alt={page.title}
            style={[
              styles.identityImage,
              {
                width: IDENTITY_IMAGE,
                height: IDENTITY_IMAGE,
                borderRadius: tokens.radius.md,
                backgroundColor: tokens.color.surfaceSubtle,
              },
            ]}
          />
        </View>
        <View style={[styles.identityCopy, { gap: tokens.space.xxs }]}>
          {page.brand ? <Text style={typeStyle(tokens, 'identityBrand')}>{page.brand}</Text> : null}
          <Text style={typeStyle(tokens, 'identityTitle')} numberOfLines={3}>
            {page.title}
          </Text>
          {page.category?.trim() ? (
            <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
              {page.category.trim()}
            </Text>
          ) : null}
          {page.description?.trim() ? (
            <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={2}>
              {page.description.trim()}
            </Text>
          ) : null}
          {page.detailsUpdating ? (
            <View style={styles.updatingRow}>
              <ActivityIndicator size="small" color={tokens.color.primary} />
              <Text style={typeStyle(tokens, 'tileMeta')}>{PRODUCT_PAGE_COPY.detailsUpdating}</Text>
            </View>
          ) : null}
          {priceLabel && !sections.offers ? (
            <Text style={typeStyle(tokens, 'tilePrice')}>{priceLabel}</Text>
          ) : null}
          {page.shoppingProductId ? (
            <Pressable
              onPress={() => void onAddToCart(product)}
              accessibilityRole="button"
              accessibilityLabel={BAG_COPY.add}
              style={{ marginTop: tokens.space.xs }}
            >
              <Text style={typeStyle(tokens, 'link')}>{BAG_COPY.add}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 2. Buying options */}
      {sections.offers ? (
        <View style={{ gap: tokens.space.sm }}>
          <Text style={typeStyle(tokens, 'sectionTitle')}>{PRODUCT_PAGE_COPY.offers}</Text>
          {buyingSummary ? <Text style={typeStyle(tokens, 'bodyMuted')}>{buyingSummary}</Text> : null}
          {buyingFreshness ? <Text style={typeStyle(tokens, 'tileMeta')}>{buyingFreshness}</Text> : null}

          <View style={{ marginTop: tokens.space.xs }}>
            {displayOffers.map((offer, index) => {
              const cta = productPageOfferCta(offer);
              const availability = productPageAvailabilityLabel(offer);
              const freshness =
                offer.freshness === 'loading'
                  ? productPagePriceFreshnessLabel(offer.freshness)
                  : null;
              const offerPrice = productPagePriceLabel(offer);
              const metaBits = [availability, freshness].filter(Boolean);
              return (
                <View
                  key={offer.id}
                  style={[
                    styles.offerRow,
                    {
                      borderTopWidth: index === 0 ? StyleSheet.hairlineWidth : 0,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderColor: tokens.color.divider,
                      paddingVertical: tokens.space.md,
                      gap: tokens.space.sm,
                    },
                  ]}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={typeStyle(tokens, 'offerMerchant')} numberOfLines={1}>
                      {offer.merchant?.trim() || PRODUCT_PAGE_COPY.soldBy}
                    </Text>
                    {metaBits.length ? (
                      <View style={styles.freshnessRow}>
                        {offer.freshness === 'loading' ? (
                          <ActivityIndicator size="small" color={tokens.color.primary} />
                        ) : null}
                        <Text style={typeStyle(tokens, 'offerMeta')} numberOfLines={1}>
                          {metaBits.join(' · ')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {offerPrice ? (
                      <Text style={typeStyle(tokens, 'offerPrice')}>{offerPrice}</Text>
                    ) : null}
                    {cta ? (
                      <Pressable
                        onPress={() => void onShop(offer.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`${cta} at ${offer.merchant ?? 'merchant'}`}
                      >
                        <Text style={typeStyle(tokens, 'cta')}>{`${cta} →`}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* 3. AI review — catalogue or discovered (on-demand) */}
      {showAiBanner ? (
        <ProductAiReviewCard
          product={product}
          variant="standalone"
          preloaded={reviewResult}
          onOpen={() => setReviewOpen(true)}
        />
      ) : null}

      {/* 4. Featured — discovery + related collections */}
      {sections.featured ? (
        <View style={{ gap: tokens.space.sm }}>
          <Text style={typeStyle(tokens, 'sectionTitle')}>{PRODUCT_PAGE_COPY.relatedMedia}</Text>
          <ContentRail gutter={GUTTER} itemPitch={creatorCardWidth + tokens.space.sm} itemGap={tokens.space.sm}>
            {featuredCollections.map(({ media, collection }, index) => (
              <View
                key={media.id}
                style={{
                  width: creatorCardWidth,
                  gap: tokens.space.xxs,
                }}
              >
                {media.fromDiscovery ? (
                  <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
                    {PRODUCT_PAGE_COPY.discoveryTag}
                  </Text>
                ) : (
                  <View style={{ height: tokens.lineHeight.micro }} />
                )}
                <PublicCollectionTile
                  collection={collection}
                  onPress={(next) => onFeaturedPress(next, media)}
                />
              </View>
            ))}
          </ContentRail>
        </View>
      ) : null}

      {/* 5. Related products */}
      {similar.length > 0 ? (
        <View style={{ gap: tokens.space.sm }}>
          <Text style={typeStyle(tokens, 'sectionTitle')}>{PRODUCT_PAGE_COPY.similar}</Text>
          <ContentRail gutter={GUTTER} itemPitch={relatedWidth + tokens.space.sm}>
            {similar.map((item, index) => (
              <View
                key={item.id}
                style={{
                  width: relatedWidth,
                  marginRight: index === similar.length - 1 ? 0 : tokens.space.sm,
                }}
              >
                <ProductCard
                  product={item}
                  variant="related"
                  showIndexPrice
                  onPress={(next) => {
                    const id = next.catalogProductId ?? next.id;
                    if (id) router.push(productPagePath(id) as Href);
                  }}
                />
              </View>
            ))}
          </ContentRail>
        </View>
      ) : null}

      {/* 6. Compare — quiet, gated */}
      {sections.compare ? (
        <View style={{ gap: tokens.space.xs }}>
          <Pressable
            onPress={() => router.push(comparePath([page.productId]) as Href)}
            accessibilityRole="button"
            accessibilityLabel={PRODUCT_PAGE_COPY.compare}
          >
            <Text style={typeStyle(tokens, 'link')}>{`${PRODUCT_PAGE_COPY.compare} →`}</Text>
          </Pressable>
          <Text style={typeStyle(tokens, 'tileMeta')}>{PRODUCT_PAGE_COPY.compareHint}</Text>
        </View>
      ) : null}

      <AiReviewSheet
        visible={reviewOpen}
        product={product}
        onClose={() => setReviewOpen(false)}
        preloaded={reviewResult}
        hideInternalStatus
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  identityImageWrap: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  identityImage: {
    overflow: 'hidden',
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  freshnessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  updatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
});
