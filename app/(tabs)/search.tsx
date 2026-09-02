import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { CollectionTile } from '@/components/collection/CollectionTile';
import { ProductCard } from '@/components/commerce/ProductCard';
import { ProductDetailsSheet } from '@/components/commerce/ProductDetailsSheet';
import { CreatorCard } from '@/components/creator/CreatorCard';
import { useThemeMode } from '@/contexts/ThemeContext';
import { pageCanvasGradient } from '@/src/theme/tokens';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import {
  beginSearchReelSession,
  searchReelPath,
  shouldOpenSearchReelFeed,
} from '@/src/ui/searchReelNavigation';
import {
  popularFallbackMessage,
  searchConstraintChipLabel,
  searchSectionOrder,
  searchSectionTitle,
  type SearchSectionKind,
} from '@/src/ui/searchSections';
import {
  dedupeById,
  mapSearchCollectionCard,
  mapSearchCreatorCard,
} from '@/src/mappers/searchMapper';
import { videosToExploreCollections } from '@/src/mappers/exploreCollectionMapper';
import { hydrateSearchProducts } from '@/src/mappers/searchProductHydration';
import { subscribeFeedReload } from '@/src/services/feedRefresh';
import {
  useProductAddToCartHandler,
  useProductBuyHandler,
} from '@/src/services/productActionOrchestration';
import {
  recordSearchClick,
  searchAutocomplete,
  searchBlended,
  type AutocompleteSuggestion,
  type SearchResultCard,
} from '@/src/services/searchApi';
import { fetchVideos } from '@/src/services/supabase';
import { shouldResetSearchSession } from '@/src/state/searchSession';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';

const DEBOUNCE_MS = 300;
const PAGE_LIMIT = 20;

type SearchSections = {
  collections: CollectionViewModel[];
  creators: CreatorViewModel[];
  products: CatalogProductViewModel[];
};

const EMPTY_SECTIONS: SearchSections = {
  collections: [],
  creators: [],
  products: [],
};

async function cardsToSections(cards: {
  collections: SearchResultCard[];
  creators: SearchResultCard[];
  products: SearchResultCard[];
}): Promise<SearchSections> {
  const collections = dedupeById(
    cards.collections
      .map(mapSearchCollectionCard)
      .filter((c): c is CollectionViewModel => c != null),
    (c) => c.collectionId,
  );
  const creators = dedupeById(
    cards.creators
      .map(mapSearchCreatorCard)
      .filter((c): c is CreatorViewModel => c != null),
    (c) => c.userId,
  );
  const products = dedupeById(await hydrateSearchProducts(cards.products), (p) => p.id);
  return { collections, creators, products };
}

function mergeSections(prev: SearchSections, next: SearchSections): SearchSections {
  return {
    collections: dedupeById([...prev.collections, ...next.collections], (c) => c.collectionId),
    creators: dedupeById([...prev.creators, ...next.creators], (c) => c.userId),
    products: dedupeById([...prev.products, ...next.products], (p) => p.id),
  };
}

function partitionResults(results: SearchResultCard[]): {
  collections: SearchResultCard[];
  creators: SearchResultCard[];
  products: SearchResultCard[];
} {
  return {
    collections: results.filter((r) => r.entityType === 'collection'),
    creators: results.filter((r) => r.entityType === 'creator'),
    products: results.filter((r) => r.entityType === 'product'),
  };
}

type ListRow =
  | { key: string; kind: 'landing'; collections: CollectionViewModel[]; loading: boolean }
  | { key: string; kind: 'banner'; text: string }
  | { key: string; kind: 'status'; text: string; action?: () => void }
  | { key: string; kind: 'section'; title: string }
  | { key: string; kind: 'collection'; collection: CollectionViewModel }
  | { key: string; kind: 'creator'; creator: CreatorViewModel }
  | { key: string; kind: 'product'; product: CatalogProductViewModel }
  | { key: string; kind: 'footer' };

export default function SearchScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { tokens, isLight } = useThemeMode();
  const onBuy = useProductBuyHandler();
  const onAddToCart = useProductAddToCartHandler();

  const [input, setInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sections, setSections] = useState<SearchSections>(EMPTY_SECTIONS);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zeroResult, setZeroResult] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsProduct, setDetailsProduct] = useState<CatalogProductViewModel | null>(null);
  const [explore, setExplore] = useState<CollectionViewModel[]>([]);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [searchIntent, setSearchIntent] = useState<string | null>(null);
  const [searchDegraded, setSearchDegraded] = useState<string[]>([]);

  const loadGen = useRef(0);
  const activeQueryRef = useRef('');
  const prevPathRef = useRef<string | null>(null);

  const text = tokens.color.text;
  const muted = tokens.color.textMuted;
  const fieldBg = tokens.color.surface;
  const fieldBorder = tokens.color.border;

  const resetTypedSearch = useCallback(() => {
    loadGen.current += 1;
    activeQueryRef.current = '';
    setInput('');
    setDebouncedQuery('');
    setSections(EMPTY_SECTIONS);
    setLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
    setError(null);
    setZeroResult(false);
    setNextCursor(null);
    setSuggestions([]);
    setShowSuggestions(false);
    setDetailsVisible(false);
    setDetailsProduct(null);
    setSearchIntent(null);
    setSearchDegraded([]);
  }, []);

  useEffect(() => {
    const prev = prevPathRef.current;
    if (shouldResetSearchSession(prev, pathname)) {
      resetTypedSearch();
    }
    prevPathRef.current = pathname;
  }, [pathname, resetTypedSearch]);

  const loadExplore = useCallback(async () => {
    try {
      const videos = await fetchVideos();
      setExplore(videosToExploreCollections(videos));
    } catch {
      setExplore([]);
    } finally {
      setExploreLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadExplore();
    return subscribeFeedReload(() => {
      void loadExplore();
    });
  }, [loadExplore]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const runSearch = useCallback(async (q: string, opts?: { cursor?: string | null; append?: boolean }) => {
    const query = q.trim();
    if (!query) {
      setSections(EMPTY_SECTIONS);
      setNextCursor(null);
      setZeroResult(false);
      setError(null);
      setLoading(false);
      return;
    }

    const gen = ++loadGen.current;
    activeQueryRef.current = query;
    const append = Boolean(opts?.append && opts.cursor);

    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }

    try {
      const res = await searchBlended({
        q: query,
        presentation: 'typed',
        limit: PAGE_LIMIT,
        cursor: opts?.cursor ?? null,
      });
      if (gen !== loadGen.current) return;

      const mapped = await cardsToSections(partitionResults(res.results));
      if (gen !== loadGen.current) return;

      setSections((prev) => (append ? mergeSections(prev, mapped) : mapped));
      setNextCursor(res.nextCursor);
      setZeroResult(Boolean(res.zeroResult) && !append);
      setSearchIntent(typeof res.intent === 'string' ? res.intent : null);
      setSearchDegraded(Array.isArray(res.degraded) ? res.degraded : []);
      setError(null);
    } catch (e) {
      if (gen !== loadGen.current) return;
      if (!append) {
        setSections(EMPTY_SECTIONS);
        setNextCursor(null);
        setZeroResult(false);
      }
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      if (gen === loadGen.current) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!debouncedQuery) {
      loadGen.current += 1;
      setSections(EMPTY_SECTIONS);
      setNextCursor(null);
      setZeroResult(false);
      setError(null);
      setLoading(false);
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    void runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  useEffect(() => {
    const q = input.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void searchAutocomplete({ q, limit: 8 })
        .then((res) => {
          if (!cancelled) {
            setSuggestions(res.suggestions);
            setShowSuggestions(true);
          }
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [input]);

  const emitClick = useCallback(
    (entityType: 'collection' | 'creator' | 'product', id: string) => {
      const q = activeQueryRef.current || debouncedQuery;
      if (!q) return;
      void recordSearchClick({
        query: q,
        clickedId: id,
        clickedEntityType: entityType,
      }).catch(() => {
        /* analytics must not block nav */
      });
    },
    [debouncedQuery],
  );

  const onCollectionPress = useCallback(
    (collection: CollectionViewModel) => {
      Keyboard.dismiss();
      setShowSuggestions(false);
      emitClick('collection', collection.collectionId);

      const openSearchReel = shouldOpenSearchReelFeed({
        hasActiveQuery: Boolean(debouncedQuery.trim()),
        collections: sections.collections,
        tappedCollectionId: collection.collectionId,
      });

      if (openSearchReel) {
        beginSearchReelSession({
          query: debouncedQuery,
          collections: sections.collections,
          startCollectionId: collection.collectionId,
          nextCursor,
        });
        router.push(searchReelPath(collection.collectionId) as Href);
        return;
      }

      router.push(collectionTilePressPath(collection.collectionId) as Href);
    },
    [debouncedQuery, emitClick, nextCursor, router, sections.collections],
  );

  const onCreatorPress = useCallback(
    (creator: CreatorViewModel) => {
      Keyboard.dismiss();
      setShowSuggestions(false);
      emitClick('creator', creator.userId);
      router.push(`/creator/${encodeURIComponent(creator.username)}` as Href);
    },
    [emitClick, router],
  );

  const onProductPress = useCallback(
    (product: CatalogProductViewModel) => {
      Keyboard.dismiss();
      setShowSuggestions(false);
      if (product.catalogProductId) {
        emitClick('product', product.catalogProductId);
      }
      setDetailsProduct(product);
      setDetailsVisible(true);
    },
    [emitClick],
  );

  const onSuggestionPress = useCallback(
    (s: AutocompleteSuggestion) => {
      setShowSuggestions(false);
      Keyboard.dismiss();
      if (s.entityType === 'creator' && s.id && s.text) {
        const handle = s.text.replace(/^@/, '').trim();
        if (handle) {
          emitClick('creator', s.id);
          router.push(`/creator/${encodeURIComponent(handle)}` as Href);
          return;
        }
      }
      if (s.entityType === 'collection' && s.id) {
        emitClick('collection', s.id);
        const openSearchReel = shouldOpenSearchReelFeed({
          hasActiveQuery: Boolean(debouncedQuery.trim()),
          collections: sections.collections,
          tappedCollectionId: s.id,
        });
        if (openSearchReel) {
          beginSearchReelSession({
            query: debouncedQuery,
            collections: sections.collections,
            startCollectionId: s.id,
            nextCursor,
          });
          router.push(searchReelPath(s.id) as Href);
          return;
        }
        router.push(collectionTilePressPath(s.id) as Href);
        return;
      }
      setInput(s.text);
      setDebouncedQuery(s.text.trim());
    },
    [debouncedQuery, emitClick, nextCursor, router, sections.collections],
  );

  const onLoadMore = useCallback(() => {
    if (!debouncedQuery || !nextCursor || loading || loadingMore) return;
    void runSearch(debouncedQuery, { cursor: nextCursor, append: true });
  }, [debouncedQuery, nextCursor, loading, loadingMore, runSearch]);

  const onRefresh = useCallback(() => {
    if (!debouncedQuery) return;
    setRefreshing(true);
    void runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  const hasQuery = debouncedQuery.length > 0;
  const hasResults =
    sections.collections.length > 0 ||
    sections.creators.length > 0 ||
    sections.products.length > 0;

  const rows: ListRow[] = [];
  if (!hasQuery) {
    rows.push({
      key: 'landing',
      kind: 'landing',
      collections: explore,
      loading: exploreLoading,
    });
  } else if (loading && !hasResults) {
    rows.push({ key: 'loading', kind: 'status', text: 'Searching…' });
  } else if (error && !hasResults) {
    rows.push({
      key: 'error',
      kind: 'status',
      text: error,
      action: () => void runSearch(debouncedQuery),
    });
  } else if (zeroResult || (!loading && !hasResults)) {
    rows.push({
      key: 'empty',
      kind: 'status',
      text: `No results for “${debouncedQuery}”`,
    });
  } else {
    const fallback = popularFallbackMessage(searchDegraded);
    if (fallback) {
      rows.push({ key: 'banner-fallback', kind: 'banner', text: fallback });
    }
    const constraint = searchConstraintChipLabel(searchIntent, debouncedQuery);
    if (constraint) {
      rows.push({ key: 'banner-constraint', kind: 'banner', text: constraint });
    }

    const order = searchSectionOrder(searchIntent);
    const pushSection = (kind: SearchSectionKind) => {
      if (kind === 'collections' && sections.collections.length) {
        rows.push({
          key: 'sec-col',
          kind: 'section',
          title: searchSectionTitle('collections', searchIntent),
        });
        for (const c of sections.collections) {
          rows.push({ key: `col-${c.collectionId}`, kind: 'collection', collection: c });
        }
      }
      if (kind === 'creators' && sections.creators.length) {
        rows.push({
          key: 'sec-cre',
          kind: 'section',
          title: searchSectionTitle('creators', searchIntent),
        });
        for (const c of sections.creators) {
          rows.push({ key: `cre-${c.userId}`, kind: 'creator', creator: c });
        }
      }
      if (kind === 'products' && sections.products.length) {
        rows.push({
          key: 'sec-prod',
          kind: 'section',
          title: searchSectionTitle('products', searchIntent),
        });
        for (const p of sections.products) {
          rows.push({ key: `prod-${p.id}`, kind: 'product', product: p });
        }
      }
    };
    for (const kind of order) pushSection(kind);
    if (nextCursor || loadingMore) {
      rows.push({ key: 'footer', kind: 'footer' });
    }
  }

  const bg = pageCanvasGradient(tokens);

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
      <TopBar mode="page" title="Search" />

      <View style={styles.header}>
        <TextInput
          value={input}
          onChangeText={(v) => {
            setInput(v);
            setShowSuggestions(true);
          }}
          placeholder="Search collections, creators, products"
          placeholderTextColor={muted}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          onSubmitEditing={() => {
            setDebouncedQuery(input.trim());
            setShowSuggestions(false);
            Keyboard.dismiss();
          }}
          onFocus={() => setShowSuggestions(suggestions.length > 0)}
          style={[
            styles.input,
            {
              color: text,
              backgroundColor: fieldBg,
              borderColor: fieldBorder,
            },
          ]}
        />
        {showSuggestions && suggestions.length > 0 ? (
          <View
            style={[
              styles.suggestBox,
              { backgroundColor: fieldBg, borderColor: fieldBorder },
            ]}
          >
            {suggestions.map((s, i) => (
              <Pressable
                key={`${s.kind}-${s.text}-${i}`}
                onPress={() => onSuggestionPress(s)}
                style={styles.suggestRow}
              >
                <Text style={[styles.suggestText, { color: text }]} numberOfLines={1}>
                  {s.text}
                </Text>
                <Text style={[styles.suggestKind, { color: muted }]}>{s.kind}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        refreshControl={
          hasQuery ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={text} />
          ) : undefined
        }
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        onScrollBeginDrag={() => setShowSuggestions(false)}
        renderItem={({ item }) => {
          if (item.kind === 'landing') {
            if (item.loading && item.collections.length === 0) {
              return (
                <View style={styles.statusBlock}>
                  <ActivityIndicator color={text} />
                </View>
              );
            }
            if (item.collections.length === 0) {
              return (
                <View style={styles.landing}>
                  <Text style={[styles.landingTitle, { color: text }]}>Find what you need</Text>
                  <Text style={[styles.landingBody, { color: muted }]}>
                    Search collections, creators, and products. Results appear as you type.
                  </Text>
                </View>
              );
            }
            return (
              <View style={styles.exploreGrid}>
                {item.collections.map((collection) => (
                  <View key={collection.collectionId} style={styles.exploreCell}>
                    <CollectionTile
                      collection={collection}
                      isLight={isLight}
                      onPress={onCollectionPress}
                    />
                  </View>
                ))}
              </View>
            );
          }
          if (item.kind === 'banner') {
            return (
              <View
                style={[
                  styles.banner,
                  { backgroundColor: tokens.color.surface, borderColor: tokens.color.border },
                ]}
              >
                <Text style={[styles.bannerText, { color: muted }]}>{item.text}</Text>
              </View>
            );
          }
          if (item.kind === 'status') {
            return (
              <View style={styles.statusBlock}>
                {item.text === 'Searching…' ? (
                  <ActivityIndicator color={text} />
                ) : (
                  <Text style={[styles.statusText, { color: muted }]}>{item.text}</Text>
                )}
                {item.action ? (
                  <Pressable onPress={item.action} style={styles.retryBtn}>
                    <Text style={[styles.retryText, { color: text }]}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }
          if (item.kind === 'section') {
            return (
              <Text style={[styles.sectionTitle, { color: text }]}>{item.title}</Text>
            );
          }
          if (item.kind === 'collection') {
            return (
              <View style={styles.tileWrap}>
                <CollectionTile
                  collection={item.collection}
                  isLight={isLight}
                  onPress={onCollectionPress}
                />
              </View>
            );
          }
          if (item.kind === 'creator') {
            return (
              <View style={styles.cardWrap}>
                <CreatorCard
                  creator={item.creator}
                  isLight={isLight}
                  onPress={onCreatorPress}
                />
              </View>
            );
          }
          if (item.kind === 'product') {
            return (
              <View style={styles.cardWrap}>
                <ProductCard
                  product={item.product}
                  isLight={isLight}
                  variant="standard"
                  showIndexPrice
                  onPress={onProductPress}
                  onAddToCart={item.product.catalogProductId ? onAddToCart : undefined}
                  onBuy={item.product.catalogProductId ? onBuy : undefined}
                />
              </View>
            );
          }
          return (
            <View style={styles.footer}>
              {loadingMore ? <ActivityIndicator color={text} /> : null}
            </View>
          );
        }}
      />

      <ProductDetailsSheet
        visible={detailsVisible}
        product={detailsProduct}
        isLight={isLight}
        onClose={() => setDetailsVisible(false)}
        onAddToCart={detailsProduct?.catalogProductId ? onAddToCart : undefined}
        onBuy={detailsProduct?.catalogProductId ? onBuy : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 10,
    zIndex: 2,
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  suggestBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  suggestRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  suggestText: { flex: 1, fontSize: 15, fontWeight: '600' },
  suggestKind: { fontSize: 12, textTransform: 'capitalize' },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 10,
  },
  landing: {
    paddingTop: 48,
    paddingHorizontal: 8,
    gap: 8,
  },
  landingTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  landingBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  banner: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  exploreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
  },
  exploreCell: {
    width: '31.5%',
    flexGrow: 1,
    maxWidth: '32.5%',
  },
  statusBlock: {
    paddingTop: 40,
    alignItems: 'center',
    gap: 12,
  },
  statusText: {
    fontSize: 15,
    textAlign: 'center',
  },
  retryBtn: { padding: 12 },
  retryText: { fontWeight: '700', fontSize: 16 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 4,
  },
  tileWrap: {
    width: '100%',
    maxWidth: 220,
    alignSelf: 'flex-start',
  },
  cardWrap: {
    width: '100%',
  },
  footer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
