import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import React, { useState } from 'react';
import { ShareImportDetails } from './ShareImportDetails';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ProductCard } from '@/components/commerce/ProductCard';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { ImportSharePrimaryProduct } from '@/src/services/importShareMap';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import {
  SHARE_ACTIVITY_COPY,
  shareActivityRelativeTime,
  shareActivityStateLabel,
  type ShareActivityView,
} from '@/src/ui/shareActivity';
import { productPagePath } from '@/src/ui/productPage';

type Props = {
  item: ShareActivityView;
  compact?: boolean;
  /** Expand/collapse inline — used by Your Activity and Your Shares. */
  expandable?: boolean;
  presentation?: 'default' | 'finds';
  onRetry?: (importId: string) => void | Promise<void>;
  onDelete?: (importId: string) => void | Promise<void>;
};

function platformIcon(kind: ShareActivityView['kind']): keyof typeof Ionicons.glyphMap {
  if (kind === 'instagram') return 'logo-instagram';
  if (kind === 'youtube') return 'logo-youtube';
  return 'link-outline';
}

function thinProduct(p: ImportSharePrimaryProduct): CatalogProductViewModel {
  return {
    id: p.productId,
    catalogProductId: p.productId,
    title: p.title,
    brand: null,
    merchant: null,
    heroImage: p.imageUrl ?? CATALOG_IMAGE_PLACEHOLDER,
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'UNRESOLVED',
    availability: null,
    price: null,
    currency: null,
    lastVerifiedAt: null,
    metadataCompleteness: null,
    category: null,
  };
}

/** Shared expandable activity/share card for Search Activity and Your Shares. */
export function ShareActivityCard({
  item,
  compact = false,
  expandable = true,
  presentation = 'default',
  onRetry,
  onDelete,
}: Props) {
  const { tokens, isLight } = useThemeMode();
  const refined = presentation === 'finds';
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const time = shareActivityRelativeTime(item.createdAt);
  const stateLabel = shareActivityStateLabel(item.userState);
  const failed = item.canRetry ?? item.userState === 'failed';
  const showBagLink =
    item.userState === 'products_found' ||
    item.userState === 'no_products' ||
    item.userState === 'processing' || item.productCount > 0;

  const confirmDelete = () => {
    Alert.alert('Delete share', 'Remove this share from your activity history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!onDelete) return;
          setBusy(true);
          void Promise.resolve(onDelete(item.importId)).catch(() => {
            Alert.alert('Couldn’t delete share', 'Please try again.');
          }).finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.lg,
        },
      ]}
    >
      <Pressable
        onPress={() => {
          if (expandable) setExpanded((v) => !v);
        }}
        disabled={!expandable || busy}
        style={[styles.card, { paddingVertical: compact ? 10 : 12 }, refined && { padding: tokens.space.sm, gap: tokens.space.sm, minHeight: 48 }]}
        accessibilityRole="button"
        accessibilityState={expandable ? { expanded } : undefined}
        accessibilityLabel={`${item.title}. ${item.subtitle}`}
      >
        <View style={[styles.thumb, { backgroundColor: tokens.color.surfaceSubtle }, refined && { borderRadius: tokens.radius.sm }]}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumbImage} contentFit="cover" />
          ) : (
            <Ionicons name={platformIcon(item.kind)} size={20} color={tokens.color.textMuted} />
          )}
        </View>
        <View style={[styles.body, refined && { gap: tokens.space.xxs }]}>
          <Text
            style={refined ? typeStyle(tokens, 'tileTitle') : { color: tokens.color.text, fontSize: 14, fontWeight: '700' }}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text
            style={refined ? typeStyle(tokens, 'caption') : { color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}
            numberOfLines={2}
          >
            {item.subtitle}
          </Text>
          <View style={styles.meta}>
            {(item.hasInFlight ?? item.userState === 'processing') ? (
              <ActivityIndicator size="small" color={tokens.color.accent} />
            ) : (
              <Text style={refined ? [typeStyle(tokens, 'tileMeta'), { fontFamily: tokens.fontFamily.semibold }] : { color: tokens.color.textMuted, fontSize: 12, fontWeight: '600' }}>
                {stateLabel}
              </Text>
            )}
            {time ? (
              <Text style={refined ? typeStyle(tokens, 'tileMeta') : { color: tokens.color.textMuted, fontSize: 12 }}>{time}</Text>
            ) : null}
          </View>
        </View>
        {expandable ? (
          <Ionicons
            name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={16}
            color={tokens.color.textMuted}
          />
        ) : null}
      </Pressable>

      {expandable && expanded ? (
        <View style={[styles.expanded, { borderTopColor: tokens.color.divider }, refined && { padding: tokens.space.sm, gap: tokens.space.md }]}>
          {process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED === 'true' || process.env.EXPO_PUBLIC_SHARE_INTENT_ENABLED === 'true' || process.env.EXPO_PUBLIC_SHARE_SUGGESTIONS_ENABLED === 'true' ? <ShareImportDetails importId={item.importId} sourceUrl={item.sourceUrl} placeCount={item.placeCount} productCount={item.productCount} presentation={presentation} /> : null}
          {item.sourceUrl ? (
            <View style={styles.detailBlock}>
              <Text style={refined ? [typeStyle(tokens, 'tileMeta'), { fontFamily: tokens.fontFamily.semibold }] : [styles.detailLabel, { color: tokens.color.textMuted }]}>
                {SHARE_ACTIVITY_COPY.sourceLabel}
              </Text>
              <Text
                style={refined ? [typeStyle(tokens, 'caption'), { color: tokens.color.text }] : { color: tokens.color.text, fontSize: 13, lineHeight: 18 }}
                numberOfLines={3}
                selectable
              >
                {item.sourceUrl}
              </Text>
            </View>
          ) : null}
          <View style={styles.detailRow}>
            <Text style={refined ? [typeStyle(tokens, 'tileMeta'), { fontFamily: tokens.fontFamily.semibold }] : [styles.detailLabel, { color: tokens.color.textMuted }]}>
              {SHARE_ACTIVITY_COPY.sharedAt}
            </Text>
            <Text style={refined ? [typeStyle(tokens, 'caption'), { color: tokens.color.text }] : { color: tokens.color.text, fontSize: 13 }}>
              {time || item.createdAt}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={refined ? [typeStyle(tokens, 'tileMeta'), { fontFamily: tokens.fontFamily.semibold }] : [styles.detailLabel, { color: tokens.color.textMuted }]}>
              {SHARE_ACTIVITY_COPY.stateLabel}
            </Text>
            <Text style={refined ? [typeStyle(tokens, 'caption'), { color: tokens.color.text, fontFamily: tokens.fontFamily.semibold }] : { color: tokens.color.text, fontSize: 13, fontWeight: '600' }}>
              {stateLabel}
            </Text>
          </View>

          {item.userState === 'products_found' && item.products.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.productRail}
            >
              {item.products.map((product) => (
                <View key={product.productId} style={styles.productCell}>
                  <ProductCard
                    product={thinProduct(product)}
                    isLight={isLight}
                    variant="compact"
                    showIndexPrice
                    onPress={(p) => {
                      router.push(
                        productPagePath(p.id, {
                          contentSourceId: item.contentSourceId,
                          userImportId: item.importId,
                        }) as Href,
                      );
                    }}
                  />
                </View>
              ))}
            </ScrollView>
          ) : item.userState === 'no_products' ? (
            <Text style={refined ? typeStyle(tokens, 'caption') : { color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
              {item.subtitle}
            </Text>
          ) : failed ? (
            <Text style={refined ? typeStyle(tokens, 'caption') : { color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
              {SHARE_ACTIVITY_COPY.failed}
            </Text>
          ) : item.userState === 'processing' ? (
            <Text style={refined ? typeStyle(tokens, 'caption') : { color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
              {item.subtitle}
            </Text>
          ) : null}

          {failed ? (
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => {
                  if (!onRetry || busy) return;
                  setBusy(true);
                  void Promise.resolve(onRetry(item.importId)).catch(() => {
                    Alert.alert('Couldn’t retry', 'Please try again. Your saved results are unchanged.');
                  }).finally(() => setBusy(false));
                }}
                disabled={busy || !onRetry}
                style={[
                  styles.actionBtn,
                  { borderColor: tokens.color.border, backgroundColor: tokens.color.primarySurface }, refined && { minHeight: 48, borderRadius: tokens.radius.md },
                ]}
                accessibilityRole="button"
                accessibilityLabel={SHARE_ACTIVITY_COPY.retry}
              >
                <Text style={refined ? [typeStyle(tokens, 'cta'), { color: tokens.color.onPrimarySurface }] : { color: tokens.color.onPrimarySurface, fontWeight: '700', fontSize: 14 }}>
                  {SHARE_ACTIVITY_COPY.retry}
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                disabled={busy || !onDelete}
                style={[styles.actionBtn, { borderColor: tokens.color.border }, refined && { minHeight: 48, borderRadius: tokens.radius.md }]}
                accessibilityRole="button"
                accessibilityLabel={SHARE_ACTIVITY_COPY.delete}
              >
                <Text style={refined ? [typeStyle(tokens, 'cta'), { color: tokens.color.danger }] : { color: tokens.color.danger, fontWeight: '700', fontSize: 14 }}>
                  {SHARE_ACTIVITY_COPY.delete}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {showBagLink ? (
            <Pressable
              onPress={() => router.push('/cart' as Href)}
              style={[styles.bagLink, { borderColor: tokens.color.border }, refined && { minHeight: 48, borderRadius: tokens.radius.md }]}
              accessibilityRole="link"
              accessibilityLabel={SHARE_ACTIVITY_COPY.viewInBag}
            >
              <Text style={refined ? [typeStyle(tokens, 'cta'), { color: tokens.color.primary }] : { color: tokens.color.primary, fontSize: 14, fontWeight: '700' }}>
                {SHARE_ACTIVITY_COPY.viewInBag}
              </Text>
              <Ionicons name="bag-handle-outline" size={16} color={tokens.color.primary} />
            </Pressable>
          ) : null}
          {(item.placeCount ?? 0) > 0 ? (
            <Pressable
              onPress={() => router.push('/stash?segment=places' as Href)}
              style={[styles.bagLink, { borderColor: tokens.color.border }, refined && { minHeight: 48, borderRadius: tokens.radius.md }]}
              accessibilityRole="link"
              accessibilityLabel="View places"
            >
              <Text style={refined ? [typeStyle(tokens, 'cta'), { color: tokens.color.primary }] : { color: tokens.color.primary, fontSize: 14, fontWeight: '700' }}>View places</Text>
              <Ionicons name="location-outline" size={16} color={tokens.color.primary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  body: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  expanded: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  detailBlock: { gap: 4 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailLabel: { fontSize: 12, fontWeight: '600' },
  productRail: { gap: 10, paddingVertical: 4 },
  productCell: { width: 140 },
  bagLink: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
