import { useRouter, type Href } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ProductHeroImage } from '@/components/commerce/ProductHeroImage';
import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import type { ProductPageView } from '@/src/types/productPage';
import {
  COMPARE_COPY,
  type CompareRow,
  buildProductComparison,
} from '@/src/ui/productCompare';

const COL_WIDTH = 152;

type Props = {
  pages: ProductPageView[];
  onRemove?: (productId: string) => void;
};

export function ProductCompare({ pages, onRemove }: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const comparison = buildProductComparison(pages);
  const ready = pages.length >= 2;

  return (
    <View style={{ gap: tokens.space.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: Math.max(pages.length, 1) * COL_WIDTH }}>
          <View style={styles.headerRow}>
            {comparison.products.map((product) => (
              <View
                key={product.productId}
                style={[
                  styles.card,
                  {
                    width: COL_WIDTH,
                    ...outlineCardChrome(tokens),
                    borderRadius: tokens.radius.lg,
                    padding: tokens.space.sm,
                    gap: tokens.space.xs,
                  },
                ]}
              >
                <ProductHeroImage
                  productId={product.productId}
                  uri={product.heroImage}
                  alt={product.title}
                  style={[styles.thumb, { borderRadius: tokens.radius.md }]}
                />
                {product.brand ? (
                  <Text style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.label }} numberOfLines={1}>
                    {product.brand}
                  </Text>
                ) : null}
                <Text
                  style={{
                    color: tokens.color.text,
                    fontSize: tokens.fontSize.bodyStrong,
                    fontWeight: tokens.fontWeight.bold,
                  }}
                  numberOfLines={2}
                >
                  {product.title}
                </Text>
                {product.priceLabel ? (
                  <Text style={{ color: tokens.color.text, fontWeight: tokens.fontWeight.bold }} numberOfLines={2}>
                    {product.priceLabel}
                  </Text>
                ) : null}
                <ActionButton
                  label={COMPARE_COPY.viewProduct}
                  variant="quiet"
                  onPress={() => router.push(product.productPath as Href)}
                />
                {onRemove ? (
                  <Pressable
                    onPress={() => onRemove(product.productId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${COMPARE_COPY.remove} ${product.title}`}
                  >
                    <Text style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.label }}>
                      {COMPARE_COPY.remove}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>

          {ready
            ? comparison.rows.map((row) => (
                <CompareAttributeRow key={row.id} row={row} />
              ))
            : (
              <Text
                style={{
                  color: tokens.color.textMuted,
                  fontSize: tokens.fontSize.body,
                  paddingVertical: tokens.space.md,
                }}
              >
                {COMPARE_COPY.needMore}
              </Text>
            )}
        </View>
      </ScrollView>
    </View>
  );
}

function CompareAttributeRow({ row }: { row: CompareRow }) {
  const { tokens } = useThemeMode();
  return (
    <View
      style={[
        styles.attr,
        {
          borderBottomColor: tokens.color.divider,
          paddingVertical: tokens.space.sm,
        },
      ]}
    >
      <Text
        style={{
          color: tokens.color.textMuted,
          fontSize: tokens.fontSize.label,
          fontWeight: tokens.fontWeight.bold,
          marginBottom: tokens.space.xs,
        }}
      >
        {row.label}
      </Text>
      <View style={styles.headerRow}>
        {row.values.map((value, index) => (
          <Text
            key={`${row.id}:${index}`}
            style={{
              width: COL_WIDTH,
              paddingRight: tokens.space.sm,
              color: value ? tokens.color.text : tokens.color.textMuted,
              fontSize: tokens.fontSize.body,
            }}
          >
            {value ?? COMPARE_COPY.missing}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 8,
  },
  thumb: {
    width: '100%',
    aspectRatio: 1,
  },
  attr: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
