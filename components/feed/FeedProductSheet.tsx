import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { mapFeedProductToCatalogViewModel } from '@/src/mappers/feedProductMapper';
import type { Product, Video } from '@/src/mocks/videos';
import { fetchLivePrices } from '@/src/services/livePricesApi';
import { fetchProductPage } from '@/src/services/productPageApi';
import { openProductShopping } from '@/src/services/shoppingClick';
import { typeStyle } from '@/src/theme/typography';
import type { LivePriceResult } from '@/src/types/livePrices';
import type { ProductPageOffer } from '@/src/types/productPage';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';
import {
  FEED_SHOP_COPY,
  feedShopPresentation,
  shoppableProductOffers,
} from '@/src/ui/feedShop';
import {
  PRODUCT_PAGE_COPY,
  productPageAvailabilityLabel,
  productPageOfferCta,
  productPagePriceFreshnessLabel,
  productPagePriceLabel,
} from '@/src/ui/productPage';

type OfferDisplay = ProductPageOffer & {
  freshness: 'loading' | 'live' | 'stale' | 'stored';
};

type Props = {
  video: Video | null;
  product: Product | null;
  visible: boolean;
  onClose: () => void;
};

function mergeLiveOffer(
  base: ProductPageOffer,
  live: LivePriceResult | undefined,
  loading: boolean,
): OfferDisplay {
  if (loading && !live) return { ...base, freshness: 'loading' };
  if (!live) return { ...base, freshness: 'stored' };
  if (live.source === 'live' && live.status === 'success' && live.price) {
    return {
      ...base,
      price: live.price,
      currency: live.currency ?? base.currency,
      availability: live.availability ?? base.availability,
      merchant: live.merchantName ?? base.merchant,
      freshness: 'live',
    };
  }
  return {
    ...base,
    price: live.price ?? base.price,
    currency: live.currency ?? base.currency,
    availability: live.availability ?? base.availability,
    merchant: live.merchantName ?? base.merchant,
    freshness: 'stale',
  };
}

/**
 * Home / focused-reel product shop.
 * One merchant → merchant-browser directly (no sheet).
 * Multiple → compact buy-options sheet with live prices when available.
 */
export function FeedProductSheet({ video, product, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const thin = useMemo(
    () => (product ? mapFeedProductToCatalogViewModel(product) : null),
    [product],
  );
  const catalogProductId = thin?.catalogProductId?.trim() || null;
  const [offers, setOffers] = useState<ProductPageOffer[]>([]);
  const [liveByOfferId, setLiveByOfferId] = useState<Record<string, LivePriceResult>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [sheetReady, setSheetReady] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const videoRef = useRef(video);
  videoRef.current = video;

  const openShopping = useCallback(async (offerId: string | null, catalogId: string) => {
    const v = videoRef.current;
    try {
      await openProductShopping({
        catalogProductId: catalogId,
        offerId,
        collectionId: v?.collection_id ?? null,
        videoId: v?.id ?? null,
        creatorId: v?.curator_id ?? null,
      });
    } catch {
      Alert.alert('Error', FEED_SHOP_COPY.openError);
    }
  }, []);

  useEffect(() => {
    if (!visible || !product) {
      setOffers([]);
      setLiveByOfferId({});
      setPricesLoading(false);
      setSheetReady(false);
      return;
    }
    const catalogId = product.catalog_product_id?.trim() || null;
    if (!catalogId) {
      Alert.alert('Link unavailable', FEED_SHOP_COPY.noMerchants);
      onCloseRef.current();
      return;
    }

    let cancelled = false;
    setSheetReady(false);
    setOffers([]);
    setLiveByOfferId({});

    void (async () => {
      try {
        const page = await fetchProductPage(catalogId);
        if (cancelled) return;
        const shoppable = shoppableProductOffers(page.offers);
        const mode = feedShopPresentation(shoppable.length);
        if (mode === 'direct') {
          await openShopping(shoppable[0]?.id ?? null, catalogId);
          if (!cancelled) onCloseRef.current();
          return;
        }
        if (mode === 'fallback') {
          await openShopping(null, catalogId);
          if (!cancelled) onCloseRef.current();
          return;
        }
        setOffers(shoppable);
        setSheetReady(true);
        setPricesLoading(true);
        try {
          const live = await fetchLivePrices(catalogId);
          if (cancelled) return;
          const map: Record<string, LivePriceResult> = {};
          for (const row of live.results) map[row.offerId] = row;
          setLiveByOfferId(map);
        } catch {
          /* stored offer prices remain */
        } finally {
          if (!cancelled) setPricesLoading(false);
        }
      } catch {
        if (cancelled) return;
        await openShopping(null, catalogId);
        if (!cancelled) onCloseRef.current();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, product, openShopping]);

  const displayOffers = useMemo(
    () => offers.map((offer) => mergeLiveOffer(offer, liveByOfferId[offer.id], pricesLoading)),
    [offers, liveByOfferId, pricesLoading],
  );

  const onOfferPress = useCallback(
    async (offerId: string) => {
      if (!catalogProductId) return;
      await openShopping(offerId, catalogProductId);
      onClose();
    },
    [catalogProductId, onClose, openShopping],
  );

  const showSheet = visible && sheetReady && displayOffers.length > 1;
  if (!showSheet) return null;

  return (
    <Modal visible={showSheet} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: tokens.overlay.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: '52%',
              paddingBottom: Math.max(insets.bottom, tokens.space.sm),
              paddingHorizontal: tokens.space.md,
              paddingTop: tokens.space.xs,
              borderTopLeftRadius: tokens.radius.xxl,
              borderTopRightRadius: tokens.radius.xxl,
              backgroundColor: tokens.color.canvas,
              gap: tokens.space.sm,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: tokens.color.border }]} />

          <View style={[styles.headerRow, { gap: tokens.space.xs }]}>
            <Text style={[typeStyle(tokens, 'sectionTitle'), styles.headerTitle]} numberOfLines={1}>
              {FEED_SHOP_COPY.sheetTitle}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={FEED_SHOP_COPY.closeA11y}
              hitSlop={hitSlopToMinTarget(32)}
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  borderRadius: tokens.radius.pill,
                  backgroundColor: tokens.color.surfaceSubtle,
                  borderColor: tokens.color.border,
                  borderWidth: tokens.stroke.hairline,
                  opacity: controlOpacity(
                    resolveControlPhase({ pressed }),
                    tokens.motion.pressOpacity,
                  ),
                },
              ]}
            >
              <Ionicons name="close-outline" size={18} color={tokens.color.icon} />
            </Pressable>
          </View>

          {thin?.title ? (
            <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={1}>
              {thin.title}
            </Text>
          ) : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: tokens.space.xs }}
          >
            {displayOffers.map((offer, index) => {
              const cta = productPageOfferCta(offer);
              const availability = productPageAvailabilityLabel(offer);
              const freshness =
                offer.freshness === 'loading' || offer.freshness === 'live'
                  ? productPagePriceFreshnessLabel(offer.freshness)
                  : null;
              const offerPrice = productPagePriceLabel(offer);
              const metaBits = [availability, freshness].filter(Boolean);
              return (
                <Pressable
                  key={offer.id}
                  onPress={() => void onOfferPress(offer.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${offer.merchant ?? 'Merchant'}${offerPrice ? `, ${offerPrice}` : ''}`}
                  style={({ pressed }) => [
                    styles.offerRow,
                    {
                      borderTopWidth: index === 0 ? StyleSheet.hairlineWidth : 0,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderColor: tokens.color.divider,
                      paddingVertical: tokens.space.sm,
                      opacity: controlOpacity(
                        resolveControlPhase({ pressed }),
                        tokens.motion.pressOpacity,
                      ),
                    },
                  ]}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={typeStyle(tokens, 'offerMerchant')} numberOfLines={1}>
                      {offer.merchant?.trim() || PRODUCT_PAGE_COPY.soldBy}
                    </Text>
                    {metaBits.length ? (
                      <View style={styles.metaRow}>
                        {offer.freshness === 'loading' ? (
                          <ActivityIndicator size="small" color={tokens.color.primary} />
                        ) : null}
                        <Text style={typeStyle(tokens, 'offerMeta')} numberOfLines={1}>
                          {metaBits.join(' · ')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.offerTrailing}>
                    {offerPrice ? (
                      <Text style={typeStyle(tokens, 'offerPrice')}>{offerPrice}</Text>
                    ) : null}
                    {cta ? (
                      <Text style={typeStyle(tokens, 'cta')}>{`${cta} →`}</Text>
                    ) : (
                      <Ionicons name="chevron-forward-outline" size={16} color={tokens.color.textMuted} />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  offerTrailing: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
