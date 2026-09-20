import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { VerificationBadge } from './VerificationBadge';

type Props = {
  product: CatalogProductViewModel;
  isLight: boolean;
  /** Bag and Discover Anywhere hide verification / last-verified internals. */
  hideInternalStatus?: boolean;
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

export function MerchantSection({ product, isLight, hideInternalStatus = false }: Props) {
  const { tokens } = useThemeMode();
  const text = { color: tokens.color.text };
  const muted = { color: tokens.color.textMuted };

  if (hideInternalStatus) {
    if (!product.merchant) return null;
    return (
      <View style={styles.wrap}>
        <Text style={[styles.heading, text]}>Merchant</Text>
        <Text style={[styles.label, muted]}>Sold by</Text>
        <Text style={[styles.value, text]}>{product.merchant}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.heading, text]}>Merchant</Text>
      <Text style={[styles.label, muted]}>Sold by</Text>
      <Text style={[styles.value, text]}>{product.merchant || 'Unknown merchant'}</Text>
      <Text style={[styles.label, muted, { marginTop: 10 }]}>Last verified</Text>
      <Text style={[styles.value, text]}>{formatVerifiedAt(product.lastVerifiedAt)}</Text>
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
