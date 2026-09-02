import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ContextActions } from '@/components/chrome/ContextActions';
import { TopBar } from '@/components/chrome/TopBar';
import { ProductDetailsSheet } from '@/components/commerce';
import { CreatorProfile } from '@/components/creator/CreatorProfile';
import type { CreatorProfileTab } from '@/components/creator/CreatorProfileHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { mapCreatorProductToCatalogViewModel } from '@/src/mappers/creatorProductMapper';
import { pageCanvasGradient } from '@/src/theme/tokens';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import {
  listCreatorCollections,
  listCreatorProducts,
} from '@/src/services/collectionApi';
import { useCreatorFollowHandler } from '@/src/services/creatorFollowOrchestration';
import { isFollowingCreator } from '@/src/services/engagementApi';
import {
  useProductAddToCartHandler,
  useProductBuyHandler,
} from '@/src/services/productActionOrchestration';
import { shareCreatorProfile } from '@/src/services/shareLinks';
import { fetchPublicCreatorByUsername, UserApiError } from '@/src/services/userApi';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';

export default function CreatorProfileScreen() {
  const router = useRouter();
  const { tokens, isLight } = useThemeMode();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ username?: string | string[] }>();
  const usernameParam = Array.isArray(params.username) ? params.username[0] : params.username;

  const [creator, setCreator] = useState<CreatorViewModel | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab] = useState<CreatorProfileTab>('collections');
  const [collections, setCollections] = useState<CollectionViewModel[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsLoadingMore, setCollectionsLoadingMore] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [collectionsCursor, setCollectionsCursor] = useState<string | null>(null);

  const [products, setProducts] = useState<CatalogProductViewModel[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsLoadingMore, setProductsLoadingMore] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productsCursor, setProductsCursor] = useState<string | null>(null);
  const [productsLoaded, setProductsLoaded] = useState(false);

  const [followPending, setFollowPending] = useState(false);
  const [detailsProduct, setDetailsProduct] = useState<CatalogProductViewModel | null>(null);

  const onAddToCart = useProductAddToCartHandler();
  const onBuy = useProductBuyHandler();
  const loadGen = useRef(0);

  const loadProfile = useCallback(async (username: string) => {
    const gen = ++loadGen.current;
    setProfileLoading(true);
    setProfileError(null);
    setNotFound(false);
    setActiveTab('collections');
    setProducts([]);
    setProductsLoaded(false);
    setProductsCursor(null);
    try {
      const profile = await fetchPublicCreatorByUsername(username);
      if (gen !== loadGen.current) return;
      setCreator(profile);
      setProfileLoading(false);

      if (user && user.id !== profile.userId) {
        try {
          const following = await isFollowingCreator(profile.userId);
          if (gen !== loadGen.current) return;
          setCreator((prev) => (prev ? { ...prev, isFollowing: following } : prev));
        } catch {
          /* ignore follow status errors */
        }
      }
    } catch (e) {
      if (gen !== loadGen.current) return;
      if (e instanceof UserApiError && e.statusCode === 301 && e.redirectToUsername) {
        router.replace(`/creator/${encodeURIComponent(e.redirectToUsername)}`);
        return;
      }
      setProfileLoading(false);
      if (e instanceof UserApiError && e.statusCode === 404) {
        setNotFound(true);
        setProfileError(null);
      } else {
        setProfileError(e instanceof Error ? e.message : 'Could not load creator');
      }
    }
  }, [router, user]);

  const loadCollections = useCallback(
    async (creatorId: string, cursor?: string | null, append = false) => {
      if (append) setCollectionsLoadingMore(true);
      else {
        setCollectionsLoading(true);
        setCollectionsError(null);
      }
      try {
        const page = await listCreatorCollections(creatorId, {
          limit: 20,
          cursor: cursor ?? null,
        });
        setCollections((prev) => (append ? [...prev, ...page.collections] : page.collections));
        setCollectionsCursor(page.nextCursor);
      } catch (e) {
        setCollectionsError(e instanceof Error ? e.message : 'Could not load collections');
      } finally {
        setCollectionsLoading(false);
        setCollectionsLoadingMore(false);
      }
    },
    [],
  );

  const loadProducts = useCallback(
    async (creatorId: string, cursor?: string | null, append = false) => {
      if (append) setProductsLoadingMore(true);
      else {
        setProductsLoading(true);
        setProductsError(null);
      }
      try {
        const page = await listCreatorProducts(creatorId, {
          limit: 20,
          cursor: cursor ?? null,
        });
        const mapped = page.products.map(mapCreatorProductToCatalogViewModel);
        setProducts((prev) => (append ? [...prev, ...mapped] : mapped));
        setProductsCursor(page.nextCursor);
        setProductsLoaded(true);
      } catch (e) {
        setProductsError(e instanceof Error ? e.message : 'Could not load products');
      } finally {
        setProductsLoading(false);
        setProductsLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!usernameParam?.trim()) {
      setNotFound(true);
      setProfileLoading(false);
      return;
    }
    void loadProfile(usernameParam.trim());
  }, [usernameParam, loadProfile]);

  useEffect(() => {
    if (!creator?.userId) return;
    void loadCollections(creator.userId);
  }, [creator?.userId, loadCollections]);

  useEffect(() => {
    if (!creator?.userId || activeTab !== 'products' || productsLoaded) return;
    void loadProducts(creator.userId);
  }, [activeTab, creator?.userId, loadProducts, productsLoaded]);

  const isSelf = Boolean(user && creator && user.id === creator.userId);

  const followHandler = useCreatorFollowHandler({
    creatorId: creator?.userId ?? '',
    username: creator?.username ?? usernameParam ?? '',
    isSelf,
    isFollowing: Boolean(creator?.isFollowing),
    onOptimisticFollow: (next) => {
      setFollowPending(true);
      setCreator((prev) =>
        prev
          ? {
              ...prev,
              isFollowing: next,
              followersCount: Math.max(0, prev.followersCount + (next ? 1 : -1)),
            }
          : prev,
      );
    },
    onRollback: (previous) => {
      setCreator((prev) =>
        prev
          ? {
              ...prev,
              isFollowing: previous,
              followersCount: Math.max(0, prev.followersCount + (previous ? 1 : -1)),
            }
          : prev,
      );
    },
  });

  const onFollowPress = useCallback(async () => {
    await followHandler();
    setFollowPending(false);
  }, [followHandler]);

  const onPressCollection = useCallback(
    (collection: CollectionViewModel) => {
      router.push(collectionTilePressPath(collection.collectionId) as Href);
    },
    [router],
  );

  const onSharePress = useCallback(async () => {
    if (!creator) return;
    try {
      await shareCreatorProfile({
        username: creator.username,
        displayName: creator.displayName,
        creatorId: creator.userId,
        surface: 'creator_profile',
      });
    } catch (e) {
      Alert.alert('Share', e instanceof Error ? e.message : 'Could not share profile.');
    }
  }, [creator]);

  const onEndReached = useCallback(() => {
    if (!creator) return;
    if (activeTab === 'collections') {
      if (!collectionsCursor || collectionsLoadingMore) return;
      void loadCollections(creator.userId, collectionsCursor, true);
      return;
    }
    if (!productsCursor || productsLoadingMore) return;
    void loadProducts(creator.userId, productsCursor, true);
  }, [
    activeTab,
    collectionsCursor,
    collectionsLoadingMore,
    creator,
    loadCollections,
    loadProducts,
    productsCursor,
    productsLoadingMore,
  ]);

  const onRetry = useCallback(() => {
    if (!creator) return;
    if (activeTab === 'collections') {
      void loadCollections(creator.userId);
      return;
    }
    setProductsLoaded(false);
    void loadProducts(creator.userId);
  }, [activeTab, creator, loadCollections, loadProducts]);

  const text = tokens.color.text;
  const muted = tokens.color.textMuted;
  const bg = [...pageCanvasGradient(tokens), tokens.color.canvas] as const;

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
      <TopBar
        mode="page"
        title={creator ? `@${creator.username}` : 'Creator'}
        showBack
        showBag={false}
        trailing={
          creator ? (
            <ContextActions
              share={{
                onPress: () => void onSharePress(),
                accessibilityLabel: 'Share creator profile',
              }}
            />
          ) : undefined
        }
      />

      {profileLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={text} />
        </View>
      ) : notFound ? (
        <View style={styles.centered}>
          <Text style={[styles.stateTitle, { color: text }]}>Creator not found</Text>
          <Text style={[styles.stateBody, { color: muted }]}>
            This profile may be unavailable or the username is incorrect.
          </Text>
          <Pressable onPress={() => router.back()} style={styles.retry}>
            <Text style={{ color: text, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
      ) : profileError ? (
        <View style={styles.centered}>
          <Text style={[styles.stateTitle, { color: text }]}>Couldn’t load creator</Text>
          <Text style={[styles.stateBody, { color: muted }]}>{profileError}</Text>
          <Pressable
            onPress={() => usernameParam && void loadProfile(usernameParam)}
            style={styles.retry}
          >
            <Text style={{ color: text, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      ) : creator ? (
        <CreatorProfile
          creator={creator}
          collections={collections}
          products={products}
          isLight={isLight}
          isSelf={isSelf}
          followPending={followPending}
          activeTab={activeTab}
          collectionsLoading={collectionsLoading}
          collectionsLoadingMore={collectionsLoadingMore}
          collectionsError={collectionsError}
          productsLoading={productsLoading}
          productsLoadingMore={productsLoadingMore}
          productsError={productsError}
          onFollowPress={() => void onFollowPress()}
          onTabChange={setActiveTab}
          onPressCollection={onPressCollection}
          onPressProduct={setDetailsProduct}
          onEndReached={onEndReached}
          onRetry={onRetry}
        />
      ) : null}

      <ProductDetailsSheet
        visible={detailsProduct != null}
        product={detailsProduct}
        onClose={() => setDetailsProduct(null)}
        onAddToCart={detailsProduct?.catalogProductId ? onAddToCart : undefined}
        onBuy={detailsProduct?.catalogProductId ? onBuy : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 8,
  },
  stateTitle: { fontSize: 18, fontWeight: '800' },
  stateBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: { marginTop: 12, padding: 12 },
});
