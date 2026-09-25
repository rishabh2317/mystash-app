import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ProductCard } from '@/components/commerce/ProductCard';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { mapFeedProductToCatalogViewModel } from '@/src/mappers/feedProductMapper';
import type { Product } from '@/src/mocks/videos';
import { collectionPath } from '@/src/services/sharePaths';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { FEED_SHOP_COPY } from '@/src/ui/feedShop';
import { railCardWidth } from '@/src/ui/rail';

/** Matches FeedReelOverlay MEDIA_GUTTER for card pitch math. */
const MEDIA_GUTTER = 14;
/** Compact carousel so the Shop pill + rail fit the media overlay. */
const RAIL = { visible: 3.1, peek: 22, minWidth: 88, maxWidth: 108 };

type Props = {
  products: Product[];
  collectionId?: string | null;
  onProductPress?: (product: Product) => void;
};

/**
 * Home feed product zone: pill “Shop this post” → Collection page,
 * plus a compact mini ProductCard rail for attached products.
 */
export function FeedProductShelf({ products, collectionId, onProductPress }: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { width: screenWidth } = useWindowDimensions();
  const onAddToCart = useProductAddToCartHandler();
  const gap = tokens.space.xs;
  const collectionHref = collectionId?.trim() || null;

  const catalogProducts = useMemo(
    () => products.map((p) => ({ thin: p, vm: mapFeedProductToCatalogViewModel(p) })),
    [products],
  );

  const cardWidth = railCardWidth({
    screenWidth,
    gutter: MEDIA_GUTTER,
    gap,
    visible: RAIL.visible,
    peek: RAIL.peek,
    minWidth: RAIL.minWidth,
    maxWidth: RAIL.maxWidth,
  });

  if (products.length === 0 && !collectionHref) return null;

  const openCollection = () => {
    if (!collectionHref) return;
    router.push(collectionPath(collectionHref) as Href);
  };

  return (
    <View style={[styles.wrap, { gap: tokens.space.xs }]} pointerEvents="box-none">
      {collectionHref ? (
        <Pressable
          onPress={openCollection}
          accessibilityRole="button"
          accessibilityLabel={FEED_SHOP_COPY.shopThisPostA11y}
          style={({ pressed }) => [
            styles.shopPill,
            {
              backgroundColor: tokens.immersive.surfaceRaised,
              borderColor: tokens.immersive.border,
              borderRadius: tokens.radius.pill,
              paddingVertical: tokens.space.xs,
              paddingLeft: tokens.space.sm,
              paddingRight: tokens.space.xs,
              gap: tokens.space.xs,
              opacity: controlOpacity(
                resolveControlPhase({ pressed }),
                tokens.motion.pressOpacity,
              ),
            },
          ]}
        >
          <Text
            style={{
              flexShrink: 1,
              color: tokens.immersive.text,
              fontSize: tokens.fontSize.label,
              lineHeight: tokens.lineHeight.label,
              fontWeight: tokens.fontWeight.bold,
            }}
            numberOfLines={1}
          >
            {FEED_SHOP_COPY.shopThisPost}
          </Text>
          <Ionicons name="chevron-forward-outline" size={18} color={tokens.immersive.iconMuted} />
        </Pressable>
      ) : null}

      {catalogProducts.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          decelerationRate={0.992}
          contentContainerStyle={[styles.rail, { gap }]}
        >
          {catalogProducts.map(({ thin, vm }) => (
            <View key={thin.id} style={{ width: cardWidth }}>
              <ProductCard
                product={vm}
                variant="mini"
                showIndexPrice
                onPress={() => onProductPress?.(thin)}
                onAddToCart={vm.catalogProductId ? onAddToCart : undefined}
              />
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  shopPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  rail: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 2,
  },
});
