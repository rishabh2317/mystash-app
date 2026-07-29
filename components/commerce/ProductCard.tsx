import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { displayHeroUri } from '@/src/services/catalogProductMapper';
import { trackProductEvent } from '@/src/logging/productAnalytics';
import { ProductHeroImage } from './ProductHeroImage';
import { VerificationBadge } from './VerificationBadge';

type Props = {
  product: CatalogProductViewModel;
  isLight: boolean;
  onPress: (product: CatalogProductViewModel) => void;
};

export function ProductCard({ product, isLight, onPress }: Props) {
  useEffect(() => {
    trackProductEvent('product.card.viewed', {
      catalogProductId: product.id,
      verificationStatus: product.verificationStatus,
    });
  }, [product.id, product.verificationStatus]);

  const showPrice =
    product.verificationStatus === 'VERIFIED' && !!product.price && product.price !== '—';

  return (
    <Pressable
      onPress={() => {
        trackProductEvent('product.card.opened', { catalogProductId: product.id });
        onPress(product);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${product.title}${product.brand ? `, ${product.brand}` : ''}. Open product details.`}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
          backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.06)',
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <ProductHeroImage
        productId={product.id}
        uri={displayHeroUri(product)}
        alt={product.title}
        style={styles.thumb}
      />
      <View style={styles.body}>
        {product.brand ? (
          <Text style={[styles.brand, { color: isLight ? '#64748B' : '#94A3B8' }]} numberOfLines={1}>
            {product.brand}
          </Text>
        ) : null}
        <Text style={[styles.title, { color: isLight ? '#0F172A' : '#F8FAFC' }]} numberOfLines={2}>
          {product.title}
        </Text>
        <View style={styles.metaRow}>
          <VerificationBadge status={product.verificationStatus} isLight={isLight} />
        </View>
        <Text style={[styles.merchant, { color: isLight ? '#475569' : '#CBD5E1' }]} numberOfLines={1}>
          {product.merchant || 'Merchant pending'}
          {showPrice ? ` · ${product.currency ? `${product.currency} ` : ''}${product.price}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    gap: 12,
    padding: 10,
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 10,
  },
  body: { flex: 1, justifyContent: 'center', gap: 4 },
  brand: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { fontSize: 15, fontWeight: '800', lineHeight: 20 },
  metaRow: { marginTop: 2 },
  merchant: { fontSize: 13, fontWeight: '500', marginTop: 2 },
});
