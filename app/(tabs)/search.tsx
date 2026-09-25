import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { SearchModeSwitch, type SearchUtilityMode } from '@/components/search/SearchModeSwitch';
import { ShareActivityCard } from '@/components/search/ShareActivityCard';
import { ContentRail } from '@/components/ui/ContentRail';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useImportSharesPoll } from '@/src/hooks/useImportSharesPoll';
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
  type SearchResultCard,
} from '@/src/services/searchApi';
import { fetchVideos } from '@/src/services/supabase';
import {
  deleteUserImport,
  retryUserImport,
  submitUserImport,
  UserImportApiError,
} from '@/src/services/userImportApi';
import { shouldResetSearchSession } from '@/src/state/searchSession';
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
import {
  popularFallbackMessage,
  searchConstraintChipLabel,
  searchSectionOrder,
  searchSectionTitle,
  type SearchSectionKind,
} from '@/src/ui/searchSections';
import {
  SHARE_ACTIVITY_COPY,
  shareActivityLandingItems,
} from '@/src/ui/shareActivity';
import { extractSharedLink, sharedLinkMessage } from '@/src/ui/shareImport';

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
const PASTE_PLACEHOLDER = 'Paste a product, Reel or Short URL';

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
  | { key: string; kind: 'activity' }
  | { key: string; kind: 'discover_posts' }
  | { key: string; kind: 'discover_product_collections' }
  | { key: string; kind: 'discover_products' }
  | { key: string; kind: 'landing_empty' }
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
  const { width: screenWidth } = useWindowDimensions();
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const { refresh: refreshCart } = useCart();
  const onBuy = useProductBuyHandler();
  const onAddToCart = useProductAddToCartHandler();
  const onImportBecameReady = useCallback(() => {
    void refreshCart();
  }, [refreshCart]);
  const { shares, refresh: refreshShares } = useImportSharesPoll({
    enabled: Boolean(user),
    onBecameReady: onImportBecameReady,
  });
  const activityItems = useMemo(() => shareActivityLandingItems(shares), [shares]);

  const onRetryShare = useCallback(
    async (importId: string) => {
      try {
        await retryUserImport(importId);
        await refreshShares();
      } catch {
        /* surface via next poll */
      }
    },
    [refreshShares],
  );

  const onDeleteShare = useCallback(
    async (importId: string) => {
      try {
        await deleteUserImport(importId);
        await refreshShares();
      } catch {
        /* ignore */
      }
    },
    [refreshShares],
  );

  const [mode, setMode] = useState<SearchUtilityMode>('search');
  const [input, setInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sections, setSections] = useState<SearchSections>(EMPTY_SECTIONS);
  const [discover, setDiscover] = useState<SearchDiscoverLanding>(EMPTY_DISCOVER);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zeroResult, setZeroResult] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchIntent, setSearchIntent] = useState<string | null>(null);
  const [searchDegraded, setSearchDegraded] = useState<string[]>([]);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteAck, setPasteAck] = useState<string | null>(null);
  const [pasteSubmitting, setPasteSubmitting] = useState(false);

  const loadGen = useRef(0);
  const activeQueryRef = useRef('');
  const prevPathRef = useRef<string | null>(null);

  const text = tokens.color.text;
  const muted = tokens.color.textMuted;
  const fieldBg = tokens.color.surface;
  const fieldBorder = tokens.color.border;

  const postCardWidth = Math.min(148, Math.round(screenWidth * 0.38));
  const productCardWidth = Math.min(148, Math.round((screenWidth - GUTTER * 2 - GRID_GAP) / 2.15));
  const categoryCardWidth = (screenWidth - GUTTER * 2 - GRID_GAP) / 2;
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
    setSearchIntent(null);
    setSearchDegraded([]);
    setPasteError(null);
    setPasteAck(null);
    setPasteSubmitting(false);
  }, []);

  useEffect(() => {
    const prev = prevPathRef.current;
    if (shouldResetSearchSession(prev, pathname)) {
      resetTypedSearch();
      setMode('search');
    }
    prevPathRef.current = pathname;
  }, [pathname, resetTypedSearch]);

  useEffect(() => {
    if (mode !== 'search') {
      setDebouncedQuery('');
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const t = setTimeout(() => setDebouncedQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, mode]);

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
    if (mode !== 'search' || !debouncedQuery) {
      if (!debouncedQuery) {
        loadGen.current += 1;
        setSections(EMPTY_SECTIONS);
        setNextCursor(null);
        setZeroResult(false);
        setError(null);
        setLoading(false);
        setSuggestions([]);
        setShowSuggestions(false);
      }
      return;
    }
    void runSearch(debouncedQuery);
  }, [debouncedQuery, mode, runSearch]);

  useEffect(() => {
    if (mode !== 'search') return;
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
  }, [input, mode]);

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
      setInput(s.text);
      setDebouncedQuery(s.text.trim());
    },
    [debouncedQuery, emitClick, nextCursor, router, sections.collections],
  );

  const onPasteSubmit = useCallback(async () => {
    setPasteError(null);
    setPasteAck(null);
    const extracted = extractSharedLink(input);
    if (!extracted.ok) {
      setPasteError(sharedLinkMessage(extracted.reason));
      return;
    }
    if (!user) {
      setPasteError('Sign in to send links to Mystash.');
      return;
    }
    setPasteSubmitting(true);
    try {
      await submitUserImport(extracted.rawInput);
      setPasteAck('Got it — Mystash received your link.');
      setInput('');
      void refreshShares();
    } catch (e) {
      const message =
        e instanceof UserImportApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Mystash could not accept that link.';
      setPasteError(message);
    } finally {
      setPasteSubmitting(false);
    }
  }, [input, refreshShares, user]);

  const onModeChange = useCallback((next: SearchUtilityMode) => {
    setMode(next);
    setPasteError(null);
    setPasteAck(null);
    setShowSuggestions(false);
    if (next === 'paste_url') {
      setDebouncedQuery('');
      setSuggestions([]);
    }
  }, []);

  const onLoadMore = useCallback(() => {
    if (mode !== 'search' || !debouncedQuery || !nextCursor || loading || loadingMore) return;
    void runSearch(debouncedQuery, { cursor: nextCursor, append: true });
  }, [debouncedQuery, nextCursor, loading, loadingMore, mode, runSearch]);

  const onRefresh = useCallback(() => {
    if (mode === 'paste_url' || !debouncedQuery) {
      setRefreshing(true);
      void Promise.all([refreshShares(), loadDiscover()]).finally(() => setRefreshing(false));
      return;
    }
    setRefreshing(true);
    void runSearch(debouncedQuery);
  }, [debouncedQuery, loadDiscover, mode, refreshShares, runSearch]);

  const hasQuery = mode === 'search' && debouncedQuery.length > 0;
  const hasResults =
    sections.collections.length > 0 ||
    sections.creators.length > 0 ||
    sections.products.length > 0;
  const hasDiscover = searchDiscoverHasContent(discover);

  const productCollectionRows: CreatorProductShelf[][] = [];
  for (let i = 0; i < discover.productCollections.length; i += 2) {
    productCollectionRows.push(discover.productCollections.slice(i, i + 2));
  }

  const rows: ListRow[] = [];
  if (!hasQuery) {
    if (activityItems.length > 0) {
      rows.push({ key: 'activity', kind: 'activity' });
    }
    if (discover.posts.length > 0) {
      rows.push({ key: 'discover_posts', kind: 'discover_posts' });
    }
    if (discover.productCollections.length > 0) {
      rows.push({ key: 'discover_product_collections', kind: 'discover_product_collections' });
    }
    if (discover.products.length > 0) {
      rows.push({ key: 'discover_products', kind: 'discover_products' });
    }
    if (!discoverLoading && !hasDiscover && activityItems.length === 0) {
      rows.push({ key: 'landing_empty', kind: 'landing_empty' });
    }
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

  const placeholder = mode === 'search' ? SEARCH_PLACEHOLDER : PASTE_PLACEHOLDER;

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
              borderColor: pasteError ? tokens.color.danger : fieldBorder,
              borderRadius: tokens.radius.lg,
            },
          ]}
        >
          <Ionicons
            name={mode === 'paste_url' ? 'link-outline' : 'search-outline'}
            size={18}
            color={muted}
          />
          <TextInput
            value={input}
            onChangeText={(v) => {
              setInput(v);
              setPasteError(null);
              setPasteAck(null);
              if (mode === 'search') setShowSuggestions(true);
            }}
            placeholder={placeholder}
            placeholderTextColor={muted}
            returnKeyType={mode === 'search' ? 'search' : 'go'}
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete="off"
            keyboardType={mode === 'paste_url' ? 'url' : 'default'}
            clearButtonMode="while-editing"
            editable={!pasteSubmitting}
            onSubmitEditing={() => {
              if (mode === 'paste_url') {
                void onPasteSubmit();
                Keyboard.dismiss();
                return;
              }
              setDebouncedQuery(input.trim());
              setShowSuggestions(false);
              Keyboard.dismiss();
            }}
            onFocus={() => {
              if (mode === 'search' && suggestions.length > 0) setShowSuggestions(true);
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
        <SearchModeSwitch mode={mode} onChange={onModeChange} />
        {pasteError ? (
          <Text style={[typeStyle(tokens, 'tileMeta'), { color: tokens.color.danger }]}>
            {pasteError}
          </Text>
        ) : null}
        {pasteAck ? (
          <Text style={typeStyle(tokens, 'bodyMuted')}>{pasteAck}</Text>
        ) : null}
        {pasteSubmitting ? (
          <View style={styles.pasteBusy}>
            <ActivityIndicator size="small" color={tokens.color.primary} />
            <Text style={typeStyle(tokens, 'bodyMuted')}>Sending your link…</Text>
          </View>
        ) : null}
        {mode === 'search' && showSuggestions && suggestions.length > 0 ? (
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={text} />
        }
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        onScrollBeginDrag={() => setShowSuggestions(false)}
        ListHeaderComponent={
          !hasQuery && discoverLoading && !hasDiscover ? (
            <View style={styles.statusBlock}>
              <ActivityIndicator color={tokens.color.primary} />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'activity') {
            return (
              <View style={{ gap: tokens.space.md }}>
                <SectionHeader
                  title={SHARE_ACTIVITY_COPY.sectionTitle}
                  actionLabel={SHARE_ACTIVITY_COPY.seeAll}
                  onActionPress={() => router.push('/shares' as Href)}
                />
                {activityItems.map((activity) => (
                  <ShareActivityCard
                    key={activity.importId}
                    item={activity}
                    compact
                    expandable
                    onRetry={onRetryShare}
                    onDelete={onDeleteShare}
                  />
                ))}
              </View>
            );
          }
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
          if (item.kind === 'status') {
            return (
              <View style={styles.statusBlock}>
                {item.text === 'Searching…' ? (
                  <ActivityIndicator color={tokens.color.primary} />
                ) : (
                  <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>
                    {item.text}
                  </Text>
                )}
                {item.action ? (
                  <Pressable onPress={item.action} style={{ padding: tokens.space.sm }}>
                    <Text style={typeStyle(tokens, 'link')}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }
          if (item.kind === 'section') {
            return <SectionHeader title={item.title} />;
          }
          if (item.kind === 'collection') {
            return (
              <View style={styles.tileWrap}>
                <CollectionTile collection={item.collection} onPress={onCollectionPress} />
              </View>
            );
          }
          if (item.kind === 'creator') {
            return (
              <View style={styles.cardWrap}>
                <CreatorCard creator={item.creator} onPress={onCreatorPress} />
              </View>
            );
          }
          if (item.kind === 'product') {
            return (
              <View style={styles.cardWrap}>
                <ProductCard
                  product={item.product}
                  variant="related"
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
              {loadingMore ? <ActivityIndicator color={tokens.color.primary} /> : null}
            </View>
          );
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
  pasteBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
