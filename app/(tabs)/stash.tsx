import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProductCard } from '@/components/commerce/ProductCard';
import { CartPurchaseConfirmModal } from '@/components/commerce/CartPurchaseConfirmModal';
import { StashCategoryCard } from '@/components/commerce/StashCategoryCard';
import { StashSignedOutState } from '@/components/commerce/StashSignedOutState';
import { StashHomeSkeleton } from '@/components/commerce/StashHomeSkeleton';
import { PlaceCard } from '@/components/place/PlaceCard';
import { PlaceCardSkeleton } from '@/components/place/PlaceCardSkeleton';
import { SkeletonStack } from '@/components/status/SkeletonStack';
import { ProfileContentTabs } from '@/components/profile/ProfileContentTabs';
import { YourActivitySection } from '@/components/search/YourActivitySection';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useImportSharesPoll } from '@/src/hooks/useImportSharesPoll';
import { fetchPlaces } from '@/src/services/placesApi';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { typeStyle } from '@/src/theme/typography';
import type { PlaceStashItem } from '@/src/types/placeStash';
import {
  BAG_PROGRESS_COPY,
  bagHasInFlightShares,
  bagItemFromLine,
  buildStashHome,
  type BagItemView,
  type StashCategoryCardModel,
} from '@/src/ui/bag';
import { BAG_COPY, controlOpacity, displayBagError, resolveControlPhase } from '@/src/ui/contracts';
import { productPagePath } from '@/src/ui/productPage';
import { resolveListLoadState } from '@/src/ui/contentLoadState';
import { shareActivityLandingItems } from '@/src/ui/shareActivity';
import {
  DEFAULT_STASH_SEGMENT,
  STASH_PLACES_COPY,
  STASH_SEGMENT,
  STASH_SEGMENT_TABS,
  partitionPlaceStashItems,
  placeStashItemKey,
  stashContentTab,
  type StashSegment,
} from '@/src/ui/stashPlaces';

const GUTTER = 16;
const GRID_GAP = 12;
/** Matches ProductCard related inset + AddToCartButton icon size. */
const RELATED_CARD_INSET = 6;
const STASH_REMOVE_ICON = 32;

export default function StashScreen() {
  const router = useRouter();
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
  const onAddToCart = useProductAddToCartHandler();

  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
  const [stashTab, setStashTab] = useState<StashSegment>(DEFAULT_STASH_SEGMENT);
  const [placeItems, setPlaceItems] = useState<PlaceStashItem[]>([]);
  const [placesStatus, setPlacesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [placesRefreshing, setPlacesRefreshing] = useState(false);

  const onBecameReady = useCallback(() => {
    void refresh();
  }, [refresh]);
  const { shares, loaded: sharesLoaded, refresh: refreshShares } = useImportSharesPoll({
    enabled: Boolean(user),
    onBecameReady,
  });
  const activityItems = useMemo(() => shareActivityLandingItems(shares), [shares]);

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
      Alert.alert(BAG_COPY.removeFromBag, `Remove ${item.title} from your Stash?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setActionError(null);
            void removeItem(item.productId, 'user_remove').catch(() => {
              setActionError(BAG_COPY.removeError);
            });
          },
        },
      ]);
    },
    [removeItem],
  );

  const onBack = useCallback(() => {
    if (selectedCategoryKey) {
      setSelectedCategoryKey(null);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router, selectedCategoryKey]);

  const loadPlaces = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (!user) return;
    if (mode === 'refresh') setPlacesRefreshing(true);
    else setPlacesStatus((s) => (s === 'ready' ? 'ready' : 'loading'));
    setPlacesError(null);
    try {
      const page = await fetchPlaces();
      setPlaceItems(page.items);
      setPlacesStatus('ready');
    } catch (e) {
      setPlacesStatus('error');
      setPlacesError(e instanceof Error ? e.message : STASH_PLACES_COPY.loadError);
    } finally {
      setPlacesRefreshing(false);
    }
  }, [user]);

  const onPlaceSearch = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {
      Alert.alert('Places', STASH_PLACES_COPY.openError);
    });
  }, []);

  const onStashTabChange = useCallback(
    (next: StashSegment) => {
      setStashTab(next);
      if (next === STASH_SEGMENT.places) void loadPlaces();
    },
    [loadPlaces],
  );

  useFocusEffect(
    useCallback(() => {
      if (!user || stashTab !== STASH_SEGMENT.places) return undefined;
      void loadPlaces();
      return undefined;
    }, [loadPlaces, stashTab, user]),
  );

  const contentTab = stashContentTab(stashTab, { selectedCategory: Boolean(selectedCategory) });

  /** Related product card in a clean 2-column shelf. Parent owns horizontal padding. */
  const renderRelatedGrid = (list: BagItemView[]) => {
    const gridCardWidth = (screenWidth - GUTTER * 2 - GRID_GAP) / 2;
    const rows: BagItemView[][] = [];
    for (let i = 0; i < list.length; i += 2) {
      rows.push(list.slice(i, i + 2));
    }
    return (
      <View style={{ gap: GRID_GAP }}>
        {rows.map((row) => (
          <View
            key={row.map((item) => item.cartItemId).join('-')}
            style={{ flexDirection: 'row', gap: GRID_GAP }}
          >
            {row.map((item) => {
              const mediaSize = gridCardWidth - RELATED_CARD_INSET * 2;
              return (
              <View key={item.cartItemId} style={{ width: gridCardWidth, position: 'relative' }}>
                <ProductCard
                  product={item.product}
                  variant="related"
                  showIndexPrice
                  onPress={() => onOpenProduct(item)}
                  onAddToCart={item.catalogProductId ? onAddToCart : undefined}
                />
                {!item.catalogProductId ? (
                  <Pressable
                    onPress={() => onRemove(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${BAG_COPY.removeFromBag} ${item.title}`}
                    style={({ pressed }) => [
                      {
                        position: 'absolute',
                        top:
                          RELATED_CARD_INSET +
                          mediaSize -
                          tokens.space.xs -
                          STASH_REMOVE_ICON,
                        right: RELATED_CARD_INSET + tokens.space.xs,
                        width: STASH_REMOVE_ICON,
                        height: STASH_REMOVE_ICON,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: tokens.radius.pill,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: tokens.immersive.border,
                        backgroundColor: tokens.immersive.controlStrong,
                        zIndex: 2,
                        opacity: controlOpacity(
                          resolveControlPhase({ pressed }),
                          tokens.motion.pressOpacity,
                        ),
                      },
                    ]}
                  >
                    <Ionicons name="trash-outline" size={15} color={tokens.immersive.icon} />
                  </Pressable>
                ) : null}
              </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const categoryRows: StashCategoryCardModel[][] = [];
  for (let i = 0; i < home.categories.length; i += 2) {
    categoryRows.push(home.categories.slice(i, i + 2));
  }

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
      const placesLoad = resolveListLoadState({
        itemCount: placeItems.length,
        fetching: placesStatus === 'loading',
        error: placesStatus === 'error',
      });
      if (placesLoad === 'skeleton') {
        return (
          <SkeletonStack gap={tokens.space.md} style={{ paddingHorizontal: GUTTER, paddingTop: 8 }}>
            <PlaceCardSkeleton />
            <PlaceCardSkeleton />
            <PlaceCardSkeleton />
          </SkeletonStack>
        );
      }

      if (placesStatus === 'error' && placeItems.length === 0) {
        return (
          <View style={styles.center}>
            <Text
              style={{
                color: tokens.color.text,
                fontFamily: tokens.fontFamily.bold,
                fontSize: tokens.fontSize.display,
                textAlign: 'center',
              }}
            >
              {STASH_PLACES_COPY.loadError}
            </Text>
            {placesError ? (
              <Text
                style={{
                  color: tokens.color.textMuted,
                  fontFamily: tokens.fontFamily.regular,
                  fontSize: tokens.fontSize.body,
                  textAlign: 'center',
                }}
              >
                {placesError}
              </Text>
            ) : null}
            <Pressable
              style={[styles.cta, { backgroundColor: tokens.color.primary, borderRadius: tokens.radius.lg }]}
              onPress={() => void loadPlaces()}
            >
              <Text style={{ color: tokens.color.onPrimary, fontFamily: tokens.fontFamily.bold }}>
                {STASH_PLACES_COPY.retry}
              </Text>
            </Pressable>
          </View>
        );
      }

      if (placeItems.length === 0) {
        return (
          <ScrollView
            contentContainerStyle={[scrollPad, styles.centerGrow]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={placesRefreshing}
                onRefresh={() => void loadPlaces('refresh')}
                tintColor={tokens.color.primary}
              />
            }
          >
            <Text
              style={{
                color: tokens.color.text,
                fontFamily: tokens.fontFamily.bold,
                fontSize: tokens.fontSize.headline,
                lineHeight: tokens.lineHeight.headline,
                textAlign: 'center',
              }}
            >
              {STASH_PLACES_COPY.empty}
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
              {STASH_PLACES_COPY.emptyHint}
            </Text>
          </ScrollView>
        );
      }

      const grouped = partitionPlaceStashItems(placeItems);
      return (
        <ScrollView
          contentContainerStyle={scrollPad}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={placesRefreshing}
              onRefresh={() => void loadPlaces('refresh')}
              tintColor={tokens.color.primary}
            />
          }
        >
          {placesStatus === 'error' && placesError ? (
            <Text
              style={{
                color: tokens.color.danger,
                fontFamily: tokens.fontFamily.semibold,
                fontSize: tokens.fontSize.caption,
                textAlign: 'center',
                paddingHorizontal: GUTTER,
                paddingBottom: tokens.space.sm,
              }}
            >
              {placesError}
            </Text>
          ) : null}
          <View style={{ paddingHorizontal: GUTTER, gap: tokens.space.lg }}>
            {grouped.places.length > 0 ? (
              <View style={{ gap: GRID_GAP }}>
                <Text style={typeStyle(tokens, 'sectionTitle')}>{STASH_PLACES_COPY.placesSection}</Text>
                {grouped.places.map((item) => (
                  <PlaceCard key={placeStashItemKey(item)} item={item} onSearch={onPlaceSearch} />
                ))}
              </View>
            ) : null}
            {grouped.leads.length > 0 ? (
              <View style={{ gap: GRID_GAP }}>
                <Text
                  style={[
                    typeStyle(tokens, 'sectionTitle'),
                    { color: tokens.color.textMuted, fontFamily: tokens.fontFamily.semibold },
                  ]}
                >
                  {STASH_PLACES_COPY.leadsSection}
                </Text>
                {grouped.leads.map((item) => (
                  <PlaceCard key={placeStashItemKey(item)} item={item} onSearch={onPlaceSearch} />
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
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
      return (
        <View style={styles.center}>
          <Text
            style={{
              color: tokens.color.text,
              fontFamily: tokens.fontFamily.bold,
              fontSize: tokens.fontSize.display,
              textAlign: 'center',
            }}
          >
            {BAG_COPY.loadError}
          </Text>
          <Text
            style={{
              color: tokens.color.textMuted,
              fontFamily: tokens.fontFamily.regular,
              fontSize: tokens.fontSize.body,
              textAlign: 'center',
            }}
          >
            {displayBagError(errorMessage, 'Please try again.')}
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: tokens.color.primary, borderRadius: tokens.radius.lg }]}
            onPress={() => void refresh()}
          >
            <Text style={{ color: tokens.color.onPrimary, fontFamily: tokens.fontFamily.bold }}>
              Retry
            </Text>
          </Pressable>
        </View>
      );
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

        {home.categories.length > 0 ? (
          <View style={[styles.section, { paddingHorizontal: GUTTER }]}>
            <Text
              style={[typeStyle(tokens, 'sectionTitle'), { marginBottom: tokens.space.sm }]}
            >
              Your products
            </Text>
            <View style={{ gap: GRID_GAP }}>
              {categoryRows.map((row) => (
                <View
                  key={row.map((c) => c.key).join('-')}
                  style={{ flexDirection: 'row', gap: GRID_GAP }}
                >
                  {row.map((category) => (
                    <StashCategoryCard
                      key={category.key}
                      category={category}
                      onPress={(next) => setSelectedCategoryKey(next.key)}
                    />
                  ))}
                  {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {home.recent.length > 0 ? (
          <View style={[styles.section, { paddingHorizontal: GUTTER }]}>
            <Text
              style={[typeStyle(tokens, 'sectionTitle'), { marginBottom: tokens.space.sm }]}
            >
              Recently stashed
            </Text>
            {renderRelatedGrid(home.recent)}
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
          <YourActivitySection
            items={activityItems}
            loading={!sharesLoaded}
            onRefresh={async () => {
              await refreshShares();
            }}
          />
          <ProfileContentTabs tabs={STASH_SEGMENT_TABS} active={stashTab} onChange={onStashTabChange} />
        </View>
      ) : null}
      {actionError ? (
        <Text
          style={{
            color: tokens.color.danger,
            fontFamily: tokens.fontFamily.semibold,
            fontSize: tokens.fontSize.caption,
            textAlign: 'center',
            paddingHorizontal: GUTTER,
            paddingBottom: 4,
          }}
        >
          {actionError}
        </Text>
      ) : null}
      {body}
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
  centerGrow: {
    flexGrow: 1,
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
