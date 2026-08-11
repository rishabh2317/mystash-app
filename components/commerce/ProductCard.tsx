import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { trackProductEvent } from '@/src/logging/productAnalytics';
import { ProductHeroImage } from './ProductHeroImage';
import { VerificationBadge } from './VerificationBadge';

export type ProductCardVariant = 'compact' | 'standard';

type Props = {
  product: CatalogProductViewModel;
  isLight: boolean;
  onPress: (product: CatalogProductViewModel) => void;
  /** Defaults to `standard` for backward compatibility. */
  variant?: ProductCardVariant;
  /**
   * Optional. When provided, Add to Cart action UI is rendered.
   * Parent owns auth / Cart orchestration — ProductCard never calls auth or Cart APIs.
   */
  onAddToCart?: (product: CatalogProductViewModel) => void;
  /**
   * Optional. When provided, Buy action UI is rendered.
   * Parent owns shopping redirect — ProductCard never calls openProductShopping.
   */
  onBuy?: (product: CatalogProductViewModel) => void;
};

export function ProductCard({
  product,
  isLight,
  onPress,
  variant = 'standard',
  onAddToCart,
  onBuy,
}: Props) {
  useEffect(() => {
    trackProductEvent('product.card.viewed', {
      catalogProductId: product.catalogProductId ?? product.id,
      verificationStatus: product.verificationStatus,
    });
  }, [product.id, product.catalogProductId, product.verificationStatus]);

  const showPrice =
    product.verificationStatus === 'VERIFIED' && !!product.price && product.price !== '—';
  const canShop = !!product.catalogProductId;
  const showAddToCart = !!onAddToCart && canShop;
  const showBuy = !!onBuy && canShop;
  const showActions = showAddToCart || showBuy;
  const isCompact = variant === 'compact';

  return (
    <View
      style={[
        styles.card,
        isCompact && styles.cardCompact,
        {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
          backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.06)',
        },
      ]}
    >
      <Pressable
        onPress={() => {
          trackProductEvent('product.card.opened', {
            catalogProductId: product.catalogProductId ?? product.id,
          });
          onPress(product);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${product.title}${product.brand ? `, ${product.brand}` : ''}. Open product details.`}
        style={({ pressed }) => [styles.pressableRow, { opacity: pressed ? 0.92 : 1 }]}
      >
        <ProductHeroImage
          productId={product.id}
          uri={displayHeroUri(product)}
          alt={product.title}
          style={isCompact ? styles.thumbCompact : styles.thumb}
        />
        <View style={styles.body}>
          {!isCompact && product.brand ? (
            <Text style={[styles.brand, { color: isLight ? '#64748B' : '#94A3B8' }]} numberOfLines={1}>
              {product.brand}
            </Text>
          ) : null}
          <Text
            style={[
              isCompact ? styles.titleCompact : styles.title,
              { color: isLight ? '#0F172A' : '#F8FAFC' },
            ]}
            numberOfLines={isCompact ? 1 : 2}
          >
            {product.title}
          </Text>
          {!isCompact ? (
            <View style={styles.metaRow}>
              <VerificationBadge status={product.verificationStatus} isLight={isLight} />
            </View>
          ) : null}
          <Text
            style={[styles.merchant, { color: isLight ? '#475569' : '#CBD5E1' }]}
            numberOfLines={1}
          >
            {isCompact
              ? showPrice
                ? `${product.currency ? `${product.currency} ` : ''}${product.price}`
                : product.merchant || 'Merchant pending'
              : `${product.merchant || 'Merchant pending'}${
                  showPrice ? ` · ${product.currency ? `${product.currency} ` : ''}${product.price}` : ''
                }`}
          </Text>
        </View>
      </Pressable>

      {showActions ? (
        <View style={styles.actionsRow}>
          {showBuy ? (
            <Pressable
              onPress={() => onBuy?.(product)}
              accessibilityRole="button"
              accessibilityLabel={`Buy ${product.title}`}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.buyBtn,
                {
                  backgroundColor: isLight ? '#0EA5E9' : '#A855F7',
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text style={styles.actionBtnText}>Buy</Text>
            </Pressable>
          ) : null}
          {showAddToCart ? (
            <Pressable
              onPress={() => onAddToCart?.(product)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${product.title} to cart`}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.addBtn,
                {
                  borderColor: isLight ? '#0F172A' : '#F8FAFC',
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text style={[styles.addBtnText, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
                Add to Cart
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    padding: 10,
    gap: 10,
  },
  cardCompact: {
    padding: 8,
    gap: 8,
  },
  pressableRow: {
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 10,
  },
  thumbCompact: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  body: { flex: 1, justifyContent: 'center', gap: 4 },
  brand: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { fontSize: 15, fontWeight: '800', lineHeight: 20 },
  titleCompact: { fontSize: 13, fontWeight: '800', lineHeight: 17 },
  metaRow: { marginTop: 2 },
  merchant: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  buyBtn: {},
  addBtn: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  actionBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  addBtnText: { fontWeight: '800', fontSize: 13 },
});
