import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProductCard, ProductDetailsSheet } from '@/components/commerce';
import { CartPurchaseConfirmModal } from '@/components/commerce/CartPurchaseConfirmModal';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { softCanvasGradient } from '@/src/theme/tokens';
import { BAG_COPY, displayBagError } from '@/src/ui/contracts';
import { bagScreenTitle } from '@/src/ui/chrome';
import type { CartLine } from '@/src/services/cartApi';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';

function placeholderProduct(line: CartLine): CatalogProductViewModel {
  return (
    line.product ?? {
      id: line.catalogProductId,
      catalogProductId: line.catalogProductId,
      title: 'Product unavailable',
      brand: null,
      merchant: null,
      heroImage: CATALOG_IMAGE_PLACEHOLDER,
      galleryImages: [],
      description: null,
      shortDescription: null,
      specifications: {},
      verificationStatus: 'UNRESOLVED',
      availability: line.availability,
      price: null,
      currency: null,
      lastVerifiedAt: null,
      metadataCompleteness: null,
    }
  );
}

export default function CartScreen() {
  const router = useRouter();
  const { tokens, isLight } = useThemeMode();
  const { user, loading: authLoading } = useAuth();
  const {
    items,
    itemCount,
    status,
    errorMessage,
    refresh,
    removeItem,
    beginBuy,
    purchaseConfirmVisible,
    awaitingConfirmationProductId,
    resolvePurchaseConfirmation,
  } = useCart();

  const [detailsProduct, setDetailsProduct] = useState<CatalogProductViewModel | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const confirmTitle = useMemo(() => {
    if (!awaitingConfirmationProductId) return null;
    return (
      items.find((i) => i.catalogProductId === awaitingConfirmationProductId)?.product?.title ??
      null
    );
  }, [awaitingConfirmationProductId, items]);

  const onBuy = async (product: CatalogProductViewModel) => {
    try {
      await beginBuy(product);
    } catch {
      Alert.alert('Error', 'Could not open the product link.');
    }
  };

  const onRemove = (line: CartLine) => {
    const title = line.product?.title ?? 'this product';
    Alert.alert(BAG_COPY.removeFromBag, `Remove ${title} from your Bag?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setActionError(null);
          void removeItem(line.catalogProductId, 'user_remove').catch(() => {
            setActionError(BAG_COPY.removeError);
          });
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: CartLine }) => {
    const product = placeholderProduct(item);
    const canBuy = item.availability === 'AVAILABLE' && !!product.catalogProductId;
    return (
      <View style={styles.row}>
        <ProductCard
          product={product}
          isLight={isLight}
          variant="standard"
          onPress={(p) => {
            setDetailsProduct(p);
            setDetailsVisible(true);
          }}
          onBuy={canBuy ? onBuy : undefined}
        />
        {item.availability !== 'AVAILABLE' ? (
          <Text style={[styles.badge, { color: isLight ? '#B45309' : '#FBBF24' }]}>
            {item.availability === 'NO_DESTINATION'
              ? 'Shopping link unavailable'
              : 'Product unavailable'}
          </Text>
        ) : null}
        <Pressable
          onPress={() => onRemove(item)}
          style={styles.removeBtn}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${product.title} from Bag`}
        >
          <Text style={{ color: isLight ? '#B91C1C' : '#FCA5A5', fontWeight: '700' }}>Remove</Text>
        </Pressable>
      </View>
    );
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

    if (status === 'loading' && items.length === 0) {
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

    if (itemCount === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="cart-outline" size={48} color={isLight ? '#94A3B8' : '#64748B'} />
          <Text style={[styles.emptyTitle, { color: tokens.color.text }]}>
            {BAG_COPY.empty}
          </Text>
          <Text style={[styles.emptySub, { color: tokens.color.textMuted }]}>
            Products you add will show up here.
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
      <FlatList
        data={items}
        keyExtractor={(line) => line.cartItemId}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
      />
    );
  })();

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[...softCanvasGradient(tokens)]}
        style={StyleSheet.absoluteFill}
      />
      <TopBar mode="page" title={bagScreenTitle(itemCount)} showBack showBag={false} />
      {actionError ? (
        <Text style={[styles.actionError, { color: tokens.color.danger }]}>{actionError}</Text>
      ) : null}
      {body}
      <ProductDetailsSheet
        visible={detailsVisible}
        product={detailsProduct}
        isLight={isLight}
        onClose={() => setDetailsVisible(false)}
        onBuy={
          detailsProduct &&
          items.find((i) => i.catalogProductId === detailsProduct.catalogProductId)
            ?.availability === 'AVAILABLE'
            ? async (p) => {
                setDetailsVisible(false);
                await onBuy(p);
              }
            : undefined
        }
      />
      <CartPurchaseConfirmModal
        visible={purchaseConfirmVisible}
        isLight={isLight}
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
  list: { padding: 16, paddingBottom: 40, gap: 16 },
  row: { gap: 8 },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 4 },
  removeBtn: { alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: 4 },
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
