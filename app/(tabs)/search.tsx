import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { CollectionTile } from '@/components/collection/CollectionTile';
import { PublicCollectionTile } from '@/components/collection/PublicCollectionTile';
import { ProductCard } from '@/components/commerce/ProductCard';
import { StashCategoryCard } from '@/components/commerce/StashCategoryCard';
import { CreatorCard } from '@/components/creator/CreatorCard';
import { SearchResultsTabs } from '@/components/search/SearchResultsTabs';
import {
  SearchDiscoverSkeleton,
  SearchMoreSkeleton,
  SearchResultsSkeleton,
} from '@/components/search/SearchSkeletonLayouts';
import { ContentRail } from '@/components/ui/ContentRail';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  dedupeById,
  mapSearchCollectionCard,
  mapSearchCreatorCard,
} from '@/src/mappers/searchMapper';
import { hydrateSearchProducts } from '@/src/mappers/searchProductHydration';
import {
  useProductAddToCartHandler,
  useProductBuyHandler,
} from '@/src/services/productActionOrchestration';
import {
  recordSearchClick,
  searchAutocomplete,
  searchBlended,
  type AutocompleteSuggestion,
  type SearchEntityType,
  type SearchResultCard,
} from '@/src/services/searchApi';
import { fetchVideos } from '@/src/services/supabase';
import { shouldResetSearchSession } from '@/src/state/searchSession';
import { emptySearchSession, mergeSearchSections, replaceSearchQuery as nextSearchSession,
  searchResponseIsCurrent, type SearchSections, type SearchTabState, type SearchSession } from '@/src/state/searchResultSession';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import { productPagePath } from '@/src/ui/productPage';
import {
  beginSearchReelSession,
  searchReelPath,
  shouldOpenSearchReelFeed,
} from '@/src/ui/searchReelNavigation';
import { loadSearchDiscoverLanding } from '@/src/ui/searchDiscoverLoad';
import type {
  CreatorProductShelf,
  SearchDiscoverLanding,
} from '@/src/ui/searchDiscoverUx';
import {
  buildSearchDiscoverLanding,
  creatorProductShelfHref,
  creatorProductShelfMetaLabel,
  creatorProductShelfToStashCategoryCard,
  SEARCH_DISCOVER_COPY,
  searchDiscoverHasContent,
} from '@/src/ui/searchDiscoverUx';
import { searchConstraintChipLabel } from '@/src/ui/searchSections';
import { resolveListLoadState } from '@/src/ui/contentLoadState';

const DEBOUNCE_MS = 300;
const PAGE_LIMIT = 20;
const GUTTER = 16;
const GRID_GAP = 12;
const EMPTY_DISCOVER: SearchDiscoverLanding = {
  posts: [],
  productCollections: [],
  products: [],
};

const SEARCH_PLACEHOLDER = 'Search products, creators, collections';

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
  | { key: string; kind: 'discover_posts' }
  | { key: string; kind: 'discover_product_collections' }
  | { key: string; kind: 'discover_products' }
  | { key: string; kind: 'landing_empty' }
  | { key: string; kind: 'banner'; text: string }
  | { key: string; kind: 'status'; text: string; action?: () => void }
  | { key: string; kind: 'collection_row'; collections: CollectionViewModel[] }
  | { key: string; kind: 'creator'; creator: CreatorViewModel }
  | { key: string; kind: 'product_row'; products: CatalogProductViewModel[] }
  | { key: string; kind: 'skeleton_discover' }
  | { key: string; kind: 'skeleton_search' }
  | { key: string; kind: 'skeleton_more' }
  | { key: string; kind: 'footer' };

export default function SearchScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const onBuy = useProductBuyHandler();
  const onAddToCart = useProductAddToCartHandler();
  const [input, setInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SearchEntityType>('collection');
  const [session, setSession] = useState<SearchSession>(() => emptySearchSession());
  const [discover, setDiscover] = useState<SearchDiscoverLanding>(EMPTY_DISCOVER);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const sessionRef = useRef(session), inputRef = useRef(input), queryEpoch = useRef(0);
  const tabRequestRef = useRef<Record<SearchEntityType, number>>({ collection: 0, creator: 0, product: 0 });
  const busyRef = useRef<Record<SearchEntityType, boolean>>({ collection: false, creator: false, product: false });
  const previousOwnerRef = useRef(user?.id ?? null);
  const measurementRef=useRef<Record<SearchEntityType,{requestId:string|null;results:{id:string;entityType:string}[]}>>({
    collection:{requestId:null,results:[]},creator:{requestId:null,results:[]},product:{requestId:null,results:[]}});
  const prevPathRef = useRef<string | null>(null);
  sessionRef.current = session;
  inputRef.current = input;

  const text = tokens.color.text;
  const muted = tokens.color.textMuted;
  const fieldBg = tokens.color.surface;
  const fieldBorder = tokens.color.border;

  const postCardWidth = Math.min(148, Math.round(screenWidth * 0.38));
  const productCardWidth = Math.min(148, Math.round((screenWidth - GUTTER * 2 - GRID_GAP) / 2.15));
  const categoryCardWidth = (screenWidth - GUTTER * 2 - GRID_GAP) / 2;
  const resultColumns = screenWidth < 360 || fontScale >= 1.6 ? 1 : 2;
  const resultCardWidth = (screenWidth - GUTTER * 2 - GRID_GAP * (resultColumns - 1)) / resultColumns;
  const railGap = tokens.space.sm;

  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const videos = await fetchVideos();
      // Progressive paint: sync shelves first, then replace with hydrated data.
      setDiscover(buildSearchDiscoverLanding(videos));
      setDiscoverLoading(false);
      setDiscover(await loadSearchDiscoverLanding(videos));
    } catch {
      setDiscover(EMPTY_DISCOVER);
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDiscover();
  }, [loadDiscover]);

  const replaceQuery = useCallback((value: string) => {
    const query = value.trim();
    inputRef.current = value;
    setInput(value);
    if (query !== sessionRef.current.query) {
      queryEpoch.current++;
      busyRef.current = { collection: false, creator: false, product: false };
      const next = nextSearchSession(sessionRef.current, query);
      sessionRef.current = next;
      setSession(next);
      setSelectedCategory('collection');
      measurementRef.current = { collection:{requestId:null,results:[]},creator:{requestId:null,results:[]},product:{requestId:null,results:[]} };
    }
    setSuggestions([]);
  }, []);

  const resetTypedSearch = useCallback(() => {
    replaceQuery('');
    setDebouncedQuery('');
    setRefreshing(false);
    setShowSuggestions(false);
  }, [replaceQuery]);

  useEffect(() => {
    const prev = prevPathRef.current;
    if (shouldResetSearchSession(prev, pathname)) {
      resetTypedSearch();
    }
    prevPathRef.current = pathname;
  }, [pathname, resetTypedSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const activeTab = session.tabs[selectedCategory];
  const sections = activeTab.sections;
  const nextCursor = activeTab.nextCursor;
  const searchIntent = activeTab.intent;
  const error = activeTab.error;
  const loading = activeTab.loading;
  const loadingMore = activeTab.loadingMore;
  const zeroResult = activeTab.zeroResult;

  const updateTab = useCallback((query: string, category: SearchEntityType, update: (tab: SearchTabState) => SearchTabState) => {
    const previous = sessionRef.current;
    if (previous.query !== query) return;
    const next = { ...previous, tabs: { ...previous.tabs, [category]: update(previous.tabs[category]) } };
    sessionRef.current = next;
    setSession(next);
  }, []);

  const runSearch = useCallback(async (q: string, category: SearchEntityType, opts?: { append?: boolean; force?: boolean }) => {
    const query = q.trim();
    if (!query || query !== inputRef.current.trim() || sessionRef.current.query !== query) return;
    const current = sessionRef.current.tabs[category];
    const append = Boolean(opts?.append && current.nextCursor);
    if ((opts?.append && !append) || busyRef.current[category]
      || (!append && current.loaded && !opts?.force)) return;
    const cursor = append ? current.nextCursor : null;
    const epoch = queryEpoch.current, request = ++tabRequestRef.current[category];
    busyRef.current[category] = true;
    updateTab(query, category, tab => ({ ...tab, loading: !append && !tab.loaded,
      refreshing: !append && tab.loaded, loadingMore: append, error: null }));

    try {
      const res = await searchBlended({
        q: query,
        entityType: category,
        presentation: 'unified',
        measureTypedResults: true,
        limit: PAGE_LIMIT,
        cursor,
      });
      if (!searchResponseIsCurrent(sessionRef.current, inputRef.current, query, epoch, queryEpoch.current, request, tabRequestRef.current[category])) return;
      const mapped = await cardsToSections(partitionResults(res.results));
      if (!searchResponseIsCurrent(sessionRef.current, inputRef.current, query, epoch, queryEpoch.current, request, tabRequestRef.current[category])) return;
      if (!append) measurementRef.current[category] = { requestId: res.measurementRequestId ?? null, results: res.results };
      updateTab(query, category, tab => ({ ...tab, sections: append ? mergeSearchSections(tab.sections, mapped) : mapped,
        nextCursor: res.nextCursor, zeroResult: !append && Boolean(res.zeroResult),
        intent: typeof res.intent === 'string' ? res.intent : null, error: null, loaded: true }));
    } catch (e) {
      if (!searchResponseIsCurrent(sessionRef.current, inputRef.current, query, epoch, queryEpoch.current, request, tabRequestRef.current[category])) return;
      updateTab(query, category, tab => ({ ...tab, loaded: true, error: e instanceof Error ? e.message : 'Search failed' }));
    } finally {
      if (request === tabRequestRef.current[category]) busyRef.current[category] = false;
      if (epoch === queryEpoch.current && request === tabRequestRef.current[category])
        updateTab(query, category, tab => ({ ...tab, loading: false, loadingMore: false, refreshing: false }));
    }
  }, [updateTab]);

  useEffect(() => {
    if (debouncedQuery && debouncedQuery === inputRef.current.trim()) void runSearch(debouncedQuery, selectedCategory);
  }, [debouncedQuery, selectedCategory, runSearch]);

  useEffect(() => {
    const owner = user?.id ?? null;
    if (previousOwnerRef.current === owner) return;
    previousOwnerRef.current = owner;
    queryEpoch.current++;
    busyRef.current = { collection: false, creator: false, product: false };
    const query = inputRef.current.trim(), next = emptySearchSession(query);
    sessionRef.current = next;
    setSession(next);
    setSelectedCategory('collection');
    setSuggestions([]);
    if (query) void runSearch(query, 'collection');
  }, [user?.id, runSearch]);

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
  }, [input, user?.id]);

  const emitClick = useCallback(
    (entityType: 'collection' | 'creator' | 'product', id: string) => {
      const q = sessionRef.current.query;
      if (!q) return;
      const measurement = measurementRef.current[entityType];
      void recordSearchClick({
        query: q,
        clickedId: id,
        clickedEntityType: entityType,
        requestId:measurement.requestId,
        rank:measurement.results.findIndex(r=>r.id===id&&r.entityType===entityType),
      }).catch(() => {
        /* analytics must not block nav */
      });
    },
    [],
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
          entityType: 'collection',
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

  const onDiscoverCollectionPress = useCallback(
    (collection: CollectionViewModel) => {
      Keyboard.dismiss();
      router.push(collectionTilePressPath(collection.collectionId) as Href);
    },
    [router],
  );

  const onProductCollectionPress = useCallback(
    (shelf: CreatorProductShelf) => {
      Keyboard.dismiss();
      router.push(creatorProductShelfHref(shelf.username) as Href);
    },
    [router],
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
      const productId = product.catalogProductId ?? product.id;
      if (product.catalogProductId) {
        emitClick('product', product.catalogProductId);
      }
      router.push(productPagePath(productId) as Href);
    },
    [emitClick, router],
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
            entityType: 'collection',
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
      if (s.entityType === 'product' && s.id) {
        emitClick('product', s.id);
        router.push(productPagePath(s.id) as Href);
        return;
      }
      replaceQuery(s.text);
      setDebouncedQuery(s.text.trim());
    },
    [debouncedQuery, emitClick, nextCursor, replaceQuery, router, sections.collections],
  );

  const onLoadMore = useCallback(() => {
    if (!debouncedQuery || debouncedQuery !== input.trim() || !nextCursor || loading || loadingMore) return;
    void runSearch(debouncedQuery, selectedCategory, { append: true });
  }, [debouncedQuery, input, nextCursor, loading, loadingMore, selectedCategory, runSearch]);

  const onRefresh = useCallback(() => {
    if (!input.trim()) {
      setRefreshing(true);
      void loadDiscover().finally(() => setRefreshing(false));
      return;
    }
    if (debouncedQuery === input.trim()) void runSearch(debouncedQuery, selectedCategory, { force: true });
  }, [debouncedQuery, input, loadDiscover, runSearch, selectedCategory]);

  const hasQuery = input.trim().length > 0;
  const queryReady = debouncedQuery === input.trim();
  const hasResults =
    sections.collections.length > 0 ||
    sections.creators.length > 0 ||
    sections.products.length > 0;
  const hasDiscover = searchDiscoverHasContent(discover);

  const productCollectionRows: CreatorProductShelf[][] = [];
  for (let i = 0; i < discover.productCollections.length; i += 2) {
    productCollectionRows.push(discover.productCollections.slice(i, i + 2));
  }

  const resultCount = selectedCategory === 'collection' ? sections.collections.length
    : selectedCategory === 'creator' ? sections.creators.length : sections.products.length;
  const searchLoad = resolveListLoadState({
    itemCount: resultCount,
    fetching: !queryReady || !activeTab.loaded || loading || activeTab.refreshing,
    fetchingMore: loadingMore,
    error: Boolean(error),
  });
  const discoverLoad = resolveListLoadState({
    itemCount: hasDiscover ? 1 : 0,
    fetching: discoverLoading,
  });

  const rows: ListRow[] = [];
  if (!hasQuery) {
    if (discoverLoad === 'skeleton') {
      rows.push({ key: 'skeleton_discover', kind: 'skeleton_discover' });
    } else {
      if (discover.posts.length > 0) {
        rows.push({ key: 'discover_posts', kind: 'discover_posts' });
      }
      if (discover.productCollections.length > 0) {
        rows.push({ key: 'discover_product_collections', kind: 'discover_product_collections' });
      }
      if (discover.products.length > 0) {
        rows.push({ key: 'discover_products', kind: 'discover_products' });
      }
      if (discoverLoad === 'empty') {
        rows.push({ key: 'landing_empty', kind: 'landing_empty' });
      }
    }
  } else if (!queryReady || searchLoad === 'skeleton') {
    rows.push({ key: 'skeleton_search', kind: 'skeleton_search' });
  } else if (error && !hasResults) {
    rows.push({
      key: 'error',
      kind: 'status',
      text: error,
      action: () => void runSearch(debouncedQuery, selectedCategory, { force: true }),
    });
  } else if (zeroResult || (!loading && !hasResults)) {
    rows.push({
      key: 'empty',
      kind: 'status',
      text: `No results for “${debouncedQuery}”`,
    });
  } else {
    if (error) rows.push({ key: 'banner-error', kind: 'banner', text: 'Couldn’t refresh. Your results are still here.' });
    const constraint = searchConstraintChipLabel(searchIntent, debouncedQuery);
    if (constraint && selectedCategory === 'product') {
      rows.push({ key: 'banner-constraint', kind: 'banner', text: constraint });
    }
    if (selectedCategory === 'collection') {
      for (let i = 0; i < sections.collections.length; i += resultColumns) {
        const collections = sections.collections.slice(i, i + resultColumns);
        rows.push({ key: `col-${collections.map(c => c.collectionId).join('-')}`, kind: 'collection_row', collections });
      }
    } else if (selectedCategory === 'creator') {
      for (const creator of sections.creators) rows.push({ key: `cre-${creator.userId}`, kind: 'creator', creator });
    } else {
      for (let i = 0; i < sections.products.length; i += resultColumns) {
        const products = sections.products.slice(i, i + resultColumns);
        rows.push({ key: `prod-${products.map(p => p.id).join('-')}`, kind: 'product_row', products });
      }
    }
    if (searchLoad === 'contentPaginating') {
      rows.push({ key: 'skeleton_more', kind: 'skeleton_more' });
    } else if (nextCursor || loadingMore) {
      rows.push({ key: 'footer', kind: 'footer' });
    }
  }

  const placeholder = SEARCH_PLACEHOLDER;

  return (
    <View style={[styles.root, { backgroundColor: tokens.color.canvasSoft }]}>
      <TopBar mode="page" title="Search" />

      <View
        style={[
          styles.header,
          {
            paddingHorizontal: GUTTER,
            paddingTop: tokens.space.sm,
            paddingBottom: tokens.space.md,
            gap: tokens.space.md,
          },
        ]}
      >
        <View
          style={[
            styles.inputRow,
            {
              backgroundColor: fieldBg,
              borderColor: fieldBorder,
              borderRadius: tokens.radius.lg,
            },
          ]}
        >
          <Ionicons
            name="search-outline"
            size={18}
            color={muted}
          />
          <TextInput
            value={input}
            onChangeText={(v) => {
              replaceQuery(v);
              setShowSuggestions(true);
            }}
            placeholder={placeholder}
            placeholderTextColor={muted}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete="off"
            keyboardType="default"
            clearButtonMode="while-editing"
            onSubmitEditing={() => {
              setDebouncedQuery(input.trim());
              setShowSuggestions(false);
              Keyboard.dismiss();
            }}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            style={[
              styles.input,
              {
                color: text,
                fontFamily: tokens.fontFamily.regular,
                fontSize: tokens.fontSize.body,
                lineHeight: tokens.lineHeight.body,
              },
            ]}
          />
        </View>
        {hasQuery ? <SearchResultsTabs selected={selectedCategory} onSelect={setSelectedCategory} /> : null}
        {showSuggestions && suggestions.length > 0 ? (
          <View
            style={[
              styles.suggestBox,
              {
                backgroundColor: fieldBg,
                borderColor: fieldBorder,
                borderRadius: tokens.radius.lg,
              },
            ]}
          >
            {suggestions.map((s, i) => (
              <Pressable
                key={`${s.kind}-${s.text}-${i}`}
                onPress={() => onSuggestionPress(s)}
                style={[styles.suggestRow, { paddingHorizontal: tokens.space.sm + 2 }]}
              >
                <Text style={[typeStyle(tokens, 'tileTitle'), { flex: 1 }]} numberOfLines={1}>
                  {s.text}
                </Text>
                <Text style={typeStyle(tokens, 'tileMeta')}>{s.kind}</Text>
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
        contentContainerStyle={[
          styles.listContent,
          {
            paddingHorizontal: GUTTER,
            paddingTop: tokens.space.sm,
            paddingBottom: tokens.space.xxl,
            gap: tokens.space.xl,
          },
        ]}
        refreshControl={
          <RefreshControl refreshing={hasQuery ? activeTab.refreshing : refreshing} onRefresh={onRefresh} tintColor={text} />
        }
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        onScrollBeginDrag={() => setShowSuggestions(false)}
        renderItem={({ item }) => {
          if (item.kind === 'discover_posts') {
            return (
              <View style={{ gap: tokens.space.md }}>
                <SectionHeader title={SEARCH_DISCOVER_COPY.latestCollections} />
                <ContentRail
                  gutter={GUTTER}
                  itemPitch={postCardWidth + railGap}
                  itemGap={railGap}
                >
                  {discover.posts.map((collection) => (
                    <View key={collection.collectionId} style={{ width: postCardWidth }}>
                      <PublicCollectionTile
                        collection={collection}
                        onPress={onDiscoverCollectionPress}
                      />
                    </View>
                  ))}
                </ContentRail>
              </View>
            );
          }
          if (item.kind === 'discover_product_collections') {
            return (
              <View style={{ gap: tokens.space.md }}>
                <SectionHeader title={SEARCH_DISCOVER_COPY.productCollections} />
                <View style={{ gap: GRID_GAP }}>
                  {productCollectionRows.map((row) => (
                    <View
                      key={row.map((s) => s.username).join('-')}
                      style={{ flexDirection: 'row', gap: GRID_GAP }}
                    >
                      {row.map((shelf) => (
                        <View key={shelf.username} style={{ width: categoryCardWidth }}>
                          <StashCategoryCard
                            category={creatorProductShelfToStashCategoryCard(shelf)}
                            metaLabel={creatorProductShelfMetaLabel(shelf)}
                            onPress={() => onProductCollectionPress(shelf)}
                          />
                        </View>
                      ))}
                      {row.length === 1 ? <View style={{ width: categoryCardWidth }} /> : null}
                    </View>
                  ))}
                </View>
              </View>
            );
          }
          if (item.kind === 'discover_products') {
            return (
              <View style={{ gap: tokens.space.md }}>
                <SectionHeader title={SEARCH_DISCOVER_COPY.recentProducts} />
                <ContentRail
                  gutter={GUTTER}
                  itemPitch={productCardWidth + railGap}
                  itemGap={railGap}
                >
                  {discover.products.map((product) => (
                    <View key={product.id} style={{ width: productCardWidth }}>
                      <ProductCard
                        product={product}
                        variant="related"
                        showIndexPrice
                        onPress={onProductPress}
                        onAddToCart={product.catalogProductId ? onAddToCart : undefined}
                      />
                    </View>
                  ))}
                </ContentRail>
              </View>
            );
          }
          if (item.kind === 'landing_empty') {
            return (
              <View style={[styles.landing, { gap: tokens.space.xs }]}>
                <Text style={typeStyle(tokens, 'sectionTitle')}>Discover</Text>
                <Text style={typeStyle(tokens, 'bodyMuted')}>{SEARCH_DISCOVER_COPY.emptyHint}</Text>
              </View>
            );
          }
          if (item.kind === 'banner') {
            return (
              <View
                style={[
                  styles.banner,
                  {
                    ...outlineCardChrome(tokens),
                    borderRadius: tokens.radius.lg,
                    paddingHorizontal: tokens.space.sm,
                    paddingVertical: tokens.space.xs,
                  },
                ]}
              >
                <Text style={[typeStyle(tokens, 'tileMeta'), { textAlign: 'center' }]}>
                  {item.text}
                </Text>
              </View>
            );
          }
          if (item.kind === 'skeleton_discover') {
            return <SearchDiscoverSkeleton />;
          }
          if (item.kind === 'skeleton_search') {
            return <SearchResultsSkeleton entityType={selectedCategory} />;
          }
          if (item.kind === 'skeleton_more') {
            return <SearchMoreSkeleton entityType={selectedCategory} />;
          }
          if (item.kind === 'status') {
            return (
              <View style={styles.statusBlock}>
                <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>
                  {item.text}
                </Text>
                {item.action ? (
                  <Pressable onPress={item.action} style={{ padding: tokens.space.sm }}>
                    <Text style={typeStyle(tokens, 'link')}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }
          if (item.kind === 'collection_row') {
            return <View style={{ flexDirection: 'row', gap: GRID_GAP }}>
              {item.collections.map(collection => <View key={collection.collectionId} style={{ width: resultCardWidth }}>
                <CollectionTile collection={collection} onPress={onCollectionPress} />
              </View>)}
            </View>;
          }
          if (item.kind === 'creator') {
            return (
              <View style={styles.cardWrap}>
                <CreatorCard creator={item.creator} onPress={onCreatorPress} />
              </View>
            );
          }
          if (item.kind === 'product_row') {
            return <View style={{ flexDirection: 'row', gap: GRID_GAP }}>
              {item.products.map(product => <View key={product.id} style={{ width: resultCardWidth }}>
                <ProductCard product={product} variant="related" showIndexPrice onPress={onProductPress}
                  onAddToCart={product.catalogProductId ? onAddToCart : undefined}
                  onBuy={product.catalogProductId ? onBuy : undefined} />
              </View>)}
            </View>;
          }
          return <View style={styles.footer} />;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    zIndex: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    gap: 8,
    minHeight: 44,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
  },
  suggestBox: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  suggestRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  listContent: {},
  landing: {
    paddingTop: 8,
  },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusBlock: {
    paddingTop: 40,
    alignItems: 'center',
    gap: 12,
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
