import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { ProductPageReviews as ProductPageReviewsView } from '@/src/types/productPage';
import { PRODUCT_PAGE_COPY, productPageRatingLabel } from '@/src/ui/productPage';

type Props = {
  reviews: ProductPageReviewsView;
  onReadReviews?: () => void;
};

function PointList({ title, items }: { title: string; items: string[] }) {
  const { tokens } = useThemeMode();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: tokens.space.xs }}>
      <Text
        style={{
          color: tokens.color.text,
          fontSize: tokens.fontSize.bodyStrong,
          fontWeight: tokens.fontWeight.extraBold,
        }}
      >
        {title}
      </Text>
      {items.map((item) => (
        <Text
          key={item}
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.body,
            lineHeight: tokens.lineHeight.body,
          }}
        >
          {`• ${item}`}
        </Text>
      ))}
    </View>
  );
}

export function ProductPageReviews({ reviews, onReadReviews }: Props) {
  const { tokens } = useThemeMode();
  const rating = productPageRatingLabel(reviews);
  const source = reviews.sources[0] ?? null;

  return (
    <View style={{ gap: tokens.space.sm }}>
      <SectionHeader title={PRODUCT_PAGE_COPY.reviews} />
      {rating ? (
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.title,
            fontWeight: tokens.fontWeight.extraBold,
          }}
        >
          {rating}
        </Text>
      ) : null}
      {reviews.overview ? (
        <View style={{ gap: tokens.space.xs }}>
          <Text style={{ color: tokens.color.text, fontWeight: tokens.fontWeight.bold }}>
            {PRODUCT_PAGE_COPY.summary}
          </Text>
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.body,
              lineHeight: tokens.lineHeight.body,
            }}
          >
            {reviews.overview}
          </Text>
        </View>
      ) : null}
      <PointList title={PRODUCT_PAGE_COPY.likes} items={reviews.likes} />
      <PointList title={PRODUCT_PAGE_COPY.concerns} items={reviews.concerns} />
      <View style={styles.actions}>
        {onReadReviews ? (
          <ActionButton label={PRODUCT_PAGE_COPY.readReviews} onPress={onReadReviews} variant="secondary" />
        ) : null}
        {source ? (
          <Pressable
            onPress={() => {
              void openBrowserAsync(source.url, {
                presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
              });
            }}
            accessibilityRole="link"
            accessibilityLabel={PRODUCT_PAGE_COPY.viewSource}
          >
            <Text style={{ color: tokens.color.primary, fontWeight: tokens.fontWeight.bold }}>
              {PRODUCT_PAGE_COPY.viewSource}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 10,
  },
});
