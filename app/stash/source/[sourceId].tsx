import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProductCard } from '@/components/commerce/ProductCard';
import { FeedProductSheet } from '@/components/feed/FeedProductSheet';
import { PlaceCard } from '@/components/place/PlaceCard';
import { PlaceSourceVideoModal } from '@/components/place/PlaceSourceVideoModal';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useCartOptional } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { findApi } from '@/src/services/findApi';
import type { FindItem, FindSourceResult } from '@/src/services/findClient';
import { fetchAllPlaces } from '@/src/services/placesApi';
import { findDetailPath, findSourceLabel, safeFindUrl } from '@/src/ui/find';
import { productPagePath } from '@/src/ui/productPage';
import { PRODUCT_CARD_LAYOUT } from '@/src/ui/productCardLayout';
import { placesColumnCount } from '@/src/ui/stashPlaces';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { groupSourceRows, mergeSourceResults, sourcePlaceModel, sourceProductId, sourceProductModel, sourceResultKey,
  type SourceProduct } from '@/src/ui/stashSourceResults';
import { typeStyle } from '@/src/theme/typography';
import type { PlaceSourceVideo, PlaceStashItem } from '@/src/types/placeStash';
import type { Product } from '@/src/mocks/videos';

type SourceState = { owner: string | null; id: string; items: FindSourceResult[]; cursor: string | null;
  source: FindItem | null; places: PlaceStashItem[]; loaded: boolean; loading: boolean; refreshing: boolean;
  more: boolean; error: boolean; moreError: boolean };
const empty = (owner: string | null, id: string): SourceState => ({ owner, id, items: [], cursor: null,
  source: null, places: [], loaded: false, loading: true, refreshing: false, more: false, error: false, moreError: false });
export default function StashSourceScreen() {
  const router = useRouter(), params = useLocalSearchParams<{ sourceId: string }>();
  const id = typeof params.sourceId === 'string' ? params.sourceId : '';
  const { user } = useAuth(), owner = user?.id ?? null, { tokens } = useThemeMode();
  const insets = useSafeAreaInsets(), dimensions = useWindowDimensions(), cart = useCartOptional();
  const contentWidth = Math.min(dimensions.width - insets.left - insets.right, 680);
  const gridWidth = contentWidth - 2 * tokens.space.md;
  const columns = placesColumnCount(gridWidth, dimensions.fontScale);
  const cardWidth = (gridWidth - (columns - 1) * tokens.space.sm) / columns;
  const mediaSize = cardWidth - 2 * PRODUCT_CARD_LAYOUT.relatedInset;
  const [state, setState] = useState<SourceState>(() => empty(null, ''));
  const [shopping, setShopping] = useState<Product | null>(null);
  const [selectedSources, setSelectedSources] = useState<PlaceSourceVideo[] | null>(null);
  const generation = useRef(0), busy = useRef(false), stateRef = useRef(state), ownerRef = useRef(owner);
  stateRef.current = state; ownerRef.current = owner;
  const invalidate = useCallback(() => { generation.current++; busy.current = false; setShopping(null); setSelectedSources(null); }, []);
  const load = useCallback(async (append = false) => {
    if (!owner || !id || busy.current) return;
    const before = stateRef.current, same = before.owner === owner && before.id === id;
    const cursor = append && same ? before.cursor : null;
    if (append && !cursor) return;
    busy.current = true; const token = ++generation.current;
    setState(previous => ({ ...previous, owner, id, loading: !append && !(same && previous.loaded),
      refreshing: !append && same && previous.loaded, more: append,
      error: append ? previous.error : false, moreError: false }));
    try {
      const page = await findApi.sourceResults(id, { cursor: cursor ?? undefined, limit: 50 }, owner);
      if (token !== generation.current || ownerRef.current !== owner) return;
      if (append) {
        if (page.nextCursor === cursor) throw new Error('Source results cursor did not advance');
        setState(previous => ({ ...previous, items: mergeSourceResults(previous.items, page.items),
          cursor: page.nextCursor, more: false, moreError: false }));
      } else {
        const detail = await findApi.detail(id, owner).catch(() => null);
        if (token !== generation.current || ownerRef.current !== owner) return;
        setState({ owner, id, items: page.items, cursor: page.nextCursor, source: detail ?? (same ? before.source : null),
          places: same ? before.places : [], loaded: true, loading: false, refreshing: false, more: false, error: false, moreError: false });
        // Places enrichment is optional. Show source results immediately even when the Stash listing is slow or offline.
        if ((detail?.outcome.savedPlaces ?? page.items.filter(row => row.kind === 'place').length) > 0)
          void fetchAllPlaces(() => token === generation.current && ownerRef.current === owner).then(result => {
            if (token === generation.current && ownerRef.current === owner)
              setState(previous => previous.owner === owner && previous.id === id ? { ...previous, places: result.items } : previous);
          }).catch(() => {});
      }
    } catch {
      if (token === generation.current && ownerRef.current === owner)
        setState(previous => ({ ...previous, loaded: true, loading: false, refreshing: false, more: false,
          error: append ? previous.error : true, moreError: append }));
    } finally { if (token === generation.current) busy.current = false; }
  }, [owner, id]);
  useFocusEffect(useCallback(() => {
    invalidate();
    if (stateRef.current.owner !== owner || stateRef.current.id !== id) setState(empty(owner, id));
    void load();
    return invalidate;
  }, [owner, id, load, invalidate]));

  const visible = state.owner === owner && state.id === id ? state : empty(owner, id);
  const productCount = visible.source?.outcome.savedProducts ?? (visible.cursor ? null : visible.items.filter(row => row.kind === 'product').length);
  const placeCount = visible.source?.outcome.savedPlaces ?? (visible.cursor ? null : visible.items.filter(row => row.kind === 'place').length);
  const rows = useMemo(() => groupSourceRows(visible.items, columns, productCount, placeCount), [columns, placeCount, productCount, visible.items]);
  const remove = (row: FindSourceResult) => Alert.alert('Remove from My Stash?', 'The discovery will remain in Find history.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void (async () => {
      if (!owner || ownerRef.current !== owner) return;
      try {
        if (row.kind === 'place') await findApi.removeResult(id, 'places', row.result.id);
        else if ('candidateKey' in row.result) await findApi.removeSavedSuggestion(id, row.result.sourceProductId, row.result.candidateKey, row.result.identityKey);
        else await findApi.removeResult(id, 'products', row.result.id, row.result.identityKey ?? undefined);
        if (ownerRef.current !== owner) return;
        try { await cart?.refresh(); } catch { /* Source results remain authoritative if optional Cart refresh fails. */ }
        if (ownerRef.current !== owner) return;
        invalidate(); await load();
      } catch { if (ownerRef.current === owner) Alert.alert('Couldn’t remove item', 'Please try again.'); }
    })(); } },
  ]);
  const openProduct = (row: SourceProduct) => {
    const productId = sourceProductId(row);
    router.push((productId ? productPagePath(productId, { contentSourceId: visible.source?.contentSourceId, userImportId: id }) : findDetailPath(id)) as Href);
  };
  const onPlaceSearch = (url: string) => { const safe = safeFindUrl(url); if (safe) void Linking.openURL(safe).catch(() => Alert.alert('Place unavailable', 'Couldn’t open this place right now.')); };
  const candidateTitle = visible.source?.title?.trim();
  const sourceTitle = candidateTitle && !/^stash\/source\/|^\[sourceId\]$/i.test(candidateTitle)
    ? candidateTitle : visible.source ? findSourceLabel(visible.source.sourceType) : 'Saved from this Find';
  const sourceUrl = safeFindUrl(visible.source?.sourceUrl);
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvasSoft, paddingLeft: insets.left, paddingRight: insets.right }}>
    {!owner ? <View style={{ padding: tokens.space.lg }}><Text style={typeStyle(tokens, 'body')}>Sign in to view your saved items.</Text></View> :
    <FlatList data={rows} keyExtractor={row => row.key}
      contentContainerStyle={{ padding: tokens.space.md, paddingBottom: insets.bottom + tokens.space.xl,
        gap: tokens.space.sm, width: '100%', maxWidth: 680, alignSelf: 'center' }}
      onRefresh={() => void load()} refreshing={visible.refreshing}
      onEndReached={() => { if (visible.cursor && !visible.more && !visible.moreError) void load(true); }} onEndReachedThreshold={0.35}
      ListHeaderComponent={<View style={{ gap: tokens.space.xs, paddingBottom: tokens.space.xs }}>
        <Text accessibilityRole='header' numberOfLines={2} style={typeStyle(tokens, 'sectionTitle')}>{sourceTitle}</Text>
        {sourceUrl ? <Text selectable numberOfLines={2} style={typeStyle(tokens, 'tileMeta')}>{sourceUrl}</Text> : null}
        {visible.error && visible.items.length ? <View accessibilityRole='alert' style={{ gap: tokens.space.xs }}><Text style={typeStyle(tokens, 'bodyMuted')}>Couldn’t refresh. Your saved results are still here.</Text><ActionButton label='Try refreshing' variant='quiet' onPress={() => void load()} /></View> : null}
      </View>}
      ListEmptyComponent={visible.loading && !visible.loaded ? <Text style={typeStyle(tokens, 'bodyMuted')}>Loading saved items…</Text>
        : visible.error ? <View accessibilityRole='alert' style={{ gap: tokens.space.sm }}><Text style={typeStyle(tokens, 'bodyMuted')}>Couldn’t load saved items from this Find.</Text><ActionButton label='Retry' onPress={() => void load()} /></View>
          : <Text style={typeStyle(tokens, 'bodyMuted')}>No saved items remain from this Find.</Text>}
      ListFooterComponent={visible.moreError ? <View accessibilityRole='alert' style={{ gap: tokens.space.xs }}><Text style={typeStyle(tokens, 'bodyMuted')}>Couldn’t load more results.</Text><ActionButton label='Try loading more' variant='quiet' onPress={() => void load(true)} /></View>
        : visible.cursor ? <ActionButton label={visible.more ? 'Loading…' : 'Load more results'} disabled={visible.more} onPress={() => void load(true)} variant='quiet' /> : null}
      renderItem={({ item: row }) => row.kind === 'heading'
        ? <Text accessibilityRole='header' style={[typeStyle(tokens, 'sectionTitle'), { marginTop: tokens.space.md }]}>{row.label}{row.count === null ? '' : ` (${row.count})`}</Text>
        : <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space.sm }}>
          {row.items.map(item => <View key={sourceResultKey(item)} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {item.kind === 'product' ? <>
              {(() => { const model = sourceProductModel(item, cart?.items ?? []); return model ? <ProductCard product={model} variant='related' showIndexPrice onPress={() => openProduct(item)} /> : null; })()}
              <Pressable accessibilityRole='button' accessibilityLabel={`Buy now, ${item.result.title}`}
                onPress={() => { const productId = sourceProductId(item); if (productId) setShopping({ id: productId, name: item.result.title, image: item.result.imageUrl ?? '', price: '' }); }}
                style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: tokens.space.xs }}><Text style={typeStyle(tokens, 'link')}>Buy now</Text></Pressable>
            </> : <PlaceCard item={sourcePlaceModel(item, id, visible.places)} onSearch={onPlaceSearch}
              onOpenSource={(source, sources) => setSelectedSources(sources?.length ? sources : [source])} />}
            <Pressable accessibilityRole='button' accessibilityLabel={`Remove ${'title' in item.result ? item.result.title : item.result.name} from My Stash`}
              onPress={() => remove(item)} hitSlop={8} style={({ pressed }) => ({ position: 'absolute',
                top: PRODUCT_CARD_LAYOUT.relatedInset + mediaSize - tokens.space.xs - 32,
                right: PRODUCT_CARD_LAYOUT.relatedInset + tokens.space.xs,
                width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.pill,
                borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.immersive.border,
                backgroundColor: tokens.immersive.controlStrong, zIndex: 2,
                opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
              })}><Ionicons name='trash-outline' size={15} color={tokens.immersive.icon} /></Pressable>
          </View>)}
          {row.items.length < columns ? <View style={{ flex: 1 }} /> : null}
        </View>} />}
    <FeedProductSheet video={null} product={shopping} shoppingProductId={shopping?.id} visible={Boolean(shopping)} measurementSurface='find' onClose={() => setShopping(null)} />
    {selectedSources?.[0] ? <PlaceSourceVideoModal key={selectedSources[0].url} source={selectedSources[0]} sources={selectedSources} onClose={() => setSelectedSources(null)} /> : null}
  </View>;
}
