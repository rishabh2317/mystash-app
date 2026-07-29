import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { VerificationBadge } from './VerificationBadge';

type Props = {
  product: CatalogProductViewModel;
  isLight: boolean;
};

function formatVerifiedAt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function MerchantSection({ product, isLight }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={[styles.heading, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>Merchant</Text>
      <Text style={[styles.label, { color: isLight ? '#64748B' : '#94A3B8' }]}>Sold by</Text>
      <Text style={[styles.value, { color: isLight ? '#0F172A' : '#F1F5F9' }]}>
        {product.merchant || 'Unknown merchant'}
      </Text>
      <Text style={[styles.label, { color: isLight ? '#64748B' : '#94A3B8', marginTop: 10 }]}>
        Last verified
      </Text>
      <Text style={[styles.value, { color: isLight ? '#0F172A' : '#F1F5F9' }]}>
        {formatVerifiedAt(product.lastVerifiedAt)}
      </Text>
      <View style={{ marginTop: 10 }}>
        <VerificationBadge status={product.verificationStatus} isLight={isLight} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 20 },
  heading: { fontSize: 16, fontWeight: '800', marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  value: { fontSize: 15, fontWeight: '600', marginTop: 2 },
});
