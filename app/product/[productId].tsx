import {useAuth} from '@/contexts/AuthContext';
import {useCommerceCountry} from '@/contexts/CommerceCountryContext';
import { apiFailureMessage } from '@/src/ui/apiFailure';
import { FailureState } from '@/components/status/FailureState';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProductPage } from '@/components/product/ProductPage';
import { ProductPageSkeleton } from '@/components/product/ProductPageSkeleton';
import { useThemeMode } from '@/contexts/ThemeContext';
import { fetchProductPage } from '@/src/services/productPageApi';
import { softCanvasGradient } from '@/src/theme/tokens';
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

  const {snapshot:shoppingCountry}=useCommerceCountry();
  const country=shoppingCountry?.country;
  const {user}=useAuth();
  const [page, setPage] = useState<ProductPageView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const pollInFlight = useRef(false);
  const loadedIdentityRef = useRef<string | null>(null);
  const requestIdentity = resourceIdentity(productId, contentSourceId, userImportId,country,user?.id);

  const currentIdentity=useRef(requestIdentity);
  currentIdentity.current=requestIdentity;
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
      const next = await fetchProductPage(productId, { contentSourceId, userImportId,country });
      if(currentIdentity.current!==requestIdentity)return;
      loadedIdentityRef.current = requestIdentity;
      setPage(next);
      setStatus('ready');
    } catch (e) {
      if(currentIdentity.current!==requestIdentity)return;
      if (!keep) {
        setPage(null);
        loadedIdentityRef.current = null;
      }
      setStatus('error');
      setError(apiFailureMessage(e));
    }
  }, [contentSourceId, productId, requestIdentity, userImportId,country]);

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
      void fetchProductPage(productId, { contentSourceId, userImportId,country })
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
  }, [contentSourceId, detailsUpdating, productId, status, userImportId,country]);

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
      {loadState === 'error' ? <FailureState error={error} title={PRODUCT_PAGE_COPY.loadError} onRetry={()=>void load()} fill /> : null}
      {page && error ? <FailureState error={error} variant="inline" onRetry={()=>void load()} /> : null}
      {(loadState === 'content' || loadState === 'contentRefreshing') && page ? (
        <ProductPage page={page} measurementSurface={userImportId&&process.env.EXPO_PUBLIC_FIND_MEASUREMENT_ENABLED==='true'?'find':'product'} />
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
