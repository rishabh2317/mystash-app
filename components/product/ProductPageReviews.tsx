import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { ProductPageReviews as ProductPageReviewsView } from '@/src/types/productPage';
import { PRODUCT_PAGE_COPY } from '@/src/ui/productPage';

type Props = {
  reviews: ProductPageReviewsView;
  onReadReviews?: () => void;
};

export function ProductPageReviews({ reviews, onReadReviews }: Props) {
  const { tokens } = useThemeMode();
  const rating = reviews.rating?.trim() ?? null;
  const count =
    typeof reviews.reviewCount === 'number' && reviews.reviewCount > 0
      ? `${reviews.reviewCount.toLocaleString()} reviews`
      : null;
  const source = reviews.sources[0] ?? null;
  const overview = reviews.overview?.trim() ?? null;

  return (
    <View style={{ gap: tokens.space.sm }}>
      <Text style={typeStyle(tokens, 'sectionTitle')}>{PRODUCT_PAGE_COPY.reviews}</Text>
      {rating ? (
        <Text style={typeStyle(tokens, 'identityTitle')}>
          {rating.startsWith('★') ? rating : `★ ${rating}`}
        </Text>
      ) : null}
      {count ? <Text style={typeStyle(tokens, 'bodyMuted')}>{count}</Text> : null}
      {overview ? (
        <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={4}>
          {`“${overview}”`}
        </Text>
      ) : null}
      {reviews.likes.length > 0 ? (
        <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={2}>
          {reviews.likes.slice(0, 2).join(' · ')}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {onReadReviews ? (
          <Pressable onPress={onReadReviews} accessibilityRole="button">
            <Text style={typeStyle(tokens, 'link')}>{`${PRODUCT_PAGE_COPY.readReviews} →`}</Text>
          </Pressable>
        ) : null}
        {source ? (
          <Pressable
            onPress={() => {
              void openBrowserAsync(source.url, {
                presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
              });
            }}
            accessibilityRole="link"
            accessibilityLabel={PRODUCT_PAGE_COPY.seeReviewSources}
          >
            <Text style={typeStyle(tokens, 'link')}>{`${PRODUCT_PAGE_COPY.seeReviewSources} →`}</Text>
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
