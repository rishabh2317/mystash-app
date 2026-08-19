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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProductCard, ProductDetailsSheet } from '@/components/commerce';
import { CartPurchaseConfirmModal } from '@/components/commerce/CartPurchaseConfirmModal';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
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
  const insets = useSafeAreaInsets();
  const { mode } = useThemeMode();
  const isLight = mode === 'titanium';
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
    Alert.alert('Remove item', `Remove ${title} from your bag?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void removeItem(line.catalogProductId, 'user_remove').catch(() => {
            Alert.alert('Error', 'Could not remove this item. Please try again.');
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
          accessibilityLabel={`Remove ${product.title} from cart`}
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
          <ActivityIndicator color={isLight ? '#00AFC0' : '#A855F7'} />
        </View>
      );
    }

    if (!user) {
      return (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
            Sign in to view your bag
          </Text>
          <Text style={[styles.emptySub, { color: isLight ? '#64748B' : '#94A3B8' }]}>
            Cart is available only for authenticated users.
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: isLight ? '#0EA5E9' : '#A855F7' }]}
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
          <ActivityIndicator color={isLight ? '#00AFC0' : '#A855F7'} />
        </View>
      );
    }

    if (status === 'error' && items.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
            Couldn’t load your bag
          </Text>
          <Text style={[styles.emptySub, { color: isLight ? '#64748B' : '#94A3B8' }]}>
            {errorMessage ?? 'Please try again.'}
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: isLight ? '#0EA5E9' : '#A855F7' }]}
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
          <Text style={[styles.emptyTitle, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
            Your bag is empty
          </Text>
          <Text style={[styles.emptySub, { color: isLight ? '#64748B' : '#94A3B8' }]}>
            Products you add will show up here.
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: isLight ? '#0EA5E9' : '#A855F7' }]}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.ctaText}>Browse</Text>
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
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={isLight ? ['#FDFDFD', '#E8E8E8'] : ['#0D111F', '#020408']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={isLight ? '#0F172A' : '#F8FAFC'} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
          Bag{itemCount > 0 ? ` · ${itemCount}` : ''}
        </Text>
        <View style={{ width: 24 }} />
      </View>
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
            Alert.alert('Error', 'Could not update your bag.');
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '800' },
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
  cta: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  ctaText: { color: '#fff', fontWeight: '800' },
});
