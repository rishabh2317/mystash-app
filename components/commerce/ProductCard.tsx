import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AddToCartOutcome } from '@/src/services/productActionOrchestration';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { trackProductEvent } from '@/src/logging/productAnalytics';
import { useThemeMode } from '@/contexts/ThemeContext';
import { BAG_COPY, controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { COLLECTION_PRODUCT_COPY } from '@/src/ui/collectionProductActions';
import { AddToCartButton } from './AddToCartButton';
import { ProductHeroImage } from './ProductHeroImage';
import { VerificationBadge } from './VerificationBadge';

export type ProductCardVariant = 'compact' | 'standard';

type Props = {
  product: CatalogProductViewModel;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  onPress: (product: CatalogProductViewModel) => void;
  /** Defaults to `standard` for backward compatibility. */
  variant?: ProductCardVariant;
  /**
   * Optional. When provided, Add to Bag action UI is rendered.
   * Parent owns auth / Cart orchestration — ProductCard never calls auth or Cart APIs.
   */
  onAddToCart?: (product: CatalogProductViewModel) => AddToCartOutcome | Promise<AddToCartOutcome>;
  /**
   * Optional. When provided, Buy action UI is rendered.
   * Parent owns shopping redirect — ProductCard never calls openProductShopping.
   */
  onBuy?: (product: CatalogProductViewModel) => void;
  /**
   * Optional. Collection page: opens AI Review sheet (replaces Buy / View Product).
   */
  onAiReview?: (product: CatalogProductViewModel) => void;
  /**
   * Optional. Merchant redirect shortcut — top-right external link icon.
   * Parent owns shopping redirect — ProductCard never calls openProductShopping.
   */
  onMerchantShortcut?: (product: CatalogProductViewModel) => void;
  /**
   * When true, show indexed/catalog price even if verification is not VERIFIED.
   * Search uses index denorm before full catalog hydration.
   */
  showIndexPrice?: boolean;
};

export function ProductCard({
  product,
  onPress,
  variant = 'standard',
  onAddToCart,
  onBuy,
  onAiReview,
  onMerchantShortcut,
  showIndexPrice = false,
}: Props) {
  const { tokens, isLight } = useThemeMode();
  const [buyPressed, setBuyPressed] = React.useState(false);
  useEffect(() => {
    trackProductEvent('product.card.viewed', {
      catalogProductId: product.catalogProductId ?? product.id,
      verificationStatus: product.verificationStatus,
    });
  }, [product.id, product.catalogProductId, product.verificationStatus]);

  const showPrice =
    !!product.price &&
    product.price !== '—' &&
    (product.verificationStatus === 'VERIFIED' || showIndexPrice);
  const canShop = !!product.catalogProductId;
  const showAddToCart = !!onAddToCart && canShop;
  const showAiReview = !!onAiReview && canShop;
  const showBuy = !!onBuy && canShop && !showAiReview;
  const showMerchantShortcut = !!onMerchantShortcut && canShop;
  const showActions = showAddToCart || showBuy || showAiReview;
  const isCompact = variant === 'compact';

  return (
    <View
      style={[
        styles.card,
        isCompact && styles.cardCompact,
        {
          borderColor: tokens.color.border,
          backgroundColor: tokens.color.surface,
          borderRadius: tokens.radius.lg,
        },
      ]}
    >
      {showMerchantShortcut ? (
        <Pressable
          onPress={() => onMerchantShortcut?.(product)}
          accessibilityRole="button"
          accessibilityLabel={COLLECTION_PRODUCT_COPY.merchantShortcutA11y}
          hitSlop={8}
          style={({ pressed }) => [
            styles.merchantShortcut,
            {
              backgroundColor: tokens.color.canvas,
              borderColor: tokens.color.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons name="open-outline" size={16} color={tokens.color.text} />
        </Pressable>
      ) : null}
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
            <Text style={[styles.brand, { color: tokens.color.textMuted }]} numberOfLines={1}>
              {product.brand}
            </Text>
          ) : null}
          <Text
            style={[
              isCompact ? styles.titleCompact : styles.title,
              { color: tokens.color.text },
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
            style={[styles.merchant, { color: tokens.color.textMuted }]}
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
          {showAiReview ? (
            <Pressable
              onPress={() => onAiReview?.(product)}
              accessibilityRole="button"
              accessibilityLabel={`${COLLECTION_PRODUCT_COPY.aiReview} ${product.title}`}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: tokens.color.cta,
                },
              ]}
            >
              <Text style={[styles.actionBtnText, { color: tokens.color.successOn }]}>
                {COLLECTION_PRODUCT_COPY.aiReview}
              </Text>
            </Pressable>
          ) : null}
          {showBuy ? (
            <Pressable
              onPress={() => onBuy?.(product)}
              accessibilityRole="button"
              accessibilityLabel={`${BAG_COPY.buy} ${product.title}`}
              onPressIn={() => setBuyPressed(true)}
              onPressOut={() => setBuyPressed(false)}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: tokens.color.cta,
                  opacity: controlOpacity(
                    resolveControlPhase({ pressed: buyPressed }),
                    tokens.motion.pressOpacity,
                  ),
                },
              ]}
            >
              <Text style={[styles.actionBtnText, { color: tokens.color.successOn }]}>{BAG_COPY.buy}</Text>
            </Pressable>
          ) : null}
          {showAddToCart && onAddToCart ? (
            <AddToCartButton product={product} onAddToCart={onAddToCart} />
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
    position: 'relative',
  },
  merchantShortcut: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
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
  actionBtnText: { fontWeight: '800', fontSize: 13 },
});
