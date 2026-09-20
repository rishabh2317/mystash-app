import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProductHeroImage } from '@/components/commerce/ProductHeroImage';
import { useThemeMode } from '@/contexts/ThemeContext';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { BAG_COPY, controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import type { BagItemView } from '@/src/ui/bag';

type Props = {
  item: BagItemView;
  onPress: (item: BagItemView) => void;
  onRemove: (item: BagItemView) => void;
};

/**
 * Personal shopping-memory row for Bag.
 * Canonical catalogue rows and share-imported rows share this card.
 * Verification and catalogue-internal fields are never rendered here.
 */
export function BagItemCard({ item, onPress, onRemove }: Props) {
  const { tokens } = useThemeMode();
  const imageUri = item.imageUrl ?? displayHeroUri(item.product);
  const a11y = `${item.title}${item.brand ? `, ${item.brand}` : ''}${
    item.priceLabel ? `, ${item.priceLabel}` : ''
  }. Open product details.`;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.color.surface,
          borderColor: tokens.color.border,
          borderRadius: tokens.radius.xl,
          padding: tokens.space.sm,
          gap: tokens.space.sm,
        },
      ]}
    >
      <Pressable
        onPress={() => onPress(item)}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={({ pressed }) => [
          styles.row,
          {
            gap: tokens.space.sm,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        <ProductHeroImage
          productId={item.productId}
          uri={imageUri}
          alt={item.title}
          style={[styles.thumb, { borderRadius: tokens.radius.md }]}
        />
        <View style={[styles.body, { gap: tokens.space.xxs }]}>
          {item.brand ? (
            <Text
              style={{
                color: tokens.color.textMuted,
                fontSize: tokens.fontSize.micro,
                lineHeight: tokens.lineHeight.micro,
                fontWeight: tokens.fontWeight.bold,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
              numberOfLines={1}
            >
              {item.brand}
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
            {item.title}
          </Text>
          {item.priceLabel ? (
            <Text
              style={{
                color: tokens.color.primary,
                fontSize: tokens.fontSize.bodyStrong,
                lineHeight: tokens.lineHeight.bodyStrong,
                fontWeight: tokens.fontWeight.extraBold,
              }}
              numberOfLines={1}
            >
              {item.priceLabel}
            </Text>
          ) : null}
          {item.sourceLabel ? (
            <Text
              style={{
                color: tokens.color.textMuted,
                fontSize: tokens.fontSize.caption,
                lineHeight: tokens.lineHeight.caption,
                fontWeight: tokens.fontWeight.semibold,
              }}
              numberOfLines={1}
            >
              {item.sourceLabel}
            </Text>
          ) : null}
          {item.availabilityLabel ? (
            <Text
              style={{
                color: tokens.color.warning,
                fontSize: tokens.fontSize.caption,
                lineHeight: tokens.lineHeight.caption,
                fontWeight: tokens.fontWeight.bold,
              }}
              numberOfLines={1}
            >
              {item.availabilityLabel}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        onPress={() => onRemove(item)}
        accessibilityRole="button"
        accessibilityLabel={`${BAG_COPY.removeFromBag} ${item.title}`}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          paddingHorizontal: tokens.space.xxs,
          paddingVertical: tokens.space.xxs,
          opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
        })}
      >
        <Text
          style={{
            color: tokens.color.danger,
            fontSize: tokens.fontSize.label,
            lineHeight: tokens.lineHeight.label,
            fontWeight: tokens.fontWeight.bold,
          }}
        >
          {BAG_COPY.removeFromBag}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  thumb: {
    width: 88,
    height: 88,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
});
