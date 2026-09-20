import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeMode } from '@/contexts/ThemeContext';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { fetchProductAiReview } from '@/src/services/productAiReviewApi';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { ProductAiReviewResult } from '@/src/types/productAiReview';
import {
  COLLECTION_SECTION_COPY,
  formatCollectionDate,
  formatProductPrice,
} from '@/src/ui/collectionSections';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';
import { hostLabel } from '@/src/ui/webHost';
import { ProductHeroImage } from './ProductHeroImage';
import { VerificationBadge } from './VerificationBadge';

type Props = {
  visible: boolean;
  product: CatalogProductViewModel | null;
  onClose: () => void;
  /** Result already fetched by the inline card, so the sheet does not refetch. */
  preloaded?: ProductAiReviewResult | null;
  hideInternalStatus?: boolean;
};

const HEADER_ICON = 32;
const IDENTITY_THUMB = 72;
const SOURCE_PREVIEW_LIMIT = 3;

/**
 * Full AI Review for one product. Presents exactly what the backend returned —
 * overview, what we like (pros), things to consider (cons) and the evidence it
 * used. No client-side ratings, scores or attributes.
 */
export function AiReviewSheet({
  visible,
  product,
  onClose,
  preloaded,
  hideInternalStatus = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { tokens, isLight } = useThemeMode();
  const [result, setResult] = useState<ProductAiReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const catalogProductId = product?.catalogProductId ?? null;
  const preloadedMatches =
    preloaded && catalogProductId
      ? (preloaded.status === 'available'
          ? preloaded.summary.catalogProductId
          : preloaded.catalogProductId) === catalogProductId
      : false;

  useEffect(() => {
    if (!visible) {
      setShowAllSources(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !catalogProductId) {
      setResult(null);
      setLoading(false);
      return;
    }
    if (preloadedMatches && preloaded) {
      setResult(preloaded);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setResult(null);
    void fetchProductAiReview(catalogProductId)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, catalogProductId, preloadedMatches, preloaded]);

  if (!product) return null;

  const title = product.title?.trim() || 'Product';
  const summary = result?.status === 'available' ? result.summary : null;
  const priceLabel = formatProductPrice(product);
  const reviewedOn = formatCollectionDate(
    summary?.updatedAt ?? summary?.evidenceLastCheckedAt ?? null,
  );
  const sources = summary?.sources ?? [];
  const visibleSources = showAllSources ? sources : sources.slice(0, SOURCE_PREVIEW_LIMIT);
  const hiddenSourceCount = Math.max(0, sources.length - visibleSources.length);

  const sectionTitle = {
    fontSize: tokens.fontSize.bodyStrong,
    lineHeight: tokens.lineHeight.bodyStrong,
    fontWeight: tokens.fontWeight.extraBold,
  };
  const bodyText = {
    color: tokens.color.text,
    fontSize: tokens.fontSize.body,
    lineHeight: tokens.lineHeight.body,
  };
  const mutedText = {
    color: tokens.color.textMuted,
    fontSize: tokens.fontSize.caption,
    lineHeight: tokens.lineHeight.caption,
  };
  const cardSurface = {
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: tokens.overlay.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: `${tokens.overlay.sheetMaxHeightRatio * 100}%`,
              paddingBottom: Math.max(insets.bottom, tokens.space.sm),
              paddingHorizontal: tokens.space.md,
              paddingTop: tokens.space.xs,
              borderTopLeftRadius: tokens.radius.xxl,
              borderTopRightRadius: tokens.radius.xxl,
              backgroundColor: tokens.color.canvas,
              gap: tokens.space.sm,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: tokens.color.border }]} />

          <View style={[styles.headerRow, { gap: tokens.space.xs }]}>
            <Text
              style={{
                flex: 1,
                color: tokens.color.text,
                fontSize: tokens.fontSize.title,
                lineHeight: tokens.lineHeight.title,
                fontWeight: tokens.fontWeight.extraBold,
              }}
              numberOfLines={1}
            >
              AI Review for this product
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
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close AI Review"
              hitSlop={hitSlopToMinTarget(HEADER_ICON)}
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  backgroundColor: tokens.color.surface,
                  borderColor: tokens.color.border,
                  borderRadius: tokens.radius.pill,
                  opacity: controlOpacity(
                    resolveControlPhase({ pressed }),
                    tokens.motion.pressOpacity,
                  ),
                },
              ]}
            >
              <Ionicons name="close" size={18} color={tokens.color.text} />
            </Pressable>
          </View>

          <View style={[styles.identityCard, cardSurface, { padding: tokens.space.sm, gap: tokens.space.sm }]}>
            <ProductHeroImage
              productId={product.id}
              uri={displayHeroUri(product)}
              alt={title}
              style={[styles.identityThumb, { borderRadius: tokens.radius.md }]}
            />
            <View style={[styles.identityCopy, { gap: tokens.space.xxs / 2 }]}>
              <Text
                style={{
                  color: tokens.color.text,
                  fontSize: tokens.fontSize.bodyStrong,
                  lineHeight: tokens.lineHeight.bodyStrong,
                  fontWeight: tokens.fontWeight.extraBold,
                }}
                numberOfLines={2}
              >
                {title}
              </Text>
              {priceLabel ? (
                <Text
                  style={{
                    color: tokens.color.primary,
                    fontSize: tokens.fontSize.bodyStrong,
                    lineHeight: tokens.lineHeight.bodyStrong,
                    fontWeight: tokens.fontWeight.extraBold,
                  }}
                >
                  {priceLabel}
                </Text>
              ) : null}
              <View style={[styles.identityMeta, { gap: tokens.space.xs }]}>
                {product.merchant ? (
                  <Text style={mutedText} numberOfLines={1}>
                    {product.merchant}
                  </Text>
                ) : null}
                {hideInternalStatus ? null : (
                  <VerificationBadge status={product.verificationStatus} isLight={isLight} />
                )}
              </View>
            </View>
          </View>

          {loading || result?.status === 'generating' ? (
            <View style={[styles.centered, { paddingVertical: tokens.space.xl, gap: tokens.space.xs }]}>
              <ActivityIndicator color={tokens.color.text} />
              <Text style={[bodyText, styles.centeredText, { color: tokens.color.textMuted }]}>
                {result?.status === 'generating' ? result.message : 'Loading review summary…'}
              </Text>
            </View>
          ) : summary ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: tokens.space.lg, paddingBottom: tokens.space.sm }}
            >
              {summary.overview ? <Text style={bodyText}>{summary.overview}</Text> : null}

              {summary.pros.length > 0 ? (
                <View style={{ gap: tokens.space.xs }}>
                  <Text style={[sectionTitle, { color: tokens.color.primary }]}>
                    {COLLECTION_SECTION_COPY.whatWeLike}
                  </Text>
                  {summary.pros.map((item) => (
                    <View key={`pro-${item}`} style={[styles.bulletRow, { gap: tokens.space.xs }]}>
                      <Ionicons name="checkmark" size={16} color={tokens.color.primary} />
                      <Text style={[bodyText, styles.bulletText]}>{item}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {summary.cons.length > 0 ? (
                <View style={{ gap: tokens.space.xs }}>
                  <Text style={[sectionTitle, { color: tokens.color.text }]}>
                    {COLLECTION_SECTION_COPY.thingsToConsider}
                  </Text>
                  {summary.cons.map((item) => (
                    <View key={`con-${item}`} style={[styles.bulletRow, { gap: tokens.space.xs }]}>
                      <Ionicons
                        name="remove-circle-outline"
                        size={16}
                        color={tokens.color.textMuted}
                      />
                      <Text style={[bodyText, styles.bulletText]}>{item}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {sources.length > 0 ? (
                <View
                  style={{
                    gap: tokens.space.sm,
                    paddingTop: tokens.space.sm,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: tokens.color.divider,
                  }}
                >
                  <View style={[styles.evidenceHeader, { gap: tokens.space.xs }]}>
                    <Text style={[sectionTitle, { flex: 1, color: tokens.color.text }]}>
                      {COLLECTION_SECTION_COPY.evidenceAndSources}
                    </Text>
                    {reviewedOn ? (
                      <Text style={mutedText}>Reviewed on {reviewedOn}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.sourceRow, { gap: tokens.space.xs }]}>
                    {visibleSources.map((source) => (
                      <Pressable
                        key={source.url}
                        onPress={() => void Linking.openURL(source.url)}
                        accessibilityRole="link"
                        accessibilityLabel={`Open review source ${source.name}`}
                        style={({ pressed }) => [
                          styles.sourceChip,
                          cardSurface,
                          {
                            paddingHorizontal: tokens.space.sm,
                            paddingVertical: tokens.space.xs,
                            borderRadius: tokens.radius.md,
                            opacity: controlOpacity(
                              resolveControlPhase({ pressed }),
                              tokens.motion.pressOpacity,
                            ),
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: tokens.color.text,
                            fontSize: tokens.fontSize.caption,
                            lineHeight: tokens.lineHeight.caption,
                            fontWeight: tokens.fontWeight.bold,
                          }}
                          numberOfLines={1}
                        >
                          {source.name}
                        </Text>
                        <Text style={mutedText} numberOfLines={1}>
                          {hostLabel(source.url) ?? ''}
                        </Text>
                      </Pressable>
                    ))}
                    {hiddenSourceCount > 0 ? (
                      <Pressable
                        onPress={() => setShowAllSources(true)}
                        accessibilityRole="button"
                        accessibilityLabel={`Show ${hiddenSourceCount} more sources`}
                        style={({ pressed }) => [
                          styles.sourceChip,
                          styles.sourceMore,
                          cardSurface,
                          {
                            paddingHorizontal: tokens.space.sm,
                            paddingVertical: tokens.space.xs,
                            borderRadius: tokens.radius.md,
                            opacity: controlOpacity(
                              resolveControlPhase({ pressed }),
                              tokens.motion.pressOpacity,
                            ),
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: tokens.color.text,
                            fontSize: tokens.fontSize.caption,
                            lineHeight: tokens.lineHeight.caption,
                            fontWeight: tokens.fontWeight.bold,
                          }}
                        >
                          +{hiddenSourceCount}
                        </Text>
                        <Text style={mutedText}>more</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={mutedText}>
                    AI review is based on expert reviews and user feedback from trusted sources.
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          ) : (
            <View style={[styles.centered, { paddingVertical: tokens.space.xl }]}>
              <Text style={[bodyText, styles.centeredText, { color: tokens.color.textMuted }]}>
                {COLLECTION_SECTION_COPY.aiReviewUnavailable}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  betaChip: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: {
    width: HEADER_ICON,
    height: HEADER_ICON,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  identityThumb: {
    width: IDENTITY_THUMB,
    height: IDENTITY_THUMB,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  identityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletText: {
    flex: 1,
  },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  sourceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  sourceChip: {
    minWidth: 0,
  },
  sourceMore: {
    alignItems: 'center',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredText: {
    textAlign: 'center',
  },
});
