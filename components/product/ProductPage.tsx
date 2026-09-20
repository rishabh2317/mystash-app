import { Image } from 'expo-image';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { useRouter, type Href } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { AiReviewSheet } from '@/components/commerce/AiReviewSheet';
import { ProductCard } from '@/components/commerce/ProductCard';
import { ProductHeroImage } from '@/components/commerce/ProductHeroImage';
import { SpecificationGrid } from '@/components/commerce/SpecificationGrid';
import { ProductPageReviews } from '@/components/product/ProductPageReviews';
import { ProductSourceMedia } from '@/components/product/ProductSourceMedia';
import { ActionButton } from '@/components/ui/ActionButton';
import { ContentRail } from '@/components/ui/ContentRail';
import { ExpandableText } from '@/components/ui/ExpandableText';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import { hydrateSearchProducts } from '@/src/mappers/searchProductHydration';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { searchBlended } from '@/src/services/searchApi';
import { openProductShopping } from '@/src/services/shoppingClick';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { ProductPageView } from '@/src/types/productPage';
import { pickRelatedProducts } from '@/src/ui/collectionRelatedProducts';
import { BAG_COPY } from '@/src/ui/contracts';
import {
  PRODUCT_PAGE_COPY,
  catalogViewFromProductPage,
  productAiReviewFromPage,
  productPageAvailabilityLabel,
  productPageOfferCta,
  productPagePath,
  productPagePriceLabel,
  productPageSections,
  relatedMediaPath,
  relatedMediaWatchLabel,
  similarProductsQuery,
} from '@/src/ui/productPage';
import { comparePath } from '@/src/ui/productCompare';
import { railCardWidth } from '@/src/ui/rail';

type Props = {
  page: ProductPageView;
};

export function ProductPage({ page }: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { width: screenWidth } = useWindowDimensions();
  const onAddToCart = useProductAddToCartHandler();
  const product = useMemo(() => catalogViewFromProductPage(page), [page]);
  const sections = productPageSections(page);
  const priceLabel = productPagePriceLabel(page);
  const gutter = tokens.space.lg;
  const similarWidth = railCardWidth({
    screenWidth,
    gutter,
    gap: tokens.space.sm,
    visible: 2,
    peek: 28,
    minWidth: 140,
    maxWidth: 180,
  });

  const [similar, setSimilar] = useState<CatalogProductViewModel[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewResult = useMemo(() => productAiReviewFromPage(page), [page]);

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

  const onShop = async (offerId: string) => {
    try {
      await openProductShopping({
        catalogProductId: page.shoppingProductId ?? page.productId,
        offerId,
      });
    } catch {
      Alert.alert('Error', 'Could not open the product link.');
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingBottom: tokens.space.xxl,
        gap: tokens.space.lg,
      }}
    >
      <ProductHeroImage
        productId={page.productId}
        uri={page.heroImage ?? page.galleryImages[0] ?? null}
        alt={page.title}
        style={[styles.hero, { borderRadius: tokens.radius.xl }]}
      />

      <View style={{ gap: tokens.space.xxs }}>
        {page.brand ? (
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.micro,
              fontWeight: tokens.fontWeight.bold,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            {page.brand}
          </Text>
        ) : null}
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.headline,
            lineHeight: tokens.lineHeight.headline,
            fontWeight: tokens.fontWeight.extraBold,
          }}
        >
          {page.title}
        </Text>
        {priceLabel ? (
          <Text
            style={{
              color: tokens.color.primary,
              fontSize: tokens.fontSize.title,
              fontWeight: tokens.fontWeight.extraBold,
            }}
          >
            {priceLabel}
          </Text>
        ) : null}
      </View>

      {sections.offers ? (
        <View style={{ gap: tokens.space.sm }}>
          <SectionHeader title={PRODUCT_PAGE_COPY.offers} />
          {page.offers.map((offer) => {
            const cta = productPageOfferCta(offer);
            const availability = productPageAvailabilityLabel(offer);
            return (
              <View
                key={offer.id}
                style={[
                  styles.offer,
                  {
                    backgroundColor: tokens.color.surface,
                    borderColor: tokens.color.border,
                    borderRadius: tokens.radius.xl,
                    padding: tokens.space.md,
                    gap: tokens.space.xs,
                  },
                ]}
              >
                <View style={styles.offerRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    {offer.merchant ? (
                      <Text style={{ color: tokens.color.text, fontWeight: tokens.fontWeight.extraBold }}>
                        {offer.merchant}
                      </Text>
                    ) : null}
                    {availability ? (
                      <Text style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.micro }}>
                        {availability}
                      </Text>
                    ) : null}
                  </View>
                  {offer.price ? (
                    <Text
                      style={{
                        color: tokens.color.text,
                        fontSize: tokens.fontSize.title,
                        fontWeight: tokens.fontWeight.extraBold,
                      }}
                    >
                      {productPagePriceLabel(offer)}
                    </Text>
                  ) : null}
                </View>
                {cta ? (
                  <ActionButton label={cta} onPress={() => void onShop(offer.id)} variant="filled" />
                ) : null}
              </View>
            );
          })}
          {page.shoppingProductId ? (
            <ActionButton
              label={BAG_COPY.add}
              onPress={() => void onAddToCart(product)}
              variant="secondary"
            />
          ) : null}
        </View>
      ) : page.shoppingProductId ? (
        <ActionButton label={BAG_COPY.add} onPress={() => void onAddToCart(product)} variant="secondary" />
      ) : null}

      {page.source ? (
        <View style={{ gap: tokens.space.sm }}>
          <SectionHeader title={PRODUCT_PAGE_COPY.discovery} subtitle={page.source.label} />
          <ProductSourceMedia source={page.source} />
        </View>
      ) : null}

      {sections.relatedMedia ? (
        <View style={{ gap: tokens.space.sm }}>
          <SectionHeader title={PRODUCT_PAGE_COPY.relatedMedia} />
          <ContentRail gutter={gutter} itemPitch={similarWidth + tokens.space.sm}>
            {page.relatedMedia.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  const path = relatedMediaPath(item);
                  if (path) {
                    router.push(path as Href);
                    return;
                  }
                  void openBrowserAsync(item.url, {
                    presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
                  });
                }}
                style={[
                  styles.relatedCard,
                  {
                    width: similarWidth,
                    backgroundColor: tokens.color.surface,
                    borderColor: tokens.color.border,
                    borderRadius: tokens.radius.lg,
                  },
                ]}
              >
                {item.thumbnailUrl ? (
                  <Image source={{ uri: item.thumbnailUrl }} style={styles.relatedThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.relatedThumb, { backgroundColor: tokens.color.border }]} />
                )}
                <View style={{ padding: tokens.space.sm, gap: 2 }}>
                  <Text style={{ color: tokens.color.text, fontWeight: tokens.fontWeight.bold }} numberOfLines={2}>
                    {item.title ?? item.label}
                  </Text>
                  <Text style={{ color: tokens.color.primary }}>{relatedMediaWatchLabel(item.kind)}</Text>
                </View>
              </Pressable>
            ))}
          </ContentRail>
        </View>
      ) : null}

      {sections.reviews && page.reviews ? (
        <ProductPageReviews
          reviews={page.reviews}
          onReadReviews={page.shoppingProductId ? () => setReviewOpen(true) : undefined}
        />
      ) : null}

      {similar.length > 0 ? (
        <View style={{ gap: tokens.space.sm }}>
          <SectionHeader title={PRODUCT_PAGE_COPY.similar} />
          <ContentRail gutter={gutter} itemPitch={similarWidth + tokens.space.sm}>
            {similar.map((item) => (
              <View key={item.id} style={{ width: similarWidth }}>
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

      <View style={{ gap: tokens.space.xs }}>
        <SectionHeader title={PRODUCT_PAGE_COPY.compare} subtitle={PRODUCT_PAGE_COPY.compareHint} />
        <ActionButton
          label={PRODUCT_PAGE_COPY.compare}
          onPress={() => router.push(comparePath([page.productId]) as Href)}
          variant="quiet"
        />
      </View>

      {sections.description && page.description ? (
        <View style={{ gap: tokens.space.sm }}>
          <SectionHeader title={PRODUCT_PAGE_COPY.details} />
          <ExpandableText
            text={page.description}
            collapsedLines={4}
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.body,
              lineHeight: tokens.lineHeight.body,
            }}
          />
        </View>
      ) : null}

      {sections.specs ? (
        <View style={{ gap: tokens.space.sm }}>
          <SectionHeader title={PRODUCT_PAGE_COPY.specs} />
          <SpecificationGrid specifications={page.specifications} />
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
  hero: {
    width: '100%',
    aspectRatio: 1,
  },
  offer: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  relatedCard: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  relatedThumb: {
    width: '100%',
    aspectRatio: 9 / 16,
  },
});
