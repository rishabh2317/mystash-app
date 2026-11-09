import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { BackHandler, FlatList, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { StashFilterBar } from '@/components/commerce/StashFilterBar';
import { activeStashFilter, filterRecentStash, stashFilterOptions, STASH_FILTER_COPY } from '@/src/ui/stashFilters';
import { normalizedPlaceCategory } from '@/src/ui/placeCategories';
import { StashCategoryCard } from '@/components/commerce/StashCategoryCard';
import { StashSourceRail } from '@/components/commerce/StashSourceRail';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { PlaceSourceVideo, PlaceStashItem } from '@/src/types/placeStash';
import { buildPlacesHome, placesColumnCount, STASH_PLACES_COPY, placeStashItemKey, type PlaceCategoryShelf } from '@/src/ui/stashPlaces';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';
import { PlaceCard } from './PlaceCard';
import { PlaceCardSkeleton } from './PlaceCardSkeleton';
import { PlaceSourceVideoModal } from './PlaceSourceVideoModal';

type Props = {
  owner: string;
  onOpenFindSource: (id: string) => void;
  items: PlaceStashItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  refreshing: boolean;
  bottomInset: number;
  onRefresh: () => void;
  onRetry: () => void;
  onSearch: (url: string) => void;
};
type ShelfRow = { kind: 'categories'; key: string; items: PlaceCategoryShelf[] }
  | { kind: 'sources'; key: string }
  | { kind: 'places'; key: string; items: PlaceStashItem[] }
  | { kind: 'heading'; key: string; title: string }
  | { kind: 'filters'; key: string };

/** One virtualized shelf surface for resolved and unverified entries on Android/iOS. */
export function StashPlacesContent({ owner,onOpenFindSource,items, status, refreshing, bottomInset, onRefresh, onRetry, onSearch }: Props) {
  const { tokens } = useThemeMode();
  const dimensions = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(dimensions.width);
  const columns = placesColumnCount(Math.min(contentWidth, dimensions.width), dimensions.fontScale);
  const home = useMemo(() => buildPlacesHome(items), [items]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const category = home.categories.find(shelf => shelf.key === selectedCategory);
  useEffect(() => {
    if (status === 'ready' && selectedCategory && !category) setSelectedCategory(null);
  }, [category, selectedCategory, status]);
  useFocusEffect(useCallback(() => {
    if (!category) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { setSelectedCategory(null); return true; });
    return () => back.remove();
  }, [category]));
  const [recentFilter, setRecentFilter] = useState<string | null>(null);
  const filters = useMemo(() => stashFilterOptions(home.categories), [home.categories]);
  const activeFilter = activeStashFilter(filters, recentFilter);
  const recentItems = useMemo(() => filterRecentStash(home.items, activeFilter,
    item => normalizedPlaceCategory(item.category).key), [activeFilter, home.items]);
  const [selectedSources, setSelectedSources] = useState<PlaceSourceVideo[] | null>(null);
  const selectedSource = selectedSources?.[0];
  const openSource = (source: PlaceSourceVideo, sources?: PlaceSourceVideo[]) => setSelectedSources(sources?.length ? sources : [source]);
  const initialLoading = home.count === 0 && (status === 'loading' || status === 'idle');
  const failed = status === 'error';
  const count = category?.count ?? home.count;
  const countLabel = count === 1 ? '1 place' : `${count} places`;
  const rows = useMemo(() => {
    const result: ShelfRow[] = [];
    if (category) {
      for (let i = 0; i < category.items.length; i += columns) {
        const items = category.items.slice(i, i + columns);
        result.push({ kind: 'places', key: `category:${items.map(placeStashItemKey).join('|')}`, items });
      }
    } else {
      if(home.count) result.push({kind:'sources',key:'find-sources'});
      if (home.count) {
        result.push({ kind: 'heading', key: 'recent', title: STASH_FILTER_COPY.recentlyStashed });
        result.push({ kind: 'filters', key: 'recent-filters' });
      }
      for (let i = 0; i < recentItems.length; i += columns) {
        const items = recentItems.slice(i, i + columns);
        result.push({ kind: 'places', key: `recent:${items.map(placeStashItemKey).join('|')}`, items });
      }
    }
    return result;
  }, [category, columns, home, recentItems]);

  const notice = (cached: boolean) => (
    <View accessibilityLiveRegion="polite" style={[styles.notice, outlineCardChrome(tokens),
      { borderRadius: tokens.radius.lg, padding: tokens.space.md, gap: tokens.space.sm }]}>
      <Text accessibilityRole="header" style={typeStyle(tokens, 'sectionTitle')}>
        {cached ? STASH_PLACES_COPY.refreshError : STASH_PLACES_COPY.loadError}
      </Text>
      <Text style={typeStyle(tokens, 'bodyMuted')}>{cached ? STASH_PLACES_COPY.refreshErrorHint : STASH_PLACES_COPY.loadErrorHint}</Text>
      <ActionButton label={STASH_PLACES_COPY.retry} onPress={onRetry} variant="secondary" pending={refreshing} />
    </View>
  );
  const header = category ? <View style={{ paddingBottom: tokens.space.sm, gap: tokens.space.xs }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to all places"
      onPress={() => setSelectedCategory(null)} style={{ minHeight: FEED_MIN_HIT_TARGET, flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs }}>
      <Ionicons name="chevron-back-outline" size={16} color={tokens.color.primary} />
      <Text style={typeStyle(tokens, 'link')}>All places</Text>
    </Pressable>
    <View style={styles.titleRow}>
      <Text accessibilityRole="header" style={typeStyle(tokens, 'sectionTitle')}>{category.title}</Text>
      <Text style={typeStyle(tokens, 'tileMeta')}>{countLabel}</Text>
    </View>
    {failed && home.count > 0 ? notice(true) : null}
  </View> : failed && home.count > 0 ? notice(true) : null;
  const empty = initialLoading ? <View accessible accessibilityLabel="Loading places" accessibilityRole="progressbar"
    accessibilityState={{ busy: true }} style={{ flexDirection: 'row', gap: tokens.space.sm }}>
    {Array.from({ length: columns }, (_, index) => <View key={index} style={styles.cell}><PlaceCardSkeleton /></View>)}
  </View> : failed ? notice(false) : <View style={[styles.empty, outlineCardChrome(tokens), {
    padding: tokens.space.lg, borderRadius: tokens.radius.lg, gap: tokens.space.sm,
  }]}>
    <Ionicons accessible={false} name="location-outline" size={28} color={tokens.color.textMuted} />
    <Text accessibilityRole="header" style={typeStyle(tokens, 'sectionTitle')}>{STASH_PLACES_COPY.empty}</Text>
    <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>{STASH_PLACES_COPY.emptyHint}</Text>
  </View>;

  return <>
    <FlatList
      key={category?.key ?? 'home'}
      style={styles.list}
      onLayout={event => setContentWidth(event.nativeEvent.layout.width)}
      data={rows}
      keyExtractor={row => row.key}
      renderItem={({ item: row }) => row.kind === 'heading'
        ? <View style={[styles.titleRow, { marginTop: tokens.space.xs, gap: tokens.space.sm }]}>
          <Text accessibilityRole="header" style={[typeStyle(tokens, 'sectionTitle'), { flexShrink: 1 }]}>{row.title}</Text>
          <Text style={[typeStyle(tokens, 'tileMeta'), { flexShrink: 0 }]}>{countLabel}</Text>
        </View>
        : row.kind === 'filters'
          ? <StashFilterBar options={filters} selected={activeFilter} onSelect={setRecentFilter} accessibilityLabel={STASH_FILTER_COPY.places} />
        : row.kind === 'sources' ? <StashSourceRail owner={owner} kind="place" revision={items.map(item=>item.saveId??item.id).join('|')} onOpen={onOpenFindSource}
          fallback={<View style={{flexDirection:'row',gap:tokens.space.sm}}>{home.categories.slice(0,columns).map(shelf=><StashCategoryCard key={shelf.key} category={shelf} placeholder="place" metaLabel={shelf.count===1?'1 place':`${shelf.count} places`} onPress={next=>setSelectedCategory(next.key)}/>)}</View>}/>
        : <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space.sm }}>
          {row.kind === 'categories' ? row.items.map(shelf => <StashCategoryCard key={shelf.key} category={shelf}
            placeholder="place" metaLabel={shelf.count === 1 ? '1 place' : `${shelf.count} places`}
            onPress={next => setSelectedCategory(next.key)} />)
            : row.items.map(item => <View key={placeStashItemKey(item)} style={styles.cell}>
              <PlaceCard item={item} onSearch={onSearch} onOpenSource={openSource} />
            </View>)}
          {row.items.length < columns ? <View style={styles.cell} /> : null}
        </View>}
      ItemSeparatorComponent={() => <View style={{ height: tokens.space.sm }} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={[styles.content, { paddingHorizontal: tokens.space.md, paddingBottom: bottomInset + tokens.space.lg }]}
      showsVerticalScrollIndicator={false} alwaysBounceVertical overScrollMode="always"
      initialNumToRender={8} maxToRenderPerBatch={4} windowSize={5}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.color.primary} colors={[tokens.color.primary]} />}
    />
    {selectedSource ? <PlaceSourceVideoModal key={selectedSource.url} source={selectedSource} sources={selectedSources ?? undefined} onClose={() => setSelectedSources(null)} /> : null}
  </>;
}
const styles = StyleSheet.create({
  list: { flex: 1 }, cell: { flex: 1, minWidth: 0 },
  content: { flexGrow: 1, width: '100%', maxWidth: 680, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  notice: { borderWidth: StyleSheet.hairlineWidth },
  empty: { borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
});
