import React, { useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AddToCartOutcome } from '@/src/services/productActionOrchestration';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { trackProductEvent } from '@/src/logging/productAnalytics';
import { useThemeMode } from '@/contexts/ThemeContext';
import { IMMERSIVE_TOKENS, mediaScrimGradient } from '@/src/theme/tokens';
import { BAG_COPY, controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { COLLECTION_PRODUCT_COPY } from '@/src/ui/collectionProductActions';
import { COLLECTION_SECTION_COPY, formatProductPrice } from '@/src/ui/collectionSections';
import { ActionButton } from '@/components/ui/ActionButton';
import { AddToCartButton } from './AddToCartButton';
import { ProductHeroImage } from './ProductHeroImage';
import { TrustStrip } from './TrustStrip';
import { VerificationBadge } from './VerificationBadge';

/**
 * One semantic product card, several intentional visual contracts.
 * `compact` / `standard` are the pre-existing list forms (Search, Bag).
 * `collection` is the decision-oriented Collection card.
 * `related` is the discovery rail card.
 * `publicProfile` is the public-profile catalog card: overlay tile matching
 * Collection `creatorRail` (thumbnail + price + title on the media).
 */
export type ProductCardVariant = 'compact' | 'standard' | 'collection' | 'related' | 'publicProfile';

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

/** Square media in the Collection card; the rail card uses a full-width crop. */
const COLLECTION_THUMB_SIZE = 96;
const RELATED_MEDIA_ASPECT = 1;

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

  const openDetails = () => {
    trackProductEvent('product.card.opened', {
      catalogProductId: product.catalogProductId ?? product.id,
    });
    onPress(product);
  };

  const priceLabel = showPrice ? formatProductPrice(product) : null;
  const brandStyle = {
    color: tokens.color.textMuted,
    fontSize: tokens.fontSize.micro,
    lineHeight: tokens.lineHeight.micro,
    fontWeight: tokens.fontWeight.bold,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  };
  const priceStyle = {
    color: tokens.color.primary,
    fontWeight: tokens.fontWeight.extraBold,
  };
  const a11yLabel = `${product.title}${product.brand ? `, ${product.brand}` : ''}${
    priceLabel ? `, ${priceLabel}` : ''
  }. Open product details.`;

  if (variant === 'collection') {
    return (
      <View
        style={[
          styles.collectionCard,
          {
            backgroundColor: tokens.color.surface,
            borderColor: tokens.color.border,
            borderRadius: tokens.radius.xl,
            padding: tokens.space.md,
            gap: tokens.space.sm,
          },
        ]}
      >
        <Pressable
          onPress={openDetails}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          style={({ pressed }) => [
            styles.collectionRow,
            {
              gap: tokens.space.sm,
              opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
            },
          ]}
        >
          <ProductHeroImage
            productId={product.id}
            uri={displayHeroUri(product)}
            alt={product.title}
            style={[styles.collectionThumb, { borderRadius: tokens.radius.md }]}
          />
          <View style={[styles.collectionBody, { gap: tokens.space.xxs }]}>
            {product.brand ? (
              <Text style={brandStyle} numberOfLines={1}>
                {product.brand}
              </Text>
            ) : null}
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.title,
                lineHeight: tokens.lineHeight.title,
                fontWeight: tokens.fontWeight.extraBold,
              }}
              numberOfLines={2}
            >
              {product.title}
            </Text>
            {priceLabel ? (
              <Text
                style={[
                  priceStyle,
                  { fontSize: tokens.fontSize.title, lineHeight: tokens.lineHeight.title },
                ]}
                numberOfLines={1}
              >
                {priceLabel}
              </Text>
            ) : null}
            <View style={[styles.collectionMeta, { gap: tokens.space.xs }]}>
              <VerificationBadge status={product.verificationStatus} isLight={isLight} />
              {product.merchant ? (
                <Text
                  style={{
                    color: tokens.color.textMuted,
                    fontSize: tokens.fontSize.caption,
                    lineHeight: tokens.lineHeight.caption,
                  }}
                  numberOfLines={1}
                >
                  {product.merchant}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>

        <View style={[styles.collectionActions, { gap: tokens.space.xs }]}>
          <View style={styles.collectionPrimary}>
            <ActionButton
              label={COLLECTION_SECTION_COPY.viewProductDetails}
              onPress={openDetails}
              variant="primary"
              trailingIcon="chevron-forward"
              accessibilityLabel={`${COLLECTION_SECTION_COPY.viewProductDetails}: ${product.title}`}
            />
          </View>
          {showAddToCart && onAddToCart ? (
            // Unflexed wrapper: the quiet action sizes to its label so the
            // primary CTA keeps the remaining width and stays dominant.
            <View>
              <AddToCartButton product={product} variant="quiet" onAddToCart={onAddToCart} />
            </View>
          ) : null}
        </View>

        <TrustStrip
          product={product}
          onMerchantPress={showMerchantShortcut ? onMerchantShortcut : undefined}
        />
      </View>
    );
  }

  if (variant === 'publicProfile') {
    const scrim = mediaScrimGradient();
    return (
      <Pressable
        onPress={openDetails}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [
          styles.publicPortrait,
          {
            borderRadius: tokens.radius.lg,
            backgroundColor: IMMERSIVE_TOKENS.stage,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        <ProductHeroImage
          productId={product.id}
          uri={displayHeroUri(product)}
          alt={product.title}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[...scrim.colors]}
          locations={[...scrim.locations]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.publicChrome, { padding: tokens.space.xs }]}>
          {priceLabel ? (
            <View
              style={[
                styles.publicBadge,
                {
                  backgroundColor: IMMERSIVE_TOKENS.control,
                  borderRadius: tokens.radius.sm,
                  paddingHorizontal: tokens.space.xxs,
                  paddingVertical: tokens.space.xxs / 2,
                },
              ]}
            >
              <Text
                style={{
                  color: IMMERSIVE_TOKENS.text,
                  fontSize: tokens.fontSize.micro,
                  lineHeight: tokens.lineHeight.micro,
                  fontWeight: tokens.fontWeight.bold,
                }}
                numberOfLines={1}
              >
                {priceLabel}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <Text
            style={{
              color: IMMERSIVE_TOKENS.text,
              fontSize: tokens.fontSize.caption,
              lineHeight: tokens.lineHeight.caption,
              fontWeight: tokens.fontWeight.bold,
              textShadowColor: IMMERSIVE_TOKENS.textShadow,
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 3,
            }}
            numberOfLines={2}
          >
            {product.title}
          </Text>
        </View>
      </Pressable>
    );
  }

  if (variant === 'related') {
    return (
      <View
        style={[
          styles.relatedCard,
          {
            backgroundColor: tokens.color.surface,
            borderColor: tokens.color.border,
            borderRadius: tokens.radius.xl,
          },
        ]}
      >
        <Pressable
          onPress={openDetails}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          style={({ pressed }) => [
            {
              opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
            },
          ]}
        >
          <ProductHeroImage
            productId={product.id}
            uri={displayHeroUri(product)}
            alt={product.title}
            contentFit="cover"
            style={styles.relatedMedia}
          />
          <View
            style={[
              styles.relatedBody,
              {
                padding: tokens.space.sm,
                gap: tokens.space.xxs / 2,
                minHeight:
                  tokens.lineHeight.caption +
                  tokens.lineHeight.bodyStrong +
                  tokens.lineHeight.bodyStrong,
              },
            ]}
          >
            <Text
              style={{
                color: tokens.color.textMuted,
                fontSize: tokens.fontSize.caption,
                lineHeight: tokens.lineHeight.caption,
              }}
              numberOfLines={1}
            >
              {product.brand || ' '}
            </Text>
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.bodyStrong,
                lineHeight: tokens.lineHeight.bodyStrong,
                fontWeight: tokens.fontWeight.extraBold,
              }}
              numberOfLines={1}
            >
              {product.title}
            </Text>
            <Text
              style={[
                priceStyle,
                {
                  fontSize: tokens.fontSize.bodyStrong,
                  lineHeight: tokens.lineHeight.bodyStrong,
                },
              ]}
              numberOfLines={1}
            >
              {priceLabel || ' '}
            </Text>
          </View>
        </Pressable>
        {showAddToCart && onAddToCart ? (
          <View style={[styles.relatedSave, { top: tokens.space.xs, right: tokens.space.xs }]}>
            <AddToCartButton product={product} variant="icon" onAddToCart={onAddToCart} />
          </View>
        ) : null}
      </View>
    );
  }

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
        onPress={openDetails}
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
  collectionCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  collectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  collectionThumb: {
    width: COLLECTION_THUMB_SIZE,
    height: COLLECTION_THUMB_SIZE,
  },
  collectionBody: {
    flex: 1,
    minWidth: 0,
  },
  collectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  collectionActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  collectionPrimary: {
    flex: 1,
    minWidth: 0,
  },
  relatedCard: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    position: 'relative',
    alignSelf: 'flex-start',
  },
  relatedMedia: {
    width: '100%',
    aspectRatio: RELATED_MEDIA_ASPECT,
  },
  relatedBody: {
    minWidth: 0,
  },
  relatedSave: {
    position: 'absolute',
    zIndex: 2,
  },
  publicPortrait: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  publicChrome: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  publicBadge: {
    alignSelf: 'flex-start',
  },
});
