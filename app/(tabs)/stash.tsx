import { FailureState } from '@/components/status/FailureState';
import { createPlacesRequestScope } from '@/src/ui/placesRequestScope';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProductCard } from '@/components/commerce/ProductCard';
import { CartPurchaseConfirmModal } from '@/components/commerce/CartPurchaseConfirmModal';
import { StashRecentProducts } from '@/components/commerce/StashRecentProducts';
import { StashSourceRail } from '@/components/commerce/StashSourceRail';
import { StashSignedOutState } from '@/components/commerce/StashSignedOutState';
import { StashHomeSkeleton } from '@/components/commerce/StashHomeSkeleton';
import { StashPlacesContent } from '@/components/place/StashPlacesContent';
import { PlaceSourceVideoModal } from '@/components/place/PlaceSourceVideoModal';
import { FeedProductSheet } from '@/components/feed/FeedProductSheet';
import { placeSourcePreview, withPlaceSourceVideos } from '@/src/ui/placeSourceVideo';
import { ProfileContentTabs } from '@/components/profile/ProfileContentTabs';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useImportSharesPoll } from '@/src/hooks/useImportSharesPoll';
import { findApi } from '@/src/services/findApi';
import type { FindItem } from '@/src/services/findClient';
import { fetchAllPlaces, removePlaceSave } from '@/src/services/placesApi';
import { typeStyle } from '@/src/theme/typography';
import type { PlaceSourceVideo, PlaceStashItem } from '@/src/types/placeStash';
import type { Product } from '@/src/mocks/videos';
import {
  BAG_PROGRESS_COPY,
  bagHasInFlightShares,
  bagItemFromLine,
  buildStashHome,
  type BagItemView,
} from '@/src/ui/bag';
import { BAG_COPY } from '@/src/ui/contracts';
import { productPagePath } from '@/src/ui/productPage';
import { resolveListLoadState } from '@/src/ui/contentLoadState';
import {
  DEFAULT_STASH_SEGMENT,
  STASH_PLACES_COPY,
  STASH_SEGMENT,
  STASH_SEGMENT_TABS,
  stashContentTab,
  type StashSegment,
} from '@/src/ui/stashPlaces';

const GUTTER = 16;
const GRID_GAP = 12;

export default function StashScreen() {
  const router = useRouter();
  const { segment } = useLocalSearchParams<{ segment?: string }>();
  const { tokens } = useThemeMode();
  const tabBarHeight = useBottomTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const { user, loading: authLoading } = useAuth();
  const {
    items,
    itemCount,
    status,
    errorMessage,
    refresh,
    removeItem,
    purchaseConfirmVisible,
    awaitingConfirmationProductId,
    resolvePurchaseConfirmation,
  } = useCart();
  const [shopping, setShopping] = useState<Product | null>(null);
  const [selectedSources, setSelectedSources] = useState<PlaceSourceVideo[] | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const accountRef = useRef(user?.id); accountRef.current = user?.id;
  const removingPlace = useRef(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
  const [stashTab, setStashTab] = useState<StashSegment>(DEFAULT_STASH_SEGMENT);
  const [placesData, setPlacesData] = useState<{ owner: string; items: PlaceStashItem[] } | null>(null);
  const placeItems = placesData && placesData.owner === user?.id ? placesData.items : [];
  const scopeRef = useRef<ReturnType<typeof createPlacesRequestScope> | null>(null);
  if (!scopeRef.current) scopeRef.current = createPlacesRequestScope();
  const placesScope = scopeRef.current;
  placesScope.setAccount(user?.id);
  const [placesStatus, setPlacesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [placesError,setPlacesError]=useState<unknown>(null);
  const [placesRefreshing, setPlacesRefreshing] = useState(false);

  const loadPlaces = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (!user) return;
    const accountId = user.id;
    const ticket = placesScope.begin();
    const current = () => placesScope.isCurrent(ticket);
    if (mode === 'refresh') setPlacesRefreshing(true);
    else setPlacesStatus((s) => (s === 'ready' ? 'ready' : 'loading'));
    try {
      const page = await fetchAllPlaces(current);
      if (!current()) return;
      setPlacesData({ owner: accountId, items: page.items });
      setPlacesStatus('ready');
    } catch (error) {
      if (!current()) return;
      setPlacesError(error);
      setPlacesStatus('error');
    } finally {
      if (current()) setPlacesRefreshing(false);
    }
  }, [placesScope, user]);

  const onBecameReady = useCallback(() => {
    setSourceRevision(n => n + 1);
    void refresh();
    if (stashTab === STASH_SEGMENT.places) void loadPlaces('refresh');
  }, [loadPlaces, refresh, stashTab]);
  const { shares, loaded: sharesLoaded, refresh: refreshShares } = useImportSharesPoll({
    enabled: Boolean(user),
    onBecameReady,
  });

  // Already-READY imports (e.g. completed on Search) must not leave a stale cart.
  useFocusEffect(
    useCallback(() => {
      if (!user) return undefined;
      void refresh();
      return undefined;
    }, [refresh, user]),
  );

  const bagItems = useMemo(() => items.map(bagItemFromLine), [items]);
  const home = useMemo(() => buildStashHome(bagItems), [bagItems]);
  const selectedCategory = useMemo(
    () => home.categories.find((category) => category.key === selectedCategoryKey) ?? null,
    [home.categories, selectedCategoryKey],
  );
  const looking = bagHasInFlightShares(shares);
  const [productSources, setProductSources] = useState<{ owner: string; items: FindItem[] } | null>(null);
  const sourceIds = JSON.stringify([...new Set(bagItems.map(item => item.userImportId).filter((id): id is string => Boolean(id)))].sort());
  useEffect(() => {
    const owner = user?.id;
    if (!owner) { setProductSources(null); return; }
    let cancelled = false;
    // The polling head is bounded. Resolve attributed older saves through the
    // existing owned batch API, rather than guessing a video URL or paging history.
    void (async () => {
      const ids: string[] = JSON.parse(sourceIds), resolved: FindItem[] = [];
      for (let index = 0; index < ids.length; index += 100) {
        const page = await findApi.batch(ids.slice(index, index + 100), owner);
        if (cancelled || accountRef.current !== owner) return;
        resolved.push(...page.items);
      }
      if (!cancelled && accountRef.current === owner) setProductSources({ owner, items: resolved });
    })().catch(() => { /* Existing import history remains usable when enrichment is offline. */ });
    return () => { cancelled = true; };
  }, [sourceIds, user?.id]);

  const confirmTitle = useMemo(() => {
    if (!awaitingConfirmationProductId) return null;
    return (
      bagItems.find((item) => item.catalogProductId === awaitingConfirmationProductId)?.title ??
      bagItems.find((item) => item.productId === awaitingConfirmationProductId)?.title ??
      null
    );
  }, [awaitingConfirmationProductId, bagItems]);

  const onOpenProduct = useCallback(
    (item: BagItemView) => {
      router.push(
        productPagePath(item.productId, {
          contentSourceId: item.contentSourceId,
          userImportId: item.userImportId,
        }) as Href,
      );
    },
    [router],
  );

  const onRemove = useCallback(
    (item: BagItemView) => {
      const owner = user?.id;
      if (!owner) return;
      Alert.alert(BAG_COPY.removeFromBag, `Remove ${item.title} from your Stash?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (accountRef.current !== owner) return;
            setActionError(null);
            void removeItem(item.productId, 'user_remove').catch(() => {
              if (accountRef.current === owner) setActionError(BAG_COPY.removeError);
            });
          },
        },
      ]);
    },
    [removeItem, user?.id],
  );

  const onRemovePlace = (item: PlaceStashItem) => {
    const owner = user?.id;
    const ids = [...new Set(item.groupedSaveIds?.length ? item.groupedSaveIds : item.saveId ? [item.saveId] : [])];
    if (!owner || !ids.length || removingPlace.current) return;
    Alert.alert('Remove from My Stash?', `Remove ${item.name} from your Stash?`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void (async () => {
        if (accountRef.current !== owner || removingPlace.current) return;
        removingPlace.current = true; setActionError(null);
        try { for (const id of ids) await removePlaceSave(id, owner); }
        catch { if (accountRef.current === owner) setActionError('Couldn’t remove this place. Please try again.'); }
        finally {
          removingPlace.current = false;
          if (accountRef.current === owner) { setSourceRevision(n => n + 1); await loadPlaces('refresh'); }
        }
      })(); } },
    ]);
  };

  const onBack = useCallback(() => {
    if (selectedCategoryKey) {
      setSelectedCategoryKey(null);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router, selectedCategoryKey]);

  useEffect(() => {
    placesScope.invalidate();
    setPlacesData(null);
    setPlacesStatus('idle');
    setPlacesRefreshing(false);
    setShopping(null); setSelectedSources(null);
  }, [placesScope, user?.id]);

  useEffect(() => {
    if (segment === STASH_SEGMENT.places) {
      setSelectedCategoryKey(null);
      setStashTab(STASH_SEGMENT.places);
    }
  }, [segment]);

  const onPlaceSearch = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {
      Alert.alert('Places', STASH_PLACES_COPY.openError);
    });
  }, []);

  const onStashTabChange = useCallback(
    (next: StashSegment) => {
      setStashTab(next);
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      if (!user || stashTab !== STASH_SEGMENT.places) return undefined;
      void loadPlaces();
      return () => { placesScope.invalidate(); };
    }, [loadPlaces, placesScope, stashTab, user]),
  );

  const contentTab = stashContentTab(stashTab, { selectedCategory: Boolean(selectedCategory) });

  /** Product and place cards share the same independent media actions. */
  const renderRelatedGrid = (list: BagItemView[]) => {
    const gridCardWidth = (screenWidth - GUTTER * 2 - GRID_GAP) / 2;
    const rows: BagItemView[][] = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
    return <View style={{ gap: GRID_GAP }}>{rows.map(row =>
      <View key={row.map(item => item.cartItemId).join('-')} style={{ flexDirection: 'row', gap: GRID_GAP }}>
        {row.map(item => {
          const share = shares.find(source => source.importId === item.userImportId && source.contentSourceId === item.contentSourceId);
          const ownedSource = productSources && productSources.owner === user?.id ? productSources.items.find(source => source.id === item.userImportId && source.contentSourceId === item.contentSourceId) : null;
          const url = ownedSource?.sourceUrl ?? share?.sourceUrl;
          const source = url && placeSourcePreview({ url, thumbnailUrl: item.imageUrl })
            ? { url, thumbnailUrl: item.imageUrl } : null;
          return <View key={item.cartItemId} style={{ width: gridCardWidth }}>
            <ProductCard product={item.product} variant="related" showIndexPrice onPress={() => onOpenProduct(item)}
              onRemove={() => onRemove(item)} onOpenSource={source ? () => setSelectedSources([source]) : undefined}
              onBuy={() => setShopping({ id: item.productId, name: item.title, image: item.imageUrl ?? '', price: item.product.price ?? '' })} />
            {item.source?.matchKind === 'similar' ? <Text style={typeStyle(tokens, 'caption')}>Similar product</Text> : null}
          </View>;
        })}
        {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
      </View>)}</View>;
  };

  const topTitle = selectedCategory ? selectedCategory.title : BAG_COPY.yourStash;
  const scrollPad = {
    paddingTop: 8,
    paddingBottom: tabBarHeight + tokens.space.lg,
  };

  const body = (() => {
    if (authLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.color.primary} />
        </View>
      );
    }

    if (!user) {
      return <StashSignedOutState onSignIn={() => router.push('/(tabs)/profile')} />;
    }

    if (contentTab === STASH_SEGMENT.places) {
      return (
        <StashPlacesContent
          error={placesError}
          key={user.id}
          items={withPlaceSourceVideos(placeItems, shares)}
          status={placesStatus}
          refreshing={placesRefreshing}
          bottomInset={tabBarHeight}
          onRefresh={() => { void loadPlaces('refresh'); void refreshShares(); setSourceRevision(n => n + 1); }}
          onRetry={() => void loadPlaces(placeItems.length ? 'refresh' : 'initial')}
          onSearch={onPlaceSearch}
          onRemove={onRemovePlace}
        />
      );
    }

    const productsLoad = resolveListLoadState({
      itemCount,
      fetching: ((status === 'loading' && !looking) || !sharesLoaded) && itemCount === 0,
      error: status === 'error',
    });
    if (productsLoad === 'skeleton') {
      return <StashHomeSkeleton />;
    }

    if (status === 'error' && items.length === 0) {
      return <FailureState error={errorMessage} title={BAG_COPY.loadError} onRetry={()=>void refresh()} fill />;
    }

    if (itemCount === 0 && !looking) {
      return (
        <View style={styles.center}>
          <Text
            style={{
              color: tokens.color.text,
              fontFamily: tokens.fontFamily.bold,
              fontSize: tokens.fontSize.headline,
              lineHeight: tokens.lineHeight.headline,
              textAlign: 'center',
            }}
          >
            {BAG_COPY.empty}
          </Text>
          <Text
            style={{
              color: tokens.color.textMuted,
              fontFamily: tokens.fontFamily.regular,
              fontSize: tokens.fontSize.body,
              lineHeight: tokens.lineHeight.body,
              textAlign: 'center',
            }}
          >
            {BAG_COPY.emptyHint}
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: tokens.color.primary, borderRadius: tokens.radius.lg }]}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={{ color: tokens.color.onPrimary, fontFamily: tokens.fontFamily.bold }}>
              {BAG_COPY.continueDiscovering}
            </Text>
          </Pressable>
        </View>
      );
    }

    if (selectedCategory) {
      return (
        <ScrollView contentContainerStyle={scrollPad} showsVerticalScrollIndicator={false}>
          <View style={{ paddingHorizontal: GUTTER, gap: tokens.space.xs, marginBottom: tokens.space.md }}>
            <Text
              style={{
                color: tokens.color.textMuted,
                fontFamily: tokens.fontFamily.regular,
                fontSize: tokens.fontSize.caption,
              }}
            >
              {selectedCategory.count === 1
                ? '1 product'
                : `${selectedCategory.count} products`}
            </Text>
          </View>
          <View style={{ paddingHorizontal: GUTTER }}>{renderRelatedGrid(selectedCategory.items)}</View>
        </ScrollView>
      );
    }

    return (
      <ScrollView contentContainerStyle={scrollPad} showsVerticalScrollIndicator={false}>
        {looking && itemCount === 0 ? (
          <View style={[styles.banners, { paddingHorizontal: GUTTER }]}>
            <ActivityIndicator color={tokens.color.primary} />
            <Text
              style={[
                typeStyle(tokens, 'bodyMuted'),
                { marginTop: tokens.space.sm },
              ]}
            >
              {BAG_PROGRESS_COPY.looking}
            </Text>
          </View>
        ) : null}

        {bagItems.length > 0 ? (
          <View style={[styles.section, { paddingHorizontal: GUTTER }]}>
            <StashRecentProducts key={user?.id} items={bagItems} categories={home.categories} renderGrid={renderRelatedGrid} />
          </View>
        ) : null}
      </ScrollView>
    );
  })();

  return (
    <View style={[styles.screen, { backgroundColor: tokens.color.canvasSoft }]}>
      <TopBar
        mode="page"
        title={topTitle}
        showBack={Boolean(selectedCategoryKey)}
        showBag={false}
        onBack={onBack}
      />
      {user && !selectedCategory ? (
        <View
          style={{
            paddingHorizontal: GUTTER,
            paddingBottom: tokens.space.sm,
            gap: tokens.space.md,
          }}
        >
          <StashSourceRail key={user.id} owner={user.id} revision={`${items.map(item => item.cartItemId).join('|')}:${sourceRevision}`}
            onOpen={id => router.push(`/stash/source/${id}` as Href)} />
          <ProfileContentTabs tabs={STASH_SEGMENT_TABS} active={stashTab} onChange={onStashTabChange} />
        </View>
      ) : null}
      {actionError ? <FailureState error={actionError} variant="inline" actionLabel="Dismiss" onRetry={()=>setActionError(null)} /> : null}
      {body}
      <FeedProductSheet video={null} product={shopping} shoppingProductId={shopping?.id} visible={Boolean(shopping)} onClose={() => setShopping(null)} />
      {selectedSources?.[0] ? <PlaceSourceVideoModal key={selectedSources[0].url} source={selectedSources[0]} sources={selectedSources} onClose={() => setSelectedSources(null)} /> : null}
      <CartPurchaseConfirmModal
        visible={purchaseConfirmVisible}
        productTitle={confirmTitle}
        onYes={() => {
          void resolvePurchaseConfirmation(true).catch(() => {
            setActionError(BAG_COPY.updateError);
          });
        }}
        onNo={() => {
          void resolvePurchaseConfirmation(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  banners: { gap: 10, marginBottom: 16 },
  banner: { flexDirection: 'row', alignItems: 'center' },
  section: { marginBottom: 28 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  cta: {
    marginTop: 10,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
});
