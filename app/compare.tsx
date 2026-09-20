import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProductCard } from '@/components/commerce/ProductCard';
import { ProductCompare } from '@/components/product/ProductCompare';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import { hydrateSearchProducts } from '@/src/mappers/searchProductHydration';
import { fetchProductPage } from '@/src/services/productPageApi';
import { searchBlended } from '@/src/services/searchApi';
import { softCanvasGradient } from '@/src/theme/tokens';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { ProductPageView } from '@/src/types/productPage';
import {
  COMPARE_COPY,
  COMPARE_MAX,
  canAddCompareId,
  comparePath,
  parseCompareIds,
} from '@/src/ui/productCompare';

const SEARCH_DEBOUNCE_MS = 300;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(',');
  return value;
}

export default function CompareScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const params = useLocalSearchParams<{ ids?: string | string[] }>();
  const ids = useMemo(() => parseCompareIds(firstParam(params.ids)), [params.ids]);

  const [pages, setPages] = useState<ProductPageView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CatalogProductViewModel[]>([]);
  const [searching, setSearching] = useState(false);

  const replaceIds = useCallback((next: string[]) => {
    router.replace(comparePath(next) as Href);
  }, [router]);

  const load = useCallback(async () => {
    if (ids.length === 0) {
      setPages([]);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    try {
      const loaded = await Promise.all(ids.map((id) => fetchProductPage(id).catch(() => null)));
      const next = loaded.filter((item): item is ProductPageView => Boolean(item));
      setPages(next);
      setStatus('ready');
    } catch {
      setPages([]);
      setStatus('error');
    }
  }, [ids]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchBlended({ q, presentation: 'typed', limit: 8 })
        .then((res) => hydrateSearchProducts(res.lanes?.products ?? res.results.filter((row) => row.entityType === 'product')))
        .then((products) => {
          if (cancelled) return;
          setHits(products.filter((product) => {
            const id = product.catalogProductId ?? product.id;
            return Boolean(id) && !ids.includes(id);
          }));
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ids, query]);

  const addProduct = (product: CatalogProductViewModel) => {
    const id = (product.catalogProductId ?? product.id).trim();
    if (!canAddCompareId(ids, id)) return;
    setQuery('');
    setHits([]);
    replaceIds([...ids, id]);
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={[...softCanvasGradient(tokens)]} style={StyleSheet.absoluteFill} />
      <TopBar mode="page" title={COMPARE_COPY.title} showBack showBag />
      {status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.color.accent} />
        </View>
      ) : null}
      {status === 'error' ? (
        <View style={styles.center}>
          <Text style={{ color: tokens.color.text, fontWeight: tokens.fontWeight.bold }}>
            {COMPARE_COPY.loadError}
          </Text>
          <Pressable onPress={() => void load()}>
            <Text style={{ color: tokens.color.primary }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {status === 'ready' ? (
        <ScrollView
          contentContainerStyle={{
            padding: tokens.space.lg,
            gap: tokens.space.lg,
            paddingBottom: tokens.space.xl,
          }}
        >
          <SectionHeader
            title={COMPARE_COPY.title}
            subtitle={ids.length >= COMPARE_MAX ? COMPARE_COPY.maxReached : COMPARE_COPY.hint}
          />
          <ProductCompare
            pages={pages}
            onRemove={ids.length > 1 ? (productId) => replaceIds(ids.filter((id) => id !== productId)) : undefined}
          />

          {ids.length < COMPARE_MAX ? (
            <View style={{ gap: tokens.space.sm }}>
              <SectionHeader title={COMPARE_COPY.add} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={COMPARE_COPY.searchPlaceholder}
                placeholderTextColor={tokens.color.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                style={[
                  styles.search,
                  {
                    color: tokens.color.text,
                    backgroundColor: tokens.color.surface,
                    borderColor: tokens.color.border,
                    borderRadius: tokens.radius.md,
                    paddingHorizontal: tokens.space.md,
                    paddingVertical: tokens.space.sm,
                  },
                ]}
              />
              {searching ? <ActivityIndicator color={tokens.color.accent} /> : null}
              {!searching && query.trim() && hits.length === 0 ? (
                <Text style={{ color: tokens.color.textMuted }}>{COMPARE_COPY.emptySearch}</Text>
              ) : null}
              {hits.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  variant="compact"
                  showIndexPrice
                  onPress={addProduct}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
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
    gap: 10,
    padding: 24,
  },
  search: {
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
  },
});
