import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { fetchProductAiReview } from '@/src/services/productAiReviewApi';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { ProductAiReviewResult } from '@/src/types/productAiReview';
import { COLLECTION_SECTION_COPY } from '@/src/ui/collectionSections';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { ProductHeroImage } from './ProductHeroImage';

type Props = {
  product: CatalogProductViewModel;
  /**
   * `standalone` omits product identity (the card sits under its product).
   * `withProduct` names the product — used when several products are grouped.
   */
  variant?: 'standalone' | 'withProduct';
  /** Opens the full AI Review sheet. Parent owns the sheet. */
  onOpen: (product: CatalogProductViewModel) => void;
  /** Lets the parent hand the same result to the sheet instead of refetching. */
  onResult?: (catalogProductId: string, result: ProductAiReviewResult) => void;
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
}: Props) {
  const { tokens } = useThemeMode();
  const [result, setResult] = useState<ProductAiReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const catalogProductId = product.catalogProductId;

  useEffect(() => {
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
  }, [catalogProductId, onResult]);

  if (!catalogProductId) return null;

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

  const bodyText = {
    color: tokens.color.textMuted,
    fontSize: tokens.fontSize.body,
    lineHeight: tokens.lineHeight.body,
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.color.surface,
          borderColor: tokens.color.border,
          borderRadius: tokens.radius.xl,
          padding: tokens.space.md,
          gap: tokens.space.sm,
        },
      ]}
    >
      <View style={[styles.headerRow, { gap: tokens.space.xs }]}>
        <Ionicons name="sparkles" size={16} color={tokens.color.primary} />
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: tokens.lineHeight.bodyStrong,
            fontWeight: tokens.fontWeight.extraBold,
          }}
        >
          {COLLECTION_SECTION_COPY.aiReview}
        </Text>
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
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.micro,
              lineHeight: tokens.lineHeight.micro,
              fontWeight: tokens.fontWeight.bold,
            }}
          >
            {COLLECTION_SECTION_COPY.aiReviewBeta}
          </Text>
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
          <Text
            style={{
              flex: 1,
              color: tokens.color.text,
              fontSize: tokens.fontSize.bodyStrong,
              lineHeight: tokens.lineHeight.bodyStrong,
              fontWeight: tokens.fontWeight.bold,
            }}
            numberOfLines={2}
          >
            {product.title}
          </Text>
        </View>
      ) : null}

      {loading || result?.status === 'generating' ? (
        <View style={[styles.statusRow, { gap: tokens.space.xs }]}>
          <ActivityIndicator size="small" color={tokens.color.textMuted} />
          <Text style={[bodyText, styles.statusText]}>
            {result?.status === 'generating'
              ? result.message
              : COLLECTION_SECTION_COPY.aiReviewGenerating}
          </Text>
        </View>
      ) : summary ? (
        <>
          {summary.overview ? (
            <Text style={bodyText} numberOfLines={3}>
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
                  <Text
                    style={{
                      flex: 1,
                      color: tokens.color.text,
                      fontSize: tokens.fontSize.bodyStrong,
                      lineHeight: tokens.lineHeight.bodyStrong,
                    }}
                    numberOfLines={2}
                  >
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
            <Text
              style={{
                color: tokens.color.primary,
                fontSize: tokens.fontSize.bodyStrong,
                lineHeight: tokens.lineHeight.bodyStrong,
                fontWeight: tokens.fontWeight.bold,
              }}
            >
              {COLLECTION_SECTION_COPY.readFullReview}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={tokens.color.primary} />
          </Pressable>
        </>
      ) : (
        <Text style={bodyText}>{COLLECTION_SECTION_COPY.aiReviewUnavailable}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
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
