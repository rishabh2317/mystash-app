import React from 'react';
import { FlatList, Pressable, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { FIND_COPY, type FindViewFilter } from '@/src/ui/find';
import type { FindHistoryState } from '@/src/state/findHistoryController';
import { FindCard } from './FindCard';
export type FindDashboardProps = {
  state: FindHistoryState; signedIn: boolean; authLoading?: boolean; onFilter(filter: FindViewFilter): void;
  onOpen(id: string): void; onCapture(): void; onSignIn(): void; onRefresh(): void; onLoadMore(): void; pending?: React.ReactNode;
};
export function FindDashboard({ state, signedIn, authLoading, onFilter, onOpen, onCapture, onSignIn, onRefresh, onLoadMore, pending }: FindDashboardProps) {
  const { tokens } = useThemeMode(), { width, fontScale } = useWindowDimensions();
  const loading = Boolean(authLoading || (signedIn && !state.loaded));
  const featured = state.filter === 'completed' ? state.items.slice(0,2) : [];
  const items = featured.length ? state.items.slice(featured.length) : state.items;
  const filters: { id: FindViewFilter; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; count: number | null }[] = [
    { id: 'processing', label: 'Processing', icon: 'ellipse-outline', count: state.counts?.processing ?? null },
    { id: 'completed', label: 'Completed', icon: 'layers-outline', count: state.counts?.completed ?? null },
  ];
  if ((state.counts?.attention ?? 0)>0 || state.filter === 'attention') filters.push({ id: 'attention', label: 'Needs Attention', icon: 'alert-circle-outline', count: state.counts?.attention ?? null });
  const title = state.filter === 'completed' ? FIND_COPY.recent : state.filter === 'processing' ? 'Processing' : state.filter === 'attention' ? 'Needs Attention' : 'All captures';
  const header = <View style={{ gap: tokens.space.lg }}>
    <View style={{ gap: tokens.space.sm }}>
      <Text accessibilityRole="header" style={{ ...typeStyle(tokens, 'identityTitle'), fontSize: tokens.fontSize.headline, lineHeight: tokens.lineHeight.headline, fontFamily: tokens.fontFamily.bold }}>{FIND_COPY.title}</Text>
      <Text style={typeStyle(tokens, 'bodyMuted')}>{FIND_COPY.subtitle}</Text>
      <Text style={typeStyle(tokens, 'caption')}>{FIND_COPY.automatic}</Text>
    </View>
    {signedIn ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm }}>
      {filters.map(filter => <Pressable key={filter.id} onPress={() => onFilter(filter.id)} accessibilityRole="button"
        accessibilityLabel={`${filter.label}, ${filter.count === null ? 'loading' : `${filter.count} finds`}`} accessibilityState={{ selected: state.filter === filter.id }}
        style={{ maxWidth: '100%', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs, paddingHorizontal: tokens.space.md, paddingVertical: tokens.space.sm,
          borderRadius: tokens.radius.pill, borderWidth: tokens.stroke.thin, borderColor: state.filter === filter.id ? tokens.color.primary : tokens.color.border,
          backgroundColor: state.filter === filter.id ? tokens.color.primarySurface : tokens.color.surface }}>
        <Ionicons name={filter.icon} size={18} color={state.filter === filter.id ? tokens.color.onPrimarySurface : tokens.color.text} />
        <Text style={[typeStyle(tokens, 'caption'), { flexShrink: 1, color: state.filter === filter.id ? tokens.color.onPrimarySurface : tokens.color.text }]}>{filter.label} {filter.count ?? '—'}</Text>
      </Pressable>)}
    </View> : null}
    {pending}
    {state.error && signedIn ? <View accessibilityRole="alert" style={{ gap: tokens.space.sm }}>
      <Text style={[typeStyle(tokens, 'bodyMuted'), { color: tokens.color.danger }]}>{state.error}</Text>
      <ActionButton wrapLabel minTouchHeight={48} label="Try refreshing" variant="quiet" onPress={onRefresh} />
    </View> : null}
    {loading ? <View accessibilityLabel="Loading your Finds" style={{ gap: tokens.space.md }}>
      {[1,2,3].map(key => <SkeletonBlock key={key} height={100} radius={tokens.radius.xxl} />)}
    </View> : !signedIn ? <View style={{ gap: tokens.space.md, paddingVertical: tokens.space.lg }}>
      <Text style={typeStyle(tokens, 'sectionTitle')}>Keep what catches your eye</Text>
      <Text style={typeStyle(tokens, 'bodyMuted')}>Sign in to capture links, follow your Finds, and open their products and places.</Text>
      <ActionButton wrapLabel minTouchHeight={48} label="Sign in to Find" onPress={onSignIn} />
    </View> : <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
        <Text accessibilityRole="header" style={[typeStyle(tokens, 'sectionTitle'), { flex: 1 }]}>{title}</Text>
        {state.filter !== 'all' ? <Pressable onPress={() => onFilter('all')} accessibilityRole="button" style={{ minHeight: 48, justifyContent: 'center' }}><Text style={typeStyle(tokens, 'link')}>All captures</Text></Pressable> : null}
      </View>
      {featured.length ? <View style={{ flexDirection: width < 360 || fontScale > 1.4 ? 'column' : 'row', gap: tokens.space.md }}>
        {featured.map(item => <View key={item.id} style={{ flex: 1, minWidth: 0 }}><FindCard item={item} featured onPress={() => onOpen(item.id)} /></View>)}
      </View> : null}
      {featured.length && items.length ? <Text accessibilityRole="header" style={typeStyle(tokens, 'sectionTitle')}>Earlier finds</Text> : null}
      {!state.items.length && !state.error ? <View style={{ gap: tokens.space.md, paddingVertical: tokens.space.lg }}>
        <Ionicons name="sparkles-outline" size={32} color={tokens.color.primary} />
        <Text style={typeStyle(tokens, 'sectionTitle')}>{!state.counts?.all ? 'Your next find starts here' : state.filter === 'completed' ? 'Nothing completed yet' : `No ${state.filter === 'attention' ? 'finds need attention' : state.filter === 'processing' ? 'finds processing right now' : 'captures yet'}`}</Text>
        <Text style={typeStyle(tokens, 'bodyMuted')}>{!state.counts?.all ? 'Paste a Reel, Short, or web link. We’ll find products and places in the background.' : 'Your captures stay here as they progress. Pull down to refresh.'}</Text>
        {state.filter === 'completed' && (state.counts?.processing ?? 0)>0 ? <ActionButton wrapLabel minTouchHeight={48} label="View processing Finds" variant="secondary" onPress={() => onFilter('processing')} /> : null}
        {state.filter === 'completed' && (state.counts?.attention ?? 0)>0 ? <ActionButton wrapLabel minTouchHeight={48} label="View Finds needing attention" variant="secondary" onPress={() => onFilter('attention')} /> : null}
        <ActionButton wrapLabel minTouchHeight={48} label="Paste a URL" onPress={onCapture} />
      </View> : null}
    </>}
  </View>;
  return <FlatList data={signedIn && !loading ? items : []} keyExtractor={item => item.id} ListHeaderComponent={header}
    contentContainerStyle={{ padding: tokens.space.md, paddingBottom: tokens.space.xl, gap: tokens.space.md }}
    refreshing={state.refreshing} onRefresh={onRefresh} onEndReached={() => { if (state.cursor && !state.moreError && !state.loadingMore) onLoadMore(); }} onEndReachedThreshold={0.35}
    ListFooterComponent={state.moreError ? <View accessibilityRole="alert" style={{ gap: tokens.space.sm }}><Text style={typeStyle(tokens, 'caption')}>{state.moreError}</Text><ActionButton wrapLabel minTouchHeight={48} label="Try loading more" variant="quiet" onPress={onLoadMore} /></View>
      : state.loadingMore ? <SkeletonBlock height={80} radius={tokens.radius.xxl} /> : state.cursor && signedIn ? <ActionButton wrapLabel minTouchHeight={48} label="Load more Finds" variant="quiet" onPress={onLoadMore} /> : null}
    renderItem={({ item }) => <FindCard item={item} onPress={() => onOpen(item.id)} />} />;
}
