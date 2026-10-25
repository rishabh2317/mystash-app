import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProductPage } from '@/components/product/ProductPage';
import { ProductPageSkeleton } from '@/components/product/ProductPageSkeleton';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { fetchProductPage, ProductPageApiError } from '@/src/services/productPageApi';
import { softCanvasGradient } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { ProductPageView } from '@/src/types/productPage';
import {
  hasDetailContent,
  resolveContentLoadState,
  resourceIdentity,
  retainLoadedContent,
} from '@/src/ui/contentLoadState';
import {
  PRODUCT_PAGE_COPY,
  PRODUCT_PAGE_DETAILS_UPDATING_POLL_MS,
  shouldPollProductPageDetails,
} from '@/src/ui/productPage';

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
  const pollInFlight = useRef(false);
  const loadedIdentityRef = useRef<string | null>(null);
  const requestIdentity = resourceIdentity(productId, contentSourceId, userImportId);

  const load = useCallback(async () => {
    if (!productId) {
      loadedIdentityRef.current = null;
      setPage(null);
      setStatus('error');
      setError(PRODUCT_PAGE_COPY.loadError);
      return;
    }
    const keep = retainLoadedContent(requestIdentity, loadedIdentityRef.current);
    if (!keep) {
      setPage(null);
      loadedIdentityRef.current = null;
      setStatus('loading');
    }
    setError(null);
    try {
      const next = await fetchProductPage(productId, { contentSourceId, userImportId });
      loadedIdentityRef.current = requestIdentity;
      setPage(next);
      setStatus('ready');
    } catch (e) {
      if (!keep) {
        setPage(null);
        loadedIdentityRef.current = null;
      }
      setStatus('error');
      setError(e instanceof ProductPageApiError ? e.message : PRODUCT_PAGE_COPY.loadError);
    }
  }, [contentSourceId, productId, requestIdentity, userImportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const detailsUpdating = shouldPollProductPageDetails(page);

  useEffect(() => {
    if (!productId || status !== 'ready' || !detailsUpdating) return;

    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled || pollInFlight.current) return;
      pollInFlight.current = true;
      void fetchProductPage(productId, { contentSourceId, userImportId })
        .then((next) => {
          if (!cancelled) setPage(next);
        })
        .catch(() => {
          /* keep showing last page; continue polling while still updating */
        })
        .finally(() => {
          pollInFlight.current = false;
        });
    }, PRODUCT_PAGE_DETAILS_UPDATING_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      pollInFlight.current = false;
    };
  }, [contentSourceId, detailsUpdating, productId, status, userImportId]);

  const loadState = resolveContentLoadState({
    hasContent: hasDetailContent(page != null),
    fetching: status === 'loading',
    error: status === 'error',
  });

  return (
    <View style={styles.screen}>
      <LinearGradient colors={[...softCanvasGradient(tokens)]} style={StyleSheet.absoluteFill} />
      <TopBar mode="page" title={page?.title ?? 'Product'} showBack />
      {loadState === 'skeleton' ? <ProductPageSkeleton /> : null}
      {loadState === 'error' ? (
        <View style={styles.center}>
          <Text style={[typeStyle(tokens, 'sectionTitle'), { textAlign: 'center' }]}>
            {PRODUCT_PAGE_COPY.loadError}
          </Text>
          {error ? (
            <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>{error}</Text>
          ) : null}
          <Pressable
            onPress={() => void load()}
            style={[styles.retry, { backgroundColor: tokens.color.cta }]}
          >
            <Text style={[typeStyle(tokens, 'cta'), { color: '#fff' }]}>{PRODUCT_PAGE_COPY.retry}</Text>
          </Pressable>
        </View>
      ) : null}
      {(loadState === 'content' || loadState === 'contentRefreshing') && page ? (
        <ProductPage page={page} />
      ) : null}
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
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
});
