import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProductPage } from '@/components/product/ProductPage';
import { useThemeMode } from '@/contexts/ThemeContext';
import { fetchProductPage, ProductPageApiError } from '@/src/services/productPageApi';
import { softCanvasGradient } from '@/src/theme/tokens';
import type { ProductPageView } from '@/src/types/productPage';
import { PRODUCT_PAGE_COPY } from '@/src/ui/productPage';

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

export default function ProductPageScreen() {
  const { tokens } = useThemeMode();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    contentSourceId?: string | string[];
    userImportId?: string | string[];
  }>();
  const productId = firstParam(params.productId);
  const contentSourceId = firstParam(params.contentSourceId);
  const userImportId = firstParam(params.userImportId);

  const [page, setPage] = useState<ProductPageView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) {
      setStatus('error');
      setError(PRODUCT_PAGE_COPY.loadError);
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const next = await fetchProductPage(productId, { contentSourceId, userImportId });
      setPage(next);
      setStatus('ready');
    } catch (e) {
      setPage(null);
      setStatus('error');
      setError(e instanceof ProductPageApiError ? e.message : PRODUCT_PAGE_COPY.loadError);
    }
  }, [contentSourceId, productId, userImportId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.screen}>
      <LinearGradient colors={[...softCanvasGradient(tokens)]} style={StyleSheet.absoluteFill} />
      <TopBar mode="page" title={page?.title ?? 'Product'} showBack showBag />
      {status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.color.accent} />
        </View>
      ) : null}
      {status === 'error' ? (
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: tokens.color.text }]}>
            {PRODUCT_PAGE_COPY.loadError}
          </Text>
          {error ? (
            <Text style={{ color: tokens.color.textMuted, textAlign: 'center' }}>{error}</Text>
          ) : null}
          <Pressable
            onPress={() => void load()}
            style={[styles.retry, { backgroundColor: tokens.color.cta }]}
          >
            <Text style={styles.retryText}>{PRODUCT_PAGE_COPY.retry}</Text>
          </Pressable>
        </View>
      ) : null}
      {status === 'ready' && page ? <ProductPage page={page} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  errorTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: { color: '#fff', fontWeight: '800' },
});
