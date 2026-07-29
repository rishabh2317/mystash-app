import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  Linking,
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
import { viewProductUrl } from '@/src/services/catalogProductMapper';
import { trackProductEvent } from '@/src/logging/productAnalytics';
import { MerchantSection } from './MerchantSection';
import { SpecificationGrid } from './SpecificationGrid';
import { VerificationBadge } from './VerificationBadge';
import type { ProductDetailsActionConfig } from './productDetailsActions';
import { NO_PRODUCT_DETAILS_ACTIONS } from './productDetailsActions';

const SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.9);

type Props = {
  visible: boolean;
  product: CatalogProductViewModel | null;
  isLight: boolean;
  onClose: () => void;
  actions?: ProductDetailsActionConfig;
};

export function ProductDetailsSheet({
  visible,
  product,
  isLight,
  onClose,
  actions = NO_PRODUCT_DETAILS_ACTIONS,
}: Props) {
  const insets = useSafeAreaInsets();
  const [descExpanded, setDescExpanded] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  useEffect(() => {
    if (visible && product) {
      setDescExpanded(false);
      setGalleryIndex(0);
      trackProductEvent('product.details.viewed', {
        catalogProductId: product.id,
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

  const buyUrl = viewProductUrl(product);
  const showPrice = !!product.price;
  const desc = product.description?.trim() || '';
  const needsReadMore = desc.length > 180;
  const descShown = descExpanded || !needsReadMore ? desc : `${desc.slice(0, 180).trim()}…`;

  const onViewProduct = async () => {
    if (!buyUrl) {
      Alert.alert('Link unavailable', 'No merchant or affiliate link for this product yet.');
      return;
    }
    trackProductEvent('product.view_product.clicked', { catalogProductId: product.id });
    try {
      await Linking.openURL(buyUrl);
    } catch {
      Alert.alert('Error', 'Could not open the product link.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              height: SHEET_HEIGHT,
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: isLight ? '#F8FAFC' : '#0B1220',
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: isLight ? '#CBD5E1' : '#475569' }]} />
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
              <Text style={[styles.dots, { color: isLight ? '#64748B' : '#94A3B8' }]}>
                {galleryIndex + 1} / {gallery.length}
              </Text>
            ) : null}

            <View style={styles.content}>
              {product.brand ? (
                <Text style={[styles.brand, { color: isLight ? '#64748B' : '#94A3B8' }]}>
                  {product.brand}
                </Text>
              ) : null}
              <Text style={[styles.title, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
                {product.title}
              </Text>
              <View style={styles.badgeRow}>
                <VerificationBadge status={product.verificationStatus} isLight={isLight} />
              </View>
              <Text style={[styles.merchantLine, { color: isLight ? '#475569' : '#CBD5E1' }]}>
                {product.merchant || 'Merchant pending'}
              </Text>
              {showPrice ? (
                <Text style={[styles.price, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
                  {product.currency ? `${product.currency} ` : ''}
                  {product.price}
                </Text>
              ) : null}
              {product.availability ? (
                <Text style={[styles.availability, { color: isLight ? '#64748B' : '#94A3B8' }]}>
                  {product.availability}
                </Text>
              ) : null}

              {desc ? (
                <View style={styles.descBlock}>
                  <Text style={[styles.sectionTitle, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
                    Description
                  </Text>
                  <Text style={[styles.desc, { color: isLight ? '#334155' : '#CBD5E1' }]}>
                    {descShown}
                  </Text>
                  {needsReadMore ? (
                    <TouchableOpacity onPress={() => setDescExpanded((v) => !v)}>
                      <Text style={{ color: isLight ? '#0284C7' : '#38BDF8', fontWeight: '700' }}>
                        {descExpanded ? 'Show less' : 'Read more'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              <SpecificationGrid specifications={product.specifications} isLight={isLight} />
              <MerchantSection product={product} isLight={isLight} />

              {/* Future commerce extension points (additive): ratings, offers, coupons, similar products */}

              <TouchableOpacity
                style={[styles.primaryCta, { backgroundColor: isLight ? '#0EA5E9' : '#A855F7' }]}
                onPress={onViewProduct}
                accessibilityRole="button"
                accessibilityLabel="View product in browser"
              >
                <Text style={styles.primaryCtaText}>View Product</Text>
              </TouchableOpacity>

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
                      <Text style={[styles.secondaryText, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
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
                      <Text style={[styles.secondaryText, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
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
                      <Text style={[styles.secondaryText, { color: isLight ? '#B91C1C' : '#FCA5A5' }]}>
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
  primaryCta: {
    marginTop: 24,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryCtaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  secondaryRow: { marginTop: 14, gap: 8 },
  secondaryBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '700' },
});
