import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';
import { trackProductEvent } from '@/src/logging/productAnalytics';
import { MerchantSection } from './MerchantSection';
import { SpecificationGrid } from './SpecificationGrid';
import { VerificationBadge } from './VerificationBadge';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { AddToCartOutcome } from '@/src/services/productActionOrchestration';
import { BAG_COPY } from '@/src/ui/contracts';
import { AddToCartButton } from './AddToCartButton';
import type { ProductDetailsActionConfig } from './productDetailsActions';
import { NO_PRODUCT_DETAILS_ACTIONS } from './productDetailsActions';

const SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.9);

type Props = {
  visible: boolean;
  product: CatalogProductViewModel | null;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  onClose: () => void;
  actions?: ProductDetailsActionConfig;
  /**
   * Parent owns shopping redirect via shoppingClick.
   * ProductDetailsSheet never calls openProductShopping directly.
   */
  onBuy?: (product: CatalogProductViewModel) => void;
  /**
   * Parent owns auth + Cart boundary.
   * Only rendered when provided and catalogProductId is present.
   */
  onAddToCart?: (product: CatalogProductViewModel) => AddToCartOutcome | Promise<AddToCartOutcome>;
};

export function ProductDetailsSheet({
  visible,
  product,
  onClose,
  actions = NO_PRODUCT_DETAILS_ACTIONS,
  onBuy,
  onAddToCart,
}: Props) {
  const insets = useSafeAreaInsets();
  const { tokens, isLight } = useThemeMode();
  const [descExpanded, setDescExpanded] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  useEffect(() => {
    if (visible && product) {
      setDescExpanded(false);
      setGalleryIndex(0);
      trackProductEvent('product.details.viewed', {
        catalogProductId: product.catalogProductId,
        verificationStatus: product.verificationStatus,
      });
    }
  }, [visible, product?.id]);

  const gallery = useMemo(() => {
    if (!product) return [CATALOG_IMAGE_PLACEHOLDER];
    const imgs = product.galleryImages.filter((u) => u.startsWith('http'));
    if (imgs.length) return imgs;
    if (product.heroImage?.startsWith('http')) return [product.heroImage];
    return [CATALOG_IMAGE_PLACEHOLDER];
  }, [product]);

  if (!product) return null;

  const showPrice = !!product.price;
  const desc = product.description?.trim() || '';
  const needsReadMore = desc.length > 180;
  const descShown = descExpanded || !needsReadMore ? desc : `${desc.slice(0, 180).trim()}…`;
  const canShop = !!product.catalogProductId;
  const showBuy = !!onBuy && canShop;
  const showAddToCart = !!onAddToCart && canShop;

  const onViewProduct = () => {
    if (!product.catalogProductId) {
      Alert.alert('Link unavailable', 'No shopping destination is available for this product yet.');
      return;
    }
    if (!onBuy) return;
    trackProductEvent('product.view_product.clicked', {
      catalogProductId: product.catalogProductId,
    });
    onBuy(product);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: tokens.overlay.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              height: SHEET_HEIGHT,
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: tokens.color.canvasSoft,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: tokens.color.textMuted }]} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
          >
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const w = Dimensions.get('window').width;
                const i = Math.round(e.nativeEvent.contentOffset.x / w);
                setGalleryIndex(i);
              }}
              style={styles.carousel}
            >
              {gallery.map((uri, i) => (
                <Image
                  key={`${uri}-${i}`}
                  source={{ uri }}
                  style={styles.hero}
                  contentFit="cover"
                  accessibilityLabel={`${product.title} image ${i + 1}`}
                />
              ))}
            </ScrollView>
            {gallery.length > 1 ? (
              <Text style={[styles.dots, { color: tokens.color.textMuted }]}>
                {galleryIndex + 1} / {gallery.length}
              </Text>
            ) : null}

            <View style={styles.content}>
              {product.brand ? (
                <Text style={[styles.brand, { color: tokens.color.textMuted }]}>
                  {product.brand}
                </Text>
              ) : null}
              <Text style={[styles.title, { color: tokens.color.text }]}>
                {product.title}
              </Text>
              <View style={styles.badgeRow}>
                <VerificationBadge status={product.verificationStatus} isLight={isLight} />
              </View>
              <Text style={[styles.merchantLine, { color: tokens.color.textMuted }]}>
                {product.merchant || 'Merchant pending'}
              </Text>
              {showPrice ? (
                <Text style={[styles.price, { color: tokens.color.text }]}>
                  {product.currency ? `${product.currency} ` : ''}
                  {product.price}
                </Text>
              ) : null}
              {product.availability ? (
                <Text style={[styles.availability, { color: tokens.color.textMuted }]}>
                  {product.availability}
                </Text>
              ) : null}

              {desc ? (
                <View style={styles.descBlock}>
                  <Text style={[styles.sectionTitle, { color: tokens.color.text }]}>
                    Description
                  </Text>
                  <Text style={[styles.desc, { color: tokens.color.textMuted }]}>
                    {descShown}
                  </Text>
                  {needsReadMore ? (
                    <TouchableOpacity onPress={() => setDescExpanded((v) => !v)}>
                      <Text style={{ color: tokens.color.accent, fontWeight: '700' }}>
                        {descExpanded ? 'Show less' : 'Read more'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              <SpecificationGrid specifications={product.specifications} isLight={isLight} />
              <MerchantSection product={product} isLight={isLight} />

              {/* Future commerce extension points (additive): ratings, offers, coupons, similar products */}

              {showAddToCart && onAddToCart ? (
                <AddToCartButton
                  product={product}
                  variant="sheet"
                  onAddToCart={onAddToCart}
                />
              ) : null}

              {showBuy ? (
                <TouchableOpacity
                  style={[
                    styles.secondaryCta,
                    {
                      borderColor: tokens.color.borderStrong,
                      borderRadius: tokens.radius.md,
                    },
                  ]}
                  onPress={onViewProduct}
                  accessibilityRole="button"
                  accessibilityLabel={`${BAG_COPY.buy} ${product.title}`}
                >
                  <Text style={[styles.secondaryCtaText, { color: tokens.color.text }]}>
                    {BAG_COPY.buy}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {actions.enabled.length > 0 ? (
                <View style={styles.secondaryRow}>
                  {actions.enabled.includes('replace') && actions.onReplace ? (
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => {
                        trackProductEvent('product.replaced', { catalogProductId: product.id });
                        actions.onReplace?.(product);
                      }}
                    >
                      <Text style={[styles.secondaryText, { color: tokens.color.text }]}>
                        Replace Product
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {actions.enabled.includes('refresh') && actions.onRefresh ? (
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => {
                        trackProductEvent('product.metadata.refreshed', {
                          catalogProductId: product.id,
                        });
                        actions.onRefresh?.(product);
                      }}
                    >
                      <Text style={[styles.secondaryText, { color: tokens.color.text }]}>
                        Refresh Metadata
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {actions.enabled.includes('remove') && actions.onRemove ? (
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => {
                        trackProductEvent('product.removed', { catalogProductId: product.id });
                        actions.onRemove?.(product);
                      }}
                    >
                      <Text style={[styles.secondaryText, { color: tokens.color.danger }]}>
                        Remove Product
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 6,
  },
  scroll: { paddingBottom: 24 },
  carousel: { maxHeight: 280 },
  hero: {
    width: Dimensions.get('window').width,
    height: 280,
    backgroundColor: 'rgba(128,128,128,0.2)',
  },
  dots: { textAlign: 'center', fontSize: 12, marginTop: 6, fontWeight: '600' },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  brand: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 22, fontWeight: '900', marginTop: 4, lineHeight: 28 },
  badgeRow: { marginTop: 8 },
  merchantLine: { marginTop: 8, fontSize: 14, fontWeight: '600' },
  price: { marginTop: 8, fontSize: 20, fontWeight: '800' },
  availability: { marginTop: 4, fontSize: 13 },
  descBlock: { marginTop: 18, gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  desc: { fontSize: 14, lineHeight: 21 },
  secondaryCta: {
    marginTop: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryCtaText: { fontWeight: '800', fontSize: 16 },
  secondaryRow: { marginTop: 14, gap: 8 },
  secondaryBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '700' },
});
