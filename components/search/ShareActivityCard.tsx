import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import React, { useState } from 'react';
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
  onRetry,
  onDelete,
}: Props) {
  const { tokens, isLight } = useThemeMode();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const time = shareActivityRelativeTime(item.createdAt);
  const stateLabel = shareActivityStateLabel(item.userState);
  const failed = item.userState === 'failed';
  const showBagLink =
    item.userState === 'products_found' ||
    item.userState === 'no_products' ||
    item.userState === 'processing';

  const confirmDelete = () => {
    Alert.alert('Delete share', 'Remove this share from your activity history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!onDelete) return;
          setBusy(true);
          void Promise.resolve(onDelete(item.importId)).finally(() => setBusy(false));
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
        style={[styles.card, { paddingVertical: compact ? 10 : 12 }]}
        accessibilityRole="button"
        accessibilityState={expandable ? { expanded } : undefined}
        accessibilityLabel={`${item.title}. ${item.subtitle}`}
      >
        <View style={[styles.thumb, { backgroundColor: tokens.color.surfaceSubtle }]}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumbImage} contentFit="cover" />
          ) : (
            <Ionicons name={platformIcon(item.kind)} size={20} color={tokens.color.textMuted} />
          )}
        </View>
        <View style={styles.body}>
          <Text
            style={{ color: tokens.color.text, fontSize: 14, fontWeight: '700' }}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text
            style={{ color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}
            numberOfLines={2}
          >
            {item.subtitle}
          </Text>
          <View style={styles.meta}>
            {item.userState === 'processing' ? (
              <ActivityIndicator size="small" color={tokens.color.accent} />
            ) : (
              <Text style={{ color: tokens.color.textMuted, fontSize: 12, fontWeight: '600' }}>
                {stateLabel}
              </Text>
            )}
            {time ? (
              <Text style={{ color: tokens.color.textMuted, fontSize: 12 }}>{time}</Text>
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
        <View style={[styles.expanded, { borderTopColor: tokens.color.divider }]}>
          {item.sourceUrl ? (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: tokens.color.textMuted }]}>
                {SHARE_ACTIVITY_COPY.sourceLabel}
              </Text>
              <Text
                style={{ color: tokens.color.text, fontSize: 13, lineHeight: 18 }}
                numberOfLines={3}
                selectable
              >
                {item.sourceUrl}
              </Text>
            </View>
          ) : null}
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: tokens.color.textMuted }]}>
              {SHARE_ACTIVITY_COPY.sharedAt}
            </Text>
            <Text style={{ color: tokens.color.text, fontSize: 13 }}>
              {time || item.createdAt}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: tokens.color.textMuted }]}>
              {SHARE_ACTIVITY_COPY.stateLabel}
            </Text>
            <Text style={{ color: tokens.color.text, fontSize: 13, fontWeight: '600' }}>
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
            <Text style={{ color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
              {SHARE_ACTIVITY_COPY.noProducts}
            </Text>
          ) : failed ? (
            <Text style={{ color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
              {SHARE_ACTIVITY_COPY.failed}
            </Text>
          ) : item.userState === 'processing' ? (
            <Text style={{ color: tokens.color.textMuted, fontSize: 13, lineHeight: 18 }}>
              {item.subtitle}
            </Text>
          ) : null}

          {failed ? (
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => {
                  if (!onRetry || busy) return;
                  setBusy(true);
                  void Promise.resolve(onRetry(item.importId)).finally(() => setBusy(false));
                }}
                disabled={busy || !onRetry}
                style={[
                  styles.actionBtn,
                  { borderColor: tokens.color.border, backgroundColor: tokens.color.primarySurface },
                ]}
                accessibilityRole="button"
                accessibilityLabel={SHARE_ACTIVITY_COPY.retry}
              >
                <Text style={{ color: tokens.color.onPrimarySurface, fontWeight: '700', fontSize: 14 }}>
                  {SHARE_ACTIVITY_COPY.retry}
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                disabled={busy || !onDelete}
                style={[styles.actionBtn, { borderColor: tokens.color.border }]}
                accessibilityRole="button"
                accessibilityLabel={SHARE_ACTIVITY_COPY.delete}
              >
                <Text style={{ color: tokens.color.danger, fontWeight: '700', fontSize: 14 }}>
                  {SHARE_ACTIVITY_COPY.delete}
                </Text>
              </Pressable>
            </View>
          ) : showBagLink ? (
            <Pressable
              onPress={() => router.push('/cart' as Href)}
              style={[styles.bagLink, { borderColor: tokens.color.border }]}
              accessibilityRole="link"
              accessibilityLabel={SHARE_ACTIVITY_COPY.viewInBag}
            >
              <Text style={{ color: tokens.color.primary, fontSize: 14, fontWeight: '700' }}>
                {SHARE_ACTIVITY_COPY.viewInBag}
              </Text>
              <Ionicons name="bag-handle-outline" size={16} color={tokens.color.primary} />
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
    overflow: 'hidden',
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
