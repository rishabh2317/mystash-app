import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProductCard } from '@/components/commerce/ProductCard';
import { CartPurchaseConfirmModal } from '@/components/commerce/CartPurchaseConfirmModal';
import { StashCategoryCard } from '@/components/commerce/StashCategoryCard';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useImportSharesPoll } from '@/src/hooks/useImportSharesPoll';
import { useProductAddToCartHandler } from '@/src/services/productActionOrchestration';
import { typeStyle } from '@/src/theme/typography';
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

  const onBecameReady = useCallback(() => {
    void refresh();
  }, [refresh]);
  const { shares, loaded: sharesLoaded } = useImportSharesPoll({
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
            {BAG_COPY.signInTitle}
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
            {BAG_COPY.signInBody}
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: tokens.color.primary, borderRadius: tokens.radius.lg }]}
            onPress={() => router.push('/(tabs)/profile')}
          >
            <Text style={{ color: tokens.color.onPrimary, fontFamily: tokens.fontFamily.bold }}>
              Sign in
            </Text>
          </Pressable>
        </View>
      );
    }

    if ((status === 'loading' && items.length === 0 && !looking) || (!sharesLoaded && items.length === 0)) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.color.primary} />
        </View>
      );
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
  cta: {
    marginTop: 10,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
});
