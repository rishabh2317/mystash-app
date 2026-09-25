import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProductHeroImage } from '@/components/commerce/ProductHeroImage';
import { useThemeMode } from '@/contexts/ThemeContext';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { BAG_COPY, controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { stashContextLabel, type BagItemView } from '@/src/ui/bag';

type Props = {
  item: BagItemView;
  onPress: (item: BagItemView) => void;
  onRemove: (item: BagItemView) => void;
  /** Rail cards are taller/narrower; grid cards fill a shelf column. */
  presentation?: 'rail' | 'grid' | 'row';
  /** Fixed width for horizontal rails. */
  railWidth?: number;
};

/**
 * Personal shopping-memory card for Stash.
 * Canonical catalogue rows and share-imported rows share this card.
 * Verification and catalogue-internal fields are never rendered here.
 */
export function BagItemCard({
  item,
  onPress,
  onRemove,
  presentation = 'grid',
  railWidth,
}: Props) {
  const { tokens } = useThemeMode();
  const imageUri = item.imageUrl ?? displayHeroUri(item.product);
  const context = stashContextLabel(item);
  const a11y = `${item.title}${item.brand ? `, ${item.brand}` : ''}${
    item.priceLabel ? `, ${item.priceLabel}` : ''
  }. Open product details.`;

  const isRow = presentation === 'row';
  const imageStyle = isRow
    ? styles.rowImage
    : presentation === 'rail'
      ? styles.railImage
      : styles.gridImage;

  return (
    <View
      style={[
        isRow ? styles.rowCard : styles.card,
        presentation === 'rail' && railWidth ? { width: railWidth } : null,
        presentation === 'grid' ? styles.gridCard : null,
      ]}
    >
      <Pressable
        onPress={() => onPress(item)}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={({ pressed }) => [
          isRow ? styles.rowPress : styles.stackPress,
          {
            gap: tokens.space.sm,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        <View style={isRow ? styles.rowMediaWrap : styles.mediaWrap}>
          <ProductHeroImage
            productId={item.productId}
            uri={imageUri}
            alt={item.title}
            style={[
              imageStyle,
              {
                borderRadius: tokens.radius.lg,
                backgroundColor: tokens.color.surfaceSubtle,
              },
            ]}
          />
          <Pressable
            onPress={() => onRemove(item)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`${BAG_COPY.removeFromBag} ${item.title}`}
            style={({ pressed }) => [
              styles.removeHit,
              {
                backgroundColor: tokens.color.surface,
                borderRadius: tokens.radius.pill,
                opacity: controlOpacity(
                  resolveControlPhase({ pressed }),
                  tokens.motion.pressOpacity,
                ),
              },
            ]}
          >
            <Ionicons name="close-outline" size={14} color={tokens.color.textMuted} />
          </Pressable>
        </View>

        <View style={[styles.meta, { gap: tokens.space.xxs }, isRow ? styles.rowMeta : null]}>
          {item.brand ? (
            <Text
              style={{
                color: tokens.color.textMuted,
                fontSize: tokens.fontSize.micro,
                lineHeight: tokens.lineHeight.micro,
                fontWeight: tokens.fontWeight.bold,
                letterSpacing: 0.5,
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
              fontSize: isRow ? tokens.fontSize.title : tokens.fontSize.bodyStrong,
              lineHeight: isRow ? tokens.lineHeight.title : tokens.lineHeight.bodyStrong,
              fontWeight: tokens.fontWeight.bold,
            }}
            numberOfLines={isRow ? 2 : 2}
          >
            {item.title}
          </Text>
          {item.priceLabel ? (
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.body,
                lineHeight: tokens.lineHeight.body,
                fontWeight: tokens.fontWeight.semibold,
              }}
              numberOfLines={1}
            >
              {item.priceLabel}
            </Text>
          ) : null}
          {context ? (
            <Text
              style={{
                color: tokens.color.textMuted,
                fontSize: tokens.fontSize.caption,
                lineHeight: tokens.lineHeight.caption,
                fontWeight: tokens.fontWeight.regular,
              }}
              numberOfLines={1}
            >
              {context}
            </Text>
          ) : null}
          {item.availabilityLabel ? (
            <Text
              style={{
                color: tokens.color.textMuted,
                fontSize: tokens.fontSize.caption,
                lineHeight: tokens.lineHeight.caption,
                fontWeight: tokens.fontWeight.semibold,
              }}
              numberOfLines={1}
            >
              {item.availabilityLabel}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 0,
  },
  gridCard: {
    flex: 1,
    minWidth: 0,
  },
  rowCard: {
    width: '100%',
  },
  stackPress: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  rowPress: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  rowMediaWrap: {
    position: 'relative',
  },
  mediaWrap: {
    position: 'relative',
    width: '100%',
  },
  railImage: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  gridImage: {
    width: '100%',
    aspectRatio: 1,
  },
  rowImage: {
    width: 96,
    height: 96,
  },
  meta: {
    minWidth: 0,
  },
  rowMeta: {
    flex: 1,
    paddingTop: 2,
  },
  removeHit: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
