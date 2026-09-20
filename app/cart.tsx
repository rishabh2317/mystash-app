import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { BagItemCard } from '@/components/commerce/BagItemCard';
import { CartPurchaseConfirmModal } from '@/components/commerce/CartPurchaseConfirmModal';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { ImportShare } from '@/src/services/importShareMap';
import { fetchImportShares } from '@/src/services/userImportApi';
import { softCanvasGradient } from '@/src/theme/tokens';
import {
  BAG_PROGRESS_COPY,
  bagHasInFlightShares,
  bagItemFromLine,
  bagProgressBanners,
  bagSections,
  type BagItemView,
} from '@/src/ui/bag';
import { bagScreenTitle } from '@/src/ui/chrome';
import { BAG_COPY, displayBagError } from '@/src/ui/contracts';
import { productPagePath } from '@/src/ui/productPage';

const SHARE_POLL_MS = 4000;

function sharesBecameReady(previous: ImportShare[], next: ImportShare[]): boolean {
  const prevById = new Map(previous.map((share) => [share.importId, share.state]));
  return next.some((share) => prevById.get(share.importId) === 'looking' && share.state === 'ready');
}

export default function CartScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
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

  const [actionError, setActionError] = useState<string | null>(null);
  const [shares, setShares] = useState<ImportShare[]>([]);
  const [sharesLoaded, setSharesLoaded] = useState(false);
  const sharesRef = useRef<ImportShare[]>([]);

  const loadShares = useCallback(async () => {
    if (!user) {
      sharesRef.current = [];
      setShares([]);
      setSharesLoaded(false);
      return false;
    }
    try {
      const next = await fetchImportShares();
      if (sharesBecameReady(sharesRef.current, next)) {
        void refresh();
      }
      sharesRef.current = next;
      setShares(next);
      setSharesLoaded(true);
      return bagHasInFlightShares(next);
    } catch {
      setSharesLoaded(true);
      return false;
    }
  }, [refresh, user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        sharesRef.current = [];
        setShares([]);
        setSharesLoaded(false);
        return undefined;
      }
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const poll = async () => {
        const looking = await loadShares();
        if (cancelled || !looking) return;
        timer = setTimeout(() => {
          void poll();
        }, SHARE_POLL_MS);
      };
      void poll();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [loadShares, user]),
  );

  const bagItems = useMemo(() => items.map(bagItemFromLine), [items]);
  const sections = useMemo(() => bagSections(bagItems), [bagItems]);
  const banners = useMemo(() => bagProgressBanners(shares), [shares]);
  const looking = bagHasInFlightShares(shares);

  const confirmTitle = useMemo(() => {
    if (!awaitingConfirmationProductId) return null;
    return (
      bagItems.find((item) => item.catalogProductId === awaitingConfirmationProductId)?.title ??
      bagItems.find((item) => item.productId === awaitingConfirmationProductId)?.title ??
      null
    );
  }, [awaitingConfirmationProductId, bagItems]);

  const onRemove = (item: BagItemView) => {
    Alert.alert(BAG_COPY.removeFromBag, `Remove ${item.title} from your Bag?`, [
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
  };

  const body = (() => {
    if (authLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.color.accent} />
        </View>
      );
    }

    if (!user) {
      return (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: tokens.color.text }]}>
            {BAG_COPY.signInTitle}
          </Text>
          <Text style={[styles.emptySub, { color: tokens.color.textMuted }]}>
            {BAG_COPY.signInBody}
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: tokens.color.cta }]}
            onPress={() => router.push('/(tabs)/profile')}
          >
            <Text style={styles.ctaText}>Sign in</Text>
          </Pressable>
        </View>
      );
    }

    if ((status === 'loading' && items.length === 0 && !looking) || (!sharesLoaded && items.length === 0)) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.color.accent} />
        </View>
      );
    }

    if (status === 'error' && items.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: tokens.color.text }]}>
            {BAG_COPY.loadError}
          </Text>
          <Text style={[styles.emptySub, { color: tokens.color.textMuted }]}>
            {displayBagError(errorMessage, 'Please try again.')}
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: tokens.color.cta }]}
            onPress={() => void refresh()}
          >
            <Text style={styles.ctaText}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (itemCount === 0 && !looking && banners.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="bag-outline" size={48} color={tokens.color.textMuted} />
          <Text style={[styles.emptyTitle, { color: tokens.color.text }]}>
            {BAG_COPY.empty}
          </Text>
          <Text style={[styles.emptySub, { color: tokens.color.textMuted }]}>
            {BAG_COPY.emptyHint}
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: tokens.color.cta }]}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.ctaText}>{BAG_COPY.continueDiscovering}</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <SectionList
        sections={sections.map((section) => ({
          key: section.key,
          title: section.title,
          data: section.items,
        }))}
        keyExtractor={(item) => item.cartItemId}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          banners.length ? (
            <View style={styles.banners}>
              {banners.map((banner) => (
                <View
                  key={banner.key}
                  style={[
                    styles.banner,
                    {
                      backgroundColor: tokens.color.surface,
                      borderColor: tokens.color.border,
                      borderRadius: tokens.radius.lg,
                    },
                  ]}
                >
                  {banner.tone === 'looking' ? (
                    <ActivityIndicator color={tokens.color.accent} />
                  ) : (
                    <Ionicons
                      name="alert-circle-outline"
                      size={18}
                      color={tokens.color.textMuted}
                    />
                  )}
                  <Text
                    style={{
                      flex: 1,
                      color: tokens.color.text,
                      fontSize: tokens.fontSize.body,
                      lineHeight: tokens.lineHeight.body,
                      fontWeight: tokens.fontWeight.semibold,
                    }}
                  >
                    {banner.message}
                  </Text>
                </View>
              ))}
            </View>
          ) : looking && itemCount === 0 ? (
            <View style={styles.banners}>
              <ActivityIndicator color={tokens.color.accent} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          looking ? (
            <Text style={[styles.emptySub, { color: tokens.color.textMuted }]}>
              {BAG_PROGRESS_COPY.looking}
            </Text>
          ) : banners.length ? (
            <Text style={[styles.emptySub, { color: tokens.color.textMuted }]}>
              {BAG_COPY.emptyHint}
            </Text>
          ) : null
        }
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={styles.sectionHeader}>
              <SectionHeader title={section.title} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <BagItemCard
            item={item}
            onPress={(next) => {
              router.push(
                productPagePath(next.productId, {
                  contentSourceId: next.contentSourceId,
                  userImportId: next.userImportId,
                }) as Href,
              );
            }}
            onRemove={onRemove}
          />
        )}
      />
    );
  })();

  return (
    <View style={styles.screen}>
      <LinearGradient colors={[...softCanvasGradient(tokens)]} style={StyleSheet.absoluteFill} />
      <TopBar mode="page" title={bagScreenTitle(itemCount)} showBack showBag={false} />
      {actionError ? (
        <Text style={[styles.actionError, { color: tokens.color.danger }]}>{actionError}</Text>
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
  list: { padding: 16, paddingBottom: 40, gap: 12 },
  banners: { gap: 10, marginBottom: 8 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sectionHeader: { paddingTop: 8, paddingBottom: 4 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  actionError: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  cta: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  ctaText: { color: '#fff', fontWeight: '800' },
});
