import InstagramReelItem from '@/components/InstagramReelItem';
import YouTubeReelItem from '@/components/YouTubeReelItem';
import { ProductCard, ProductDetailsSheet } from '@/components/commerce';
import type { Video } from '@/src/mocks/videos';
import {
  useProductAddToCartHandler,
} from '@/src/services/productActionOrchestration';
import { openProductShopping } from '@/src/services/shoppingClick';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import { getVideoUrlInfo } from '@/src/utils/videoUtils';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CollectionPageHeader } from './CollectionPageHeader';
import { useThemeMode } from '@/contexts/ThemeContext';

type Props = {
  collection: CollectionDetailViewModel;
  isLight: boolean;
  isSaved?: boolean;
  savePending?: boolean;
  onSavePress?: () => void;
  onSharePress?: () => void;
};

function mediaPreviewVideo(
  collection: CollectionDetailViewModel,
): Video | null {
  const media = collection.primaryMedia;
  if (!media?.sourceUrl && !media?.embedUrl) return null;
  const url = media.sourceUrl ?? media.embedUrl ?? '';
  return {
    id: `collection-preview:${collection.collectionId}`,
    url,
    thumbnail: media.thumbnailUrl ?? collection.heroThumbnailUrl ?? '',
    creator_name: collection.creator.displayName ?? collection.creator.username ?? 'Creator',
    stash_score: collection.qualityScore ?? 0,
    product_name: collection.products[0]?.title ?? collection.title ?? 'Collection',
    embed_url: media.embedUrl ?? undefined,
    video_title: media.title ?? collection.title ?? undefined,
    curator_id: collection.creator.username ?? undefined,
    collection_id: collection.collectionId,
  };
}

export function CollectionScreen({
  collection,
  isLight,
  isSaved = false,
  savePending = false,
  onSavePress,
  onSharePress,
}: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const onAddToCart = useProductAddToCartHandler();
  const [detailsProduct, setDetailsProduct] = useState<CatalogProductViewModel | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const text = tokens.color.text;
  const muted = tokens.color.textMuted;

  const headerTitle = collection.title?.trim() || 'Collection';

  const creatorLabel =
    collection.creator.displayName?.trim() ||
    (collection.creator.username ? `@${collection.creator.username}` : 'Creator');

  const previewVideo = useMemo(() => mediaPreviewVideo(collection), [collection]);
  const urlInfo = previewVideo?.url ? getVideoUrlInfo(previewVideo.url) : null;

  const onBuy = useCallback(
    async (product: CatalogProductViewModel) => {
      if (!product.catalogProductId) {
        Alert.alert('Link unavailable', 'No shopping destination is available for this product yet.');
        return;
      }
      try {
        await openProductShopping({
          catalogProductId: product.catalogProductId,
          collectionId: collection.collectionId,
          creatorId: collection.creator.id,
        });
      } catch {
        Alert.alert('Error', 'Could not open the product link.');
      }
    },
    [collection.collectionId, collection.creator.id],
  );

  const openCreator = useCallback(() => {
    const handle = collection.creator.username?.trim();
    if (handle) {
      router.push(`/creator/${encodeURIComponent(handle)}`);
    }
  }, [collection.creator.username, router]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.color.canvas }]}>
      <CollectionPageHeader
        title={headerTitle}
        isSaved={isSaved}
        savePending={savePending}
        onSavePress={onSavePress}
        onSharePress={onSharePress}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.contextBlock}>
          {collection.creator.avatarUrl ? (
            <Image
              source={{ uri: collection.creator.avatarUrl }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : null}
          <View style={styles.contextText}>
            <Pressable
              onPress={collection.creator.username ? openCreator : undefined}
              disabled={!collection.creator.username}
            >
              <Text style={[styles.creator, { color: tokens.color.accent }]}>
                {creatorLabel}
              </Text>
            </Pressable>
            {collection.qualityScore != null ? (
              <Text style={[styles.meta, { color: muted }]}>
                Stash score {collection.qualityScore.toFixed(1)}
              </Text>
            ) : null}
            {collection.caption?.trim() ? (
              <Text style={[styles.caption, { color: muted }]}>{collection.caption.trim()}</Text>
            ) : null}
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: text }]}>All products</Text>
        {collection.products.length === 0 ? (
          <Text style={[styles.empty, { color: muted }]}>No products in this collection yet.</Text>
        ) : (
          collection.products.map((product) => (
            <View key={product.id} style={styles.productRow}>
              <ProductCard
                product={product}
                isLight={isLight}
                variant="standard"
                onPress={(p) => {
                  setDetailsProduct(p);
                  setDetailsVisible(true);
                }}
                onAddToCart={product.catalogProductId ? onAddToCart : undefined}
                onBuy={product.catalogProductId ? onBuy : undefined}
              />
            </View>
          ))
        )}

        {previewVideo && urlInfo?.isValid ? (
          <View style={styles.mediaSection}>
            <View style={styles.mediaHeaderRow}>
              <Text style={[styles.sectionTitle, { color: text, marginTop: 0 }]}>Source video</Text>
              <Pressable
                onPress={() => router.push(`/reel/${collection.collectionId}` as Href)}
                accessibilityRole="button"
                accessibilityLabel="Open immersive reel"
                style={styles.watchBtn}
              >
                <Text style={[styles.watchBtnText, { color: tokens.color.accent }]}>
                  Watch reel
                </Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => router.push(`/reel/${collection.collectionId}` as Href)}
              accessibilityRole="button"
              accessibilityLabel="Open immersive reel"
            >
              <View
                style={[
                  styles.mediaBox,
                  { backgroundColor: isLight ? '#111827' : '#000' },
                ]}
              >
                {urlInfo.platform === 'youtube' ? (
                  <YouTubeReelItem video={previewVideo} isActive onBuyPress={() => {}} />
                ) : urlInfo.platform === 'instagram' ? (
                  <InstagramReelItem video={previewVideo} isActive onBuyPress={() => {}} />
                ) : null}
              </View>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <ProductDetailsSheet
        visible={detailsVisible}
        product={detailsProduct}
        isLight={isLight}
        onClose={() => setDetailsVisible(false)}
        onAddToCart={detailsProduct?.catalogProductId ? onAddToCart : undefined}
        onBuy={detailsProduct?.catalogProductId ? onBuy : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  contextBlock: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginTop: 4,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#94A3B8',
  },
  contextText: {
    flex: 1,
    gap: 4,
  },
  creator: {
    fontSize: 16,
    fontWeight: '700',
  },
  meta: {
    fontSize: 13,
    fontWeight: '600',
  },
  caption: {
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 8,
  },
  empty: {
    fontSize: 14,
    marginTop: 4,
  },
  productRow: {
    marginTop: 4,
  },
  mediaSection: {
    marginTop: 8,
    gap: 10,
  },
  mediaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  watchBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  watchBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  mediaBox: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 420,
    borderRadius: 16,
    overflow: 'hidden',
  },
});
