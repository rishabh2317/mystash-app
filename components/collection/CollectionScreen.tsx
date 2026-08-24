import { ProductCard, ProductDetailsSheet } from '@/components/commerce';
import { FollowControl } from '@/components/engagement/FollowControl';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { openProductShopping } from '@/src/services/shoppingClick';
import { useIsFocused } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CollectionMediaReference } from './CollectionMediaReference';
import { CollectionPageHeader } from './CollectionPageHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  collectionMediaReference,
  COLLECTION_SCROLL_HORIZONTAL_PADDING,
  splitCollectionProducts,
} from '@/src/ui/collectionLayout';

type Props = {
  collection: CollectionDetailViewModel;
  isLight: boolean;
  isSaved?: boolean;
  savePending?: boolean;
  onSavePress?: () => void;
  onSharePress?: () => void;
  isFollowing?: boolean;
  followPending?: boolean;
  isSelf?: boolean;
  onFollowPress?: () => void;
};

export function CollectionScreen({
  collection,
  isLight,
  isSaved = false,
  savePending = false,
  onSavePress,
  onSharePress,
  isFollowing = false,
  followPending = false,
  isSelf = false,
  onFollowPress,
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
  const caption = collection.caption?.trim() ?? '';
  const media = useMemo(() => collectionMediaReference(collection), [collection]);
  const { featured, shopAll } = useMemo(
    () => splitCollectionProducts(collection.products),
    [collection.products],
  );

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

  const openDetails = useCallback((p: CatalogProductViewModel) => {
    setDetailsProduct(p);
    setDetailsVisible(true);
  }, []);

  const productCount = collection.products.length;
  const isFocused = useIsFocused();

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
        <View style={styles.creatorRow}>
          {collection.creator.avatarUrl ? (
            <Pressable
              onPress={collection.creator.username ? openCreator : undefined}
              disabled={!collection.creator.username}
            >
              <Image
                source={{ uri: collection.creator.avatarUrl }}
                style={styles.avatar}
                contentFit="cover"
              />
            </Pressable>
          ) : (
            <View style={[styles.avatar, { backgroundColor: tokens.color.canvasEnd }]} />
          )}
          <View style={styles.creatorCopy}>
            <View style={styles.nameRow}>
              <Pressable
                onPress={collection.creator.username ? openCreator : undefined}
                disabled={!collection.creator.username}
                accessibilityRole="link"
                accessibilityLabel={`Creator ${creatorLabel}`}
              >
                <Text style={[styles.creator, { color: tokens.color.accent }]}>{creatorLabel}</Text>
              </Pressable>
              {!isSelf && onFollowPress ? (
                <FollowControl
                  isFollowing={isFollowing}
                  pending={followPending}
                  size="compact"
                  onPress={onFollowPress}
                />
              ) : null}
            </View>
            {collection.creator.username ? (
              <Text style={[styles.handle, { color: muted }]}>@{collection.creator.username}</Text>
            ) : null}
          </View>
        </View>

        {caption ? (
          <Text style={[styles.caption, { color: muted }]}>{caption}</Text>
        ) : null}

        {media ? (
          <CollectionMediaReference
            media={media}
            collection={collection}
            isActive={isFocused}
          />
        ) : null}

        {featured.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: text }]}>Featured</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
            >
              {featured.map((product) => (
                <View key={`featured-${product.id}`} style={styles.railCard}>
                  <ProductCard
                    product={product}
                    isLight={isLight}
                    variant="compact"
                    onPress={openDetails}
                    onAddToCart={product.catalogProductId ? onAddToCart : undefined}
                    onBuy={product.catalogProductId ? onBuy : undefined}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: text }]}>Shop all products</Text>
          {shopAll.length === 0 ? (
            <Text style={[styles.empty, { color: muted }]}>No products in this collection yet.</Text>
          ) : (
            shopAll.map((product) => (
              <View key={product.id} style={styles.productRow}>
                <ProductCard
                  product={product}
                  isLight={isLight}
                  variant="standard"
                  onPress={openDetails}
                  onAddToCart={product.catalogProductId ? onAddToCart : undefined}
                  onBuy={product.catalogProductId ? onBuy : undefined}
                />
              </View>
            ))
          )}
        </View>
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
    paddingHorizontal: COLLECTION_SCROLL_HORIZONTAL_PADDING,
    paddingBottom: 40,
    gap: 12,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  creatorCopy: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  creator: {
    fontSize: 17,
    fontWeight: '800',
  },
  handle: {
    fontSize: 13,
    fontWeight: '600',
  },
  caption: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
  },
  section: {
    gap: 10,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  empty: {
    fontSize: 14,
  },
  rail: {
    gap: 10,
    paddingRight: 8,
  },
  railCard: {
    width: 268,
  },
  productRow: {
    marginTop: 2,
  },
});
