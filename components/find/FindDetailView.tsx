import { FailureState } from '@/components/status/FailureState';
import React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FindImage } from './FindImage';
import { PlaceImage } from '@/components/place/PlaceImage';
import { FindStatusProgress } from './FindStatusProgress';
import { PrivateFindPreview } from './PrivateFindImage';
import { MeasuredFindResult } from './MeasuredFindResult';
import { FindIntentEditor } from './FindIntentEditor';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { outlineCardChrome } from '@/src/theme/tokens';
import type { FindScreenDetail, FindItem } from '@/src/services/findClient';
import type { ReviewProduct } from '@/src/services/shareReviewApi';
import { findSourceLabel, safeFindUrl } from '@/src/ui/find';
import { canRetryFindSaving, findDetailRows, findDetailStatus, findSuggestionCounts, type FindDetailRow } from '@/src/ui/findDetail';

export type FindDetailViewProps = {
  data: FindScreenDetail | null; loading: boolean; refreshing: boolean; error: string | null; actionError: string | null; pending: string | null;
  onRefresh(): void; onOriginal(): void; onStash(segment?: 'places'): void; onProduct(id: string): void;
  onShop(row: FindDetailRow): void; onPlace(row: FindDetailRow): void;
  onRetry(kind: 'extraction' | 'saving'): void; onRemove(): void;
  onMembership(row: NonNullable<FindDetailRow['membership']>, restore: boolean): void;
  onSaveIntent(value: FindItem['intent']): Promise<boolean>;
  options: ReviewProduct[]; optionsLoaded: boolean;
  onDecide(sourceId: string, key: string, action: 'save' | 'dismiss'): void;
};
export function FindDetailView(props: FindDetailViewProps) {
  const { tokens } = useThemeMode(), { data, pending } = props;
  if (props.loading && !data) return <View accessibilityLabel="Loading find" style={{ padding: tokens.space.md, gap: tokens.space.md }}><SkeletonBlock height={112} radius={tokens.radius.lg} /><SkeletonBlock height={80} radius={tokens.radius.md} /><SkeletonBlock height={88} radius={tokens.radius.md} /></View>;
  if (!data) return <FailureState error={props.error} message="This find is unavailable." onRetry={props.onRefresh} fill />;

  const image = safeFindUrl(data.thumbnailUrl), status = findDetailStatus(data), rows = findDetailRows(data, data.capabilities.suggestions ? props.options : []);
  const statusColor = status.tone === 'error' ? tokens.color.danger : status.tone === 'success' ? tokens.color.success : status.tone === 'empty' ? tokens.color.textMuted : tokens.color.warning;
  const progressActive = data.outcome.extractionActive || data.outcome.stashSync === 'pending' || status.tone === 'queued';
  const sourceInfo = <View style={{gap:tokens.space.xxs}}><Text accessibilityRole="header" numberOfLines={2} style={typeStyle(tokens,'sectionTitle')}>{data.title || (data.sourceType==='image'?'Your image':'Your captured link')}</Text><Text style={typeStyle(tokens,'caption')}>{data.sourceType==='image'?'Image':findSourceLabel(data.sourceType)}{Number.isNaN(Date.parse(data.createdAt))?'':` · ${new Date(data.createdAt).toLocaleDateString()}`}</Text></View>;
  const header = <View style={{ gap: tokens.space.md }}>
    <View style={{paddingVertical:tokens.space.xs}}>
      {data.sourceType==='image' ? <PrivateFindPreview key={data.id} id={data.id} compact>{sourceInfo}</PrivateFindPreview> : <View style={{flexDirection:'row',gap:tokens.space.sm,alignItems:'flex-start'}}>
        {image ? <FindImage url={image} cacheKey={data.id} style={{width:96,height:96,borderRadius:tokens.radius.md}} /> : <View style={{width:96,height:96,borderRadius:tokens.radius.md,backgroundColor:tokens.color.surfaceSubtle,alignItems:'center',justifyContent:'center'}}><Ionicons name="film-outline" size={26} color={tokens.color.textMuted}/></View>}
        <View style={{flex:1,minWidth:0,alignItems:'flex-start',gap:tokens.space.xxs}}>{sourceInfo}{safeFindUrl(data.sourceUrl) ? <Pressable accessibilityRole="link" accessibilityLabel="Open original link" onPress={props.onOriginal} style={{minHeight:48,flexDirection:'row',alignItems:'center',gap:tokens.space.xxs}}><Ionicons name="open-outline" size={17} color={tokens.color.text}/><Text style={[typeStyle(tokens,'caption'),{color:tokens.color.text,fontFamily:tokens.fontFamily.semibold}]}>View original</Text></Pressable> : null}</View>
      </View>}
    </View>
    <View accessibilityLiveRegion="polite" style={{borderWidth:tokens.stroke.thin,borderColor:statusColor,borderRadius:tokens.radius.lg,padding:tokens.space.sm,gap:tokens.space.sm}}>
      <View style={{flexDirection:'row',gap:tokens.space.sm,alignItems:'flex-start'}}>
      <Ionicons name={status.icon} size={22} color={statusColor}/><View style={{flex:1,gap:tokens.space.xxs}}><Text style={typeStyle(tokens,'sectionTitle')}>{status.label}</Text><Text style={typeStyle(tokens,'caption')}>{status.message}</Text>
        {canRetryFindSaving(data) ? <Pressable accessibilityRole="button" accessibilityLabel="Retry saving to My Stash" accessibilityState={{disabled:Boolean(pending),busy:pending==='retry:saving'}} disabled={Boolean(pending)} onPress={()=>props.onRetry('saving')} style={{minHeight:48,alignSelf:'flex-start',justifyContent:'center'}}><Text style={[typeStyle(tokens,'tileTitle'),{color:tokens.color.text}]}>{pending==='retry:saving'?'Retrying…':'Retry saving'}</Text></Pressable>:null}
      </View></View>
      <FindStatusProgress color={statusColor} active={progressActive} label={status.label} />
    </View>
    {data.outcome.canRetryExtraction ? <ActionButton wrapLabel minTouchHeight={48} label="Retry finding" disabled={Boolean(pending)} pending={pending === 'retry:extraction'} onPress={() => props.onRetry('extraction')} /> : null}
    {props.error || props.actionError ? <FailureState error={props.actionError ?? props.error} variant="inline" onRetry={props.onRefresh} /> : null}
    <Text accessibilityRole="header" style={typeStyle(tokens,'sectionTitle')}>Your finds</Text>
    {data.products.some(p=>p.matchKind==='possible') ? <Text style={typeStyle(tokens,'caption')}>{findSuggestionCounts(data,props.options).confirmed} confirmed products · {findSuggestionCounts(data,props.options).possible} possible matches{props.optionsLoaded ? ` · ${findSuggestionCounts(data,props.options).styles} similar styles` : ''}{findSuggestionCounts(data,props.options).selected ? ` · ${findSuggestionCounts(data,props.options).selected} saved suggestions` : ''}</Text> : null}
    {!rows.length ? <Text style={typeStyle(tokens,'bodyMuted')}>{data.outcome.extractionActive ? 'Results will appear as they become available.' : 'No products or places to show.'}</Text> : null}
  </View>;
  return <FlatList data={rows} keyExtractor={row => row.key} contentContainerStyle={{ padding: tokens.space.md, paddingBottom: tokens.space.xl, gap: tokens.space.sm }}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets refreshing={props.refreshing} onRefresh={props.onRefresh} ListHeaderComponent={header}
    renderItem={({ item: row }) => {
      const content=(thumbnail:React.ReactNode,attribution?:React.ReactNode)=><>{thumbnail}
      <View style={{flex:1,minWidth:0,alignItems:'flex-start'}}>{row.openProductId ? <Pressable accessibilityRole="button" accessibilityLabel={`View product ${row.title}`} onPress={()=>props.onProduct(row.openProductId!)} style={{alignSelf:'stretch'}}><Text numberOfLines={2} style={typeStyle(tokens,'tileTitle')}>{row.title}</Text></Pressable> : <Text numberOfLines={2} style={typeStyle(tokens,'tileTitle')}>{row.title}</Text>}{row.matchLabel ? <Text style={typeStyle(tokens,'caption')}>{row.matchLabel}</Text> : null}<Text style={typeStyle(tokens,'caption')}>{row.subtitle}</Text>{attribution}
        {row.openProductId ? <Pressable accessibilityRole="button" accessibilityLabel={`Buy now, ${row.title}`} onPress={()=>props.onShop(row)} style={{minHeight:44,justifyContent:'center',alignSelf:'flex-start'}}><View style={{flexDirection:'row',alignItems:'center',gap:tokens.space.xxs,paddingHorizontal:tokens.space.sm,paddingVertical:tokens.space.xs / 2,backgroundColor:tokens.color.primary,borderRadius:tokens.radius.md}}><Ionicons name="bag-handle-outline" size={15} color={tokens.color.onPrimary}/><Text style={[typeStyle(tokens,'tileTitle'),{color:tokens.color.onPrimary}]}>Buy now</Text></View></Pressable> : row.key.startsWith('place:') && row.saved ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${row.title} on Google`} onPress={()=>props.onPlace(row)} style={{minHeight:44,justifyContent:'center',alignSelf:'flex-start'}}><View style={{flexDirection:'row',alignItems:'center',gap:tokens.space.xxs,paddingHorizontal:tokens.space.sm,paddingVertical:tokens.space.xs / 2,backgroundColor:tokens.color.primary,borderRadius:tokens.radius.md}}><Ionicons name="open-outline" size={15} color={tokens.color.onPrimary}/><Text style={[typeStyle(tokens,'tileTitle'),{color:tokens.color.onPrimary}]}>View on Google</Text></View></Pressable> : null}
        {row.removed && row.membership ? <Pressable accessibilityRole="button" accessibilityLabel={`Restore ${row.title} to My Stash`} disabled={Boolean(pending)} onPress={()=>props.onMembership(row.membership!,true)} style={{minHeight:48,justifyContent:'center'}}><Text style={[typeStyle(tokens,'tileTitle'),{color:tokens.color.text}]}>Restore to My Stash</Text></Pressable>:null}
        {row.candidate ? <View><ActionButton wrapLabel minTouchHeight={48} label={row.matchLabel==='Possible match'?'Save possible match':row.matchLabel==='Similar styles'?'Save similar style':'Save similar product'} pending={pending===row.key} disabled={Boolean(pending)} onPress={()=>props.onDecide(row.candidate!.sourceId,row.candidate!.key,'save')}/><ActionButton wrapLabel minTouchHeight={48} label="Dismiss suggestion" variant="quiet" disabled={Boolean(pending)} onPress={()=>props.onDecide(row.candidate!.sourceId,row.candidate!.key,'dismiss')}/></View>:null}
      </View>
      {row.membership && !row.removed ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${row.title} from My Stash`} accessibilityState={{disabled:Boolean(pending)}} disabled={Boolean(pending)} onPress={()=>props.onMembership(row.membership!,false)} style={{width:44,height:44,alignItems:'center',justifyContent:'center',alignSelf:'flex-start'}}><Ionicons name="trash-outline" size={18} color={tokens.color.textMuted}/></Pressable>:null}
</>;
      const thumbnail=(() => { const thumbnail = safeFindUrl(row.image) ? <FindImage url={row.image} cacheKey={row.key} style={{width:64,height:64,borderRadius:tokens.radius.md}} /> : <View style={{width:64,height:64,borderRadius:tokens.radius.md,backgroundColor:tokens.color.surfaceSubtle,alignItems:'center',justifyContent:'center'}}><Ionicons name={row.key.startsWith('place:')?'location-outline':'cube-outline'} size={24} color={tokens.color.textMuted}/></View>; return row.openProductId ? <Pressable accessibilityRole="button" accessibilityLabel={`View product ${row.title} image`} onPress={()=>props.onProduct(row.openProductId!)}>{thumbnail}</Pressable> : thumbnail; })();
      return <MeasuredFindResult row={row} style={{ ...outlineCardChrome(tokens), borderWidth: tokens.stroke.thin, borderRadius: tokens.radius.lg, padding: tokens.space.sm, flexDirection:'row',gap:tokens.space.sm,alignItems:'center' }}>
        {row.key.startsWith('place:') ? <PlaceImage placeId={row.placeId??null} name={row.title} importId={data.id} width={128} style={{width:64,height:64,borderRadius:tokens.radius.md}}>
          {({image,attribution})=>content(image,attribution)}
        </PlaceImage> : content(thumbnail)}
      </MeasuredFindResult>;
    }}
    ListFooterComponent={<View style={{gap:tokens.space.md,marginTop:tokens.space.md}}>
      {data.capabilities.intent ? <FindIntentEditor key={data.id} intent={data.intent} busy={Boolean(pending)} onSave={props.onSaveIntent} /> : data.intent.note ? <Text style={typeStyle(tokens,'bodyMuted')}>{data.intent.note}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Remove capture from Find history" accessibilityState={{disabled:Boolean(pending)}} disabled={Boolean(pending)} onPress={props.onRemove} style={{minHeight:48,justifyContent:'center',alignItems:'center'}}><Text style={[typeStyle(tokens,'caption'),{color:tokens.color.danger}]}>Remove capture from history</Text></Pressable>
    </View>} />;
}
