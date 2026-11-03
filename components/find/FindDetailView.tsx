import React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { FindImage } from './FindImage';
import {PrivateFindPreview} from './PrivateFindImage';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { outlineCardChrome } from '@/src/theme/tokens';
import type { FindScreenDetail, FindItem } from '@/src/services/findClient';
import type { ReviewProduct } from '@/src/services/shareReviewApi';
import { findResultLabel, findSourceLabel, findStatus, safeFindUrl } from '@/src/ui/find';
import { findDetailRows, type FindDetailRow } from '@/src/ui/findDetail';
import { FindIntentEditor } from './FindIntentEditor';

export type FindDetailViewProps = {
  data: FindScreenDetail | null; loading: boolean; refreshing: boolean; error: string | null; actionError: string | null; pending: string | null;
  onRefresh(): void; onOriginal(): void; onStash(segment?: 'places'): void; onProduct(id: string): void;
  onRetry(kind: 'extraction' | 'saving'): void; onRemove(): void;
  onMembership(row: NonNullable<FindDetailRow['membership']>, restore: boolean): void;
  onSaveIntent(value: FindItem['intent']): Promise<boolean>;
  options: ReviewProduct[]; optionsLoaded: boolean; optionsLoading: boolean; optionsError: string | null; onOptions(): void;
  onDecide(sourceId: string, key: string, action: 'save' | 'dismiss'): void;
};
export function FindDetailView(props: FindDetailViewProps) {
  const { tokens } = useThemeMode(), { data, pending } = props;
  if (props.loading && !data) return <View accessibilityLabel="Loading find" style={{ padding: tokens.space.md, gap: tokens.space.md }}><SkeletonBlock height={180} radius={tokens.radius.xxl} /><SkeletonBlock height={88} radius={tokens.radius.md} /><SkeletonBlock height={88} radius={tokens.radius.md} /></View>;
  if (!data) return <View accessibilityRole="alert" style={{ padding: tokens.space.lg, gap: tokens.space.md }}><Text style={typeStyle(tokens,'body')}>{props.error ?? 'This find is unavailable.'}</Text><ActionButton wrapLabel minTouchHeight={48} label="Try refreshing" variant="secondary" onPress={props.onRefresh} /></View>;
  const image = safeFindUrl(data.thumbnailUrl), status = findStatus(data), rows = findDetailRows(data, data.capabilities.suggestions ? props.options : []);
  const header = <View style={{ gap: tokens.space.md }}>
    {data.sourceType==='image'?<PrivateFindPreview key={data.id} id={data.id}/>:image ? <FindImage url={image} cacheKey={data.id} style={{ width: '100%', aspectRatio: 1.8, borderRadius: tokens.radius.xxl }} /> : null}
    <Text style={typeStyle(tokens,'caption')}>{findSourceLabel(data.sourceType)}</Text>
    <Text accessibilityRole="header" style={[typeStyle(tokens,'sectionTitle'), { fontFamily: tokens.fontFamily.bold }]}>{data.title || 'Your captured link'}</Text>
    <Text style={typeStyle(tokens,'body')}>{findResultLabel(data)}</Text>
    <View style={{ ...outlineCardChrome(tokens), padding: tokens.space.md, borderRadius: tokens.radius.xxl, borderWidth: tokens.stroke.thin, gap: tokens.space.sm }}>
      <Text style={[typeStyle(tokens,'body'), { fontFamily: tokens.fontFamily.semibold }]}>{status.label}</Text>
      <Text accessibilityLiveRegion="polite" style={typeStyle(tokens,'bodyMuted')}>{status.message}</Text>
      {data.outcome.canRetryExtraction ? <ActionButton wrapLabel minTouchHeight={48} label="Retry finding" disabled={Boolean(pending)} pending={pending === 'retry:extraction'} onPress={() => props.onRetry('extraction')} /> : null}
      {data.outcome.canRetrySaving ? <ActionButton wrapLabel minTouchHeight={48} label="Retry saving to My Stash" variant="secondary" disabled={Boolean(pending)} pending={pending === 'retry:saving'} onPress={() => props.onRetry('saving')} /> : null}
    </View>
    {props.error || props.actionError ? <View accessibilityRole="alert" style={{ gap: tokens.space.sm }}><Text style={[typeStyle(tokens,'bodyMuted'), { color: tokens.color.danger }]}>{props.actionError ?? props.error}</Text><ActionButton wrapLabel minTouchHeight={48} label="Refresh current status" variant="quiet" onPress={props.onRefresh} /></View> : null}
    {data.sourceType!=='image'?<ActionButton wrapLabel minTouchHeight={48} label="Open original link" leadingIcon="open-outline" variant="secondary" onPress={props.onOriginal} disabled={!safeFindUrl(data.sourceUrl)} />:null}
    <ActionButton wrapLabel minTouchHeight={48} label="Open My Stash" leadingIcon="layers-outline" variant="quiet" onPress={() => props.onStash()} />
    <Text style={typeStyle(tokens,'caption')}>{data.outcome.savedProducts} product{data.outcome.savedProducts === 1 ? '' : 's'} · {data.outcome.savedPlaces} place{data.outcome.savedPlaces === 1 ? '' : 's'} from this find currently in My Stash.</Text>
    {data.capabilities.intent ? <FindIntentEditor key={data.id} intent={data.intent} busy={Boolean(pending)} onSave={props.onSaveIntent} /> : data.intent.note ? <Text style={typeStyle(tokens,'bodyMuted')}>{data.intent.note}</Text> : null}
    <Text accessibilityRole="header" style={typeStyle(tokens,'sectionTitle')}>Products and places</Text>
    <Text style={typeStyle(tokens,'caption')}>Removing an item here removes it from My Stash. Its discovery stays in this find, and you can restore it.</Text>
    {!rows.length ? <Text style={typeStyle(tokens,'bodyMuted')}>{data.outcome.extractionActive ? 'Results will appear as they become available.' : 'No products or places to show. You can still open the original link.'}</Text> : null}
  </View>;
  return <FlatList data={rows} keyExtractor={row => row.key} contentContainerStyle={{ padding: tokens.space.md, paddingBottom: tokens.space.xl, gap: tokens.space.md }}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets refreshing={props.refreshing} onRefresh={props.onRefresh} ListHeaderComponent={header}
    renderItem={({ item: row }) => <View style={{ ...outlineCardChrome(tokens), borderWidth: tokens.stroke.thin, borderRadius: tokens.radius.xxl, padding: tokens.space.md, gap: tokens.space.sm }}>
      <View style={{ flexDirection: 'row', gap: tokens.space.sm, alignItems: 'center' }}>
        {safeFindUrl(row.image) ? <FindImage url={row.image} cacheKey={row.key} style={{ width: 64, height: 72, borderRadius: tokens.radius.md }} /> : <Ionicons name={row.key.startsWith('place:') ? 'location-outline' : 'cube-outline'} size={24} color={tokens.color.textMuted} />}
        <View style={{ flex: 1, minWidth: 0, gap: tokens.space.xs }}><Text style={typeStyle(tokens,'body')}>{row.title}</Text><Text style={typeStyle(tokens,'caption')}>{row.subtitle}</Text></View>
      </View>
      {row.openProductId ? <ActionButton wrapLabel minTouchHeight={48} label="Open product" variant="quiet" onPress={() => props.onProduct(row.openProductId!)} /> : row.key.startsWith('place:') && row.saved ? <ActionButton wrapLabel minTouchHeight={48} label="Open places in My Stash" variant="quiet" onPress={() => props.onStash('places')} /> : null}
      {row.membership ? <ActionButton wrapLabel minTouchHeight={48} label={row.removed ? 'Restore to My Stash' : 'Remove from My Stash'} accessibilityLabel={`${row.removed ? 'Restore' : 'Remove'} ${row.title} ${row.removed ? 'to' : 'from'} My Stash`}
        variant="secondary" pending={pending === row.key} disabled={Boolean(pending)} onPress={() => props.onMembership(row.membership!, Boolean(row.removed))} /> : null}
      {row.candidate ? <View style={{ gap: tokens.space.sm }}><ActionButton wrapLabel minTouchHeight={48} label="Save similar product" pending={pending === row.key} disabled={Boolean(pending)} onPress={() => props.onDecide(row.candidate!.sourceId,row.candidate!.key,'save')} /><ActionButton wrapLabel minTouchHeight={48} label="Dismiss suggestion" variant="quiet" disabled={Boolean(pending)} onPress={() => props.onDecide(row.candidate!.sourceId,row.candidate!.key,'dismiss')} /></View> : null}
    </View>}
    ListFooterComponent={<View style={{ gap: tokens.space.md, marginTop: tokens.space.md }}>
      {data.capabilities.suggestions ? <><ActionButton wrapLabel minTouchHeight={48} label={props.optionsLoaded ? 'Refresh similar options' : 'See similar options'} variant="secondary" pending={props.optionsLoading} disabled={Boolean(pending)} onPress={props.onOptions} />
        {props.optionsLoaded && !rows.some(row => row.candidate) ? <Text style={typeStyle(tokens,'caption')}>No additional similar options are available for this find.</Text> : null}
        {props.optionsError ? <Text accessibilityRole="alert" style={[typeStyle(tokens,'caption'), { color: tokens.color.danger }]}>{props.optionsError}</Text> : null}</> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Remove capture from Find history" accessibilityState={{ disabled: Boolean(pending) }} disabled={Boolean(pending)} onPress={props.onRemove} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center' }}><Text style={[typeStyle(tokens,'caption'), { color: tokens.color.danger }]}>Remove capture from history</Text></Pressable>
    </View>} />;
}
