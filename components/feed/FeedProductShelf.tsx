import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { Product } from '@/src/mocks/videos';
import type { ThemeTokens } from '@/src/theme/tokens';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { productChipAccessibilityLabel } from '@/src/ui/feedA11y';

const CHIP_SIZE = 72;
const CHIP_GAP = 8;
const VISIBLE_CHIP_COUNT = 3;
/** Primary card spans ~3 chips + gaps between them. */
const HERO_WIDTH = CHIP_SIZE * VISIBLE_CHIP_COUNT + CHIP_GAP * (VISIBLE_CHIP_COUNT - 1);
/** Shelf rhythm between the hero card and the chip rail (between xxs and sm). */
const SHELF_GAP = 10;
/** Leading between a product name and its price. */
const PRICE_GAP = 2;
/** Vertical bleed so chip selection rings are not clipped by the rail. */
const RAIL_VERTICAL_PAD = 2;
const CHIP_PADDING = 6;
const CHIP_THUMB_SIZE = 44;
const HERO_THUMB_SIZE = 40;

type Props = {
  products: Product[];
  collectionId?: string | null;
  onProductPress?: (product: Product) => void;
};

/** Chip surface on media: `selected` is carried by the primary-coloured border. */
function chipSurface(tokens: ThemeTokens, selected: boolean, pressed: boolean) {
  return {
    backgroundColor: tokens.immersive.surfaceSubtle,
    borderColor: selected ? tokens.color.primary : tokens.immersive.borderStrong,
    borderWidth: tokens.stroke.strong,
    borderRadius: tokens.radius.md,
    gap: tokens.space.xxs,
    opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
  };
}

export function FeedProductShelf({
  products,
  collectionId,
  onProductPress,
}: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const [selectedId, setSelectedId] = useState<string | null>(products[0]?.id ?? null);

  useEffect(() => {
    setSelectedId(products[0]?.id ?? null);
  }, [products]);

  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) ?? products[0] ?? null,
    [products, selectedId],
  );

  const visibleChips = products.slice(0, VISIBLE_CHIP_COUNT);
  const overflow = Math.max(0, products.length - VISIBLE_CHIP_COUNT);

  const chipPriceText = {
    color: tokens.immersive.text,
    fontSize: tokens.fontSize.micro,
    fontWeight: tokens.fontWeight.bold,
  };
  const chipSubText = {
    color: tokens.immersive.textMuted,
    fontSize: tokens.fontSize.micro,
    fontWeight: tokens.fontWeight.semibold,
  };

  if (products.length === 0 && !collectionId) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {selected ? (
        <Pressable
          onPress={() => onProductPress?.(selected)}
          accessibilityRole="button"
          accessibilityLabel={productChipAccessibilityLabel(selected.name, selected.price)}
          style={({ pressed }) => [
            styles.hero,
            {
              width: HERO_WIDTH,
              maxWidth: '100%',
              gap: SHELF_GAP,
              paddingHorizontal: tokens.space.sm,
              backgroundColor: tokens.immersive.surfaceRaised,
              borderColor: tokens.immersive.border,
              borderRadius: tokens.radius.lg,
              opacity: controlOpacity(
                resolveControlPhase({ pressed }),
                tokens.motion.pressOpacity,
              ),
            },
          ]}
        >
          <Image
            source={{ uri: selected.image }}
            style={[styles.heroThumb, { borderRadius: tokens.radius.sm }]}
            contentFit="cover"
          />
          <View style={styles.heroText}>
            <Text
              style={{
                color: tokens.immersive.text,
                fontSize: tokens.fontSize.label,
                fontWeight: tokens.fontWeight.bold,
              }}
              numberOfLines={1}
            >
              {selected.name}
            </Text>
            <Text
              style={{
                color: tokens.color.primary,
                fontSize: tokens.fontSize.label,
                fontWeight: tokens.fontWeight.extraBold,
              }}
              numberOfLines={1}
            >
              {selected.price}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={tokens.immersive.iconMuted} />
        </Pressable>
      ) : null}

      {products.length > 0 || collectionId ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          contentContainerStyle={[styles.rail, { gap: CHIP_GAP }]}
        >
          {visibleChips.map((product) => {
            const active = product.id === selected?.id;
            return (
              <Pressable
                key={product.id}
                onPress={() => {
                  setSelectedId(product.id);
                  onProductPress?.(product);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={productChipAccessibilityLabel(product.name, product.price)}
                style={({ pressed }) => [styles.chip, chipSurface(tokens, active, pressed)]}
              >
                <Image
                  source={{ uri: product.image }}
                  style={[styles.chipImage, { borderRadius: tokens.radius.sm }]}
                  contentFit="cover"
                />
                <Text style={[styles.centeredText, chipPriceText]} numberOfLines={1}>
                  {product.price}
                </Text>
              </Pressable>
            );
          })}
          {overflow > 0 ? (
            <Pressable
              onPress={() => {
                const target = products[VISIBLE_CHIP_COUNT] ?? products[0];
                if (target) {
                  setSelectedId(target.id);
                  onProductPress?.(target);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={`${overflow} more products`}
              style={({ pressed }) => [
                styles.chip,
                styles.moreChip,
                chipSurface(tokens, false, pressed),
              ]}
            >
              <Text
                style={{
                  color: tokens.immersive.text,
                  fontSize: tokens.fontSize.body,
                  fontWeight: tokens.fontWeight.extraBold,
                }}
              >
                +{overflow}
              </Text>
              <Text style={chipSubText}>more</Text>
            </Pressable>
          ) : null}
          {collectionId ? (
            <Pressable
              onPress={() => router.push(`/collection/${collectionId}`)}
              accessibilityRole="button"
              accessibilityLabel="View collection"
              style={({ pressed }) => [
                styles.chip,
                styles.moreChip,
                chipSurface(tokens, false, pressed),
              ]}
            >
              <Ionicons name="albums-outline" size={22} color={tokens.immersive.icon} />
              <Text style={chipSubText}>View</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: SHELF_GAP,
    width: '100%',
  },
  hero: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SHELF_GAP,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroThumb: {
    width: HERO_THUMB_SIZE,
    height: HERO_THUMB_SIZE,
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: PRICE_GAP,
  },
  rail: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: RAIL_VERTICAL_PAD,
  },
  chip: {
    width: CHIP_SIZE,
    padding: CHIP_PADDING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipImage: {
    width: CHIP_THUMB_SIZE,
    height: CHIP_THUMB_SIZE,
  },
  moreChip: {
    justifyContent: 'center',
  },
  centeredText: {
    textAlign: 'center',
  },
});
