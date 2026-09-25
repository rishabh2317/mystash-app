import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { fetchProductAiReview } from '@/src/services/productAiReviewApi';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { ProductAiReviewResult } from '@/src/types/productAiReview';
import { COLLECTION_SECTION_COPY } from '@/src/ui/collectionSections';
import { PRODUCT_PAGE_COPY } from '@/src/ui/productPage';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { ProductHeroImage } from './ProductHeroImage';

type Props = {
  product: CatalogProductViewModel;
  /**
   * `standalone` omits product identity (the card sits under its product).
   * `withProduct` names the product — used when several products are grouped.
   * `banner` is a quiet Product Page CTA that opens the AI Review sheet.
   */
  variant?: 'standalone' | 'withProduct' | 'banner';
  /** Opens the full AI Review sheet. Parent owns the sheet. */
  onOpen: (product: CatalogProductViewModel) => void;
  /** Lets the parent hand the same result to the sheet instead of refetching. */
  onResult?: (catalogProductId: string, result: ProductAiReviewResult) => void;
  /** Optional preloaded summary (e.g. from Product Page reviews). */
  preloaded?: ProductAiReviewResult | null;
};

/** Scannable highlights shown inline; the sheet holds the full summary. */
const INLINE_HIGHLIGHT_LIMIT = 4;
const IDENTITY_THUMB = 40;

/**
 * Product intelligence summary. Renders only what the AI Review API returned
 * (overview, pros, cons, sources) and mirrors its available / generating /
 * unavailable states — it never synthesises ratings or attributes.
 */
export function ProductAiReviewCard({
  product,
  variant = 'standalone',
  onOpen,
  onResult,
  preloaded = null,
}: Props) {
  const { tokens } = useThemeMode();
  const [result, setResult] = useState<ProductAiReviewResult | null>(preloaded);
  const [loading, setLoading] = useState(false);
  const catalogProductId = product.catalogProductId;

  useEffect(() => {
    if (preloaded) {
      setResult(preloaded);
      setLoading(false);
      return;
    }
    if (!catalogProductId) {
      setResult(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setResult(null);
    void fetchProductAiReview(catalogProductId)
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        onResult?.(catalogProductId, next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogProductId, onResult, preloaded]);

  if (!catalogProductId) return null;

  if (variant === 'banner') {
    const teaser =
      result?.status === 'available' && result.summary.overview?.trim()
        ? result.summary.overview.trim()
        : PRODUCT_PAGE_COPY.aiInsightTeaser;
    return (
      <Pressable
        onPress={() => onOpen(product)}
        accessibilityRole="button"
        accessibilityLabel={`${PRODUCT_PAGE_COPY.aiInsight}: ${PRODUCT_PAGE_COPY.aiInsightCta}`}
        style={({ pressed }) => [
          styles.banner,
          {
            ...outlineCardChrome(tokens),
            borderRadius: tokens.radius.lg,
            paddingVertical: tokens.space.md,
            paddingHorizontal: tokens.space.md,
            gap: tokens.space.xs,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        <View style={[styles.headerRow, { gap: tokens.space.xs }]}>
          <Ionicons name="sparkles-outline" size={15} color={tokens.color.primary} />
          <Text style={typeStyle(tokens, 'tileTitle')}>{PRODUCT_PAGE_COPY.aiInsight}</Text>
        </View>
        <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={2}>
          {loading ? COLLECTION_SECTION_COPY.aiReviewGenerating : teaser}
        </Text>
        <Text style={typeStyle(tokens, 'link')}>{`${PRODUCT_PAGE_COPY.aiInsightCta} →`}</Text>
      </Pressable>
    );
  }

  const summary = result?.status === 'available' ? result.summary : null;
  const highlights = summary
    ? [
        ...summary.pros.slice(0, INLINE_HIGHLIGHT_LIMIT).map((label) => ({
          key: `pro-${label}`,
          icon: 'checkmark-circle-outline' as const,
          label,
          tone: 'positive' as const,
        })),
        ...(summary.pros.length >= INLINE_HIGHLIGHT_LIMIT
          ? []
          : summary.cons
              .slice(0, INLINE_HIGHLIGHT_LIMIT - summary.pros.length)
              .map((label) => ({
                key: `con-${label}`,
                icon: 'remove-circle-outline' as const,
                label,
                tone: 'caution' as const,
              }))),
      ]
    : [];

  return (
    <View
      style={[
        styles.card,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.lg,
          padding: tokens.space.md,
          gap: tokens.space.sm,
        },
      ]}
    >
      <View style={[styles.headerRow, { gap: tokens.space.xs }]}>
        <Ionicons name="sparkles-outline" size={16} color={tokens.color.primary} />
        <Text style={typeStyle(tokens, 'sectionTitle')}>{COLLECTION_SECTION_COPY.aiReview}</Text>
        <View
          style={[
            styles.betaChip,
            {
              backgroundColor: tokens.color.surfaceSubtle,
              borderColor: tokens.color.divider,
              borderRadius: tokens.radius.sm,
              paddingHorizontal: tokens.space.xs,
            },
          ]}
        >
          <Text style={typeStyle(tokens, 'tileMeta')}>{COLLECTION_SECTION_COPY.aiReviewBeta}</Text>
        </View>
      </View>

      {variant === 'withProduct' ? (
        <View style={[styles.identityRow, { gap: tokens.space.sm }]}>
          <ProductHeroImage
            productId={product.id}
            uri={displayHeroUri(product)}
            alt={product.title}
            style={[styles.identityThumb, { borderRadius: tokens.radius.sm }]}
          />
          <Text style={[typeStyle(tokens, 'tileTitle'), { flex: 1 }]} numberOfLines={2}>
            {product.title}
          </Text>
        </View>
      ) : null}

      {loading || result?.status === 'generating' ? (
        <View style={[styles.statusRow, { gap: tokens.space.xs }]}>
          <ActivityIndicator size="small" color={tokens.color.textMuted} />
          <Text style={[typeStyle(tokens, 'bodyMuted'), styles.statusText]}>
            {result?.status === 'generating'
              ? result.message
              : COLLECTION_SECTION_COPY.aiReviewGenerating}
          </Text>
        </View>
      ) : summary ? (
        <>
          {summary.overview ? (
            <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={3}>
              {summary.overview}
            </Text>
          ) : null}
          {highlights.length > 0 ? (
            <View style={styles.highlights}>
              {highlights.map((item) => (
                <View
                  key={item.key}
                  style={[
                    styles.highlightRow,
                    {
                      gap: tokens.space.xs,
                      paddingVertical: tokens.space.xs,
                      borderTopColor: tokens.color.divider,
                    },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={15}
                    color={item.tone === 'positive' ? tokens.color.primary : tokens.color.textMuted}
                  />
                  <Text style={[typeStyle(tokens, 'tileTitle'), { flex: 1 }]} numberOfLines={2}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <Pressable
            onPress={() => onOpen(product)}
            accessibilityRole="button"
            accessibilityLabel={`${COLLECTION_SECTION_COPY.readFullReview}: ${product.title}`}
            style={({ pressed }) => [
              styles.readRow,
              {
                paddingTop: tokens.space.xs,
                borderTopColor: tokens.color.divider,
                opacity: controlOpacity(
                  resolveControlPhase({ pressed }),
                  tokens.motion.pressOpacity,
                ),
              },
            ]}
          >
            <Text style={typeStyle(tokens, 'link')}>{COLLECTION_SECTION_COPY.readFullReview}</Text>
            <Ionicons name="chevron-forward-outline" size={16} color={tokens.color.primary} />
          </Pressable>
        </>
      ) : (
        <Text style={typeStyle(tokens, 'bodyMuted')}>{COLLECTION_SECTION_COPY.aiReviewUnavailable}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  betaChip: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  identityThumb: {
    width: IDENTITY_THUMB,
    height: IDENTITY_THUMB,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    flex: 1,
  },
  highlights: {
    marginTop: 0,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  readRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
