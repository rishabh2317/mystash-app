import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { ProductCard } from '../ProductCard';

type Props = {
  product: CatalogProductViewModel;
  isLight: boolean;
  included: boolean;
  onToggleInclude: (included: boolean) => void;
  onOpenDetails: (product: CatalogProductViewModel) => void;
  /** Optional AI confidence 0–1 shown only on Review. */
  confidence?: number | null;
  extractionHint?: string | null;
};

/**
 * Review-only wrapper: generic ProductCard + Include toggle / confidence.
 * Does not put Buy or Include inside ProductCard.
 */
export function ReviewProductCard({
  product,
  isLight,
  included,
  onToggleInclude,
  onOpenDetails,
  confidence,
  extractionHint,
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.cardClip}>
        <ProductCard product={product} isLight={isLight} onPress={onOpenDetails} />
      </View>
      <View
        style={[
          styles.footer,
          {
            borderColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)',
            backgroundColor: isLight ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.04)',
          },
        ]}
      >
        {(confidence != null && confidence > 0) || extractionHint ? (
          <Text style={[styles.hint, { color: isLight ? '#64748B' : '#94A3B8' }]} numberOfLines={1}>
            {extractionHint
              ? extractionHint
              : confidence != null
                ? `AI confidence ${Math.round(confidence * 100)}%`
                : ''}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View style={styles.includeRow}>
          <Text style={{ color: isLight ? '#334155' : '#CBD5E1', fontSize: 13, fontWeight: '600' }}>
            Include
          </Text>
          <Switch value={included} onValueChange={onToggleInclude} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  cardClip: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  footer: {
    marginTop: -1,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hint: { flex: 1, fontSize: 12, fontWeight: '500' },
  includeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
