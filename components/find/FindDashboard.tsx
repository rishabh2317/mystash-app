import { IllustratedEmptyState } from '@/components/status/IllustratedEmptyState';
import { EMPTY_STATES } from '@/src/ui/emptyStates';
import { FailureState } from '@/components/status/FailureState';
import React from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { FindViewFilter } from '@/src/ui/find';
import type { FindItem, FindSourceFilter } from '@/src/services/findClient';
import type { FindHistoryState } from '@/src/state/findHistoryController';
import { FindCard } from './FindCard';
import { FindActivity } from './FindActivity';
import { FindFilterBar, type FindFilter } from './FindFilterBar';
export type FindDashboardProps = {
  state: FindHistoryState; activity:FindItem|null; activityOwner:string|null; activityBusy:boolean; activityError:string|null; onRetryActivity(kind:'extraction'|'saving'):void;
  signedIn: boolean; authLoading?: boolean; onFilter(filter: FindViewFilter): void; onSource(source: FindSourceFilter):void;
  onOpen(id: string): void; onCapture(): void; onSignIn(): void; onRefresh(): void; onLoadMore(): void; onExplore?: () => void;
};
export function FindDashboard({ state,activity,activityOwner,activityBusy,activityError,onRetryActivity,signedIn,authLoading,onFilter,onSource,onOpen,onCapture,onSignIn,onRefresh,onLoadMore,onExplore }: FindDashboardProps) {
  const { tokens } = useThemeMode();
  const source=state.source;
  const loading=Boolean(authLoading || (signedIn && !state.loaded));
  const items=state.items;
  const filters:FindFilter[]=[{id:'processing',label:'Processing',icon:'ellipse-outline',count:state.counts?.processing??null},{id:'completed',label:'Completed',icon:'layers-outline',count:state.counts?.completed??null},
    {id:'attention',label:'Needs Attention',icon:'alert-circle-outline',count:state.counts?.attention??null}];
  const sources: {id:FindSourceFilter;label:string}[]=[{id:'all',label:'All'},{id:'image',label:'Images'},{id:'youtube',label:'YouTube'},{id:'instagram',label:'Instagram'},{id:'web',label:'Web'}];
  const header=<View style={{gap:tokens.space.md}}>
    {signedIn&&activity?<View style={{gap:tokens.space.sm}}><Text accessibilityRole="header" style={typeStyle(tokens,'sectionTitle')}>Your Activity</Text><FindActivity key={`${activityOwner}:${activity.id}`} owner={activityOwner} item={activity} onOpen={()=>onOpen(activity.id)} onRetry={onRetryActivity} busy={activityBusy} error={activityError}/></View>:null}
    {signedIn?<View style={{gap:tokens.space.xs}}><View style={{flexDirection:'row',alignItems:'center'}}><Text accessibilityRole="header" style={[typeStyle(tokens,'sectionTitle'),{flex:1}]}>All Finds</Text>{state.filter!=='all'?<Pressable accessibilityRole="button" onPress={()=>onFilter('all')} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'link')}>All captures</Text></Pressable>:null}</View>
      <FindFilterBar filters={filters} selected={state.filter} onSelect={onFilter}/>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Filter finds by source" contentContainerStyle={{gap:tokens.space.xs}}>{sources.map(option=><Pressable key={option.id} accessibilityRole="button" accessibilityState={{selected:source===option.id}} accessibilityLabel={option.label} onPress={()=>onSource(option.id)} style={{minHeight:44,justifyContent:'center'}}><View style={{paddingHorizontal:tokens.space.sm,paddingVertical:tokens.space.xxs,borderRadius:tokens.radius.pill,borderWidth:tokens.stroke.thin,borderColor:tokens.color.border,backgroundColor:source===option.id?tokens.color.primarySurface:tokens.color.surface}}><Text style={[typeStyle(tokens,'tileMeta'),{color:source===option.id?tokens.color.onPrimarySurface:tokens.color.text}]}>{option.label}</Text></View></Pressable>)}</ScrollView>
    </View>:null}
    {state.error&&signedIn?<FailureState error={state.error} variant="inline" onRetry={onRefresh}/>:null}
    {loading?<View accessibilityLabel="Loading your Finds" style={{gap:tokens.space.md}}>{[1,2,3].map(key=><SkeletonBlock key={key} height={100} radius={tokens.radius.xxl}/>)}</View>:!signedIn?<IllustratedEmptyState {...EMPTY_STATES.find} onAction={onSignIn} onSecondaryAction={onExplore}/>:<>
      {!items.length&&!state.error?<View style={{gap:tokens.space.sm,padding:tokens.space.md,borderRadius:tokens.radius.lg,backgroundColor:tokens.color.surfaceSubtle}}><Text style={typeStyle(tokens,'sectionTitle')}>{source!=='all'?'No finds from this source':!state.counts?.all?'Your next find starts here':'No finds in this view'}</Text><Text style={typeStyle(tokens,'bodyMuted')}>{!state.counts?.all?'Paste a Reel, Short, or web link. We’ll find products and places in the background.':'Pull down to refresh.'}</Text>{!state.counts?.all&&source==='all'?<ActionButton wrapLabel minTouchHeight={48} label="Paste a URL" onPress={onCapture}/>:null}</View>:null}
    </>}
  </View>;
  return <FlatList style={{flex:1}} data={signedIn&&!loading?items:[]} keyExtractor={item=>item.id} ListHeaderComponent={header} contentContainerStyle={{flexGrow:1,justifyContent:!signedIn&&!loading?'center':undefined,padding:tokens.space.md,paddingBottom:tokens.space.xl,gap:tokens.space.sm}} refreshing={state.refreshing} onRefresh={onRefresh} onEndReached={()=>{if(state.cursor&&!state.moreError&&!state.loadingMore)onLoadMore();}} onEndReachedThreshold={0.35}
    ListFooterComponent={state.moreError?<FailureState error={state.moreError} variant="inline" onRetry={onLoadMore}/>:state.loadingMore?<SkeletonBlock height={80} radius={tokens.radius.xxl}/>:state.cursor&&signedIn?<ActionButton wrapLabel minTouchHeight={48} label="Load more Finds" variant="quiet" onPress={onLoadMore}/>:null}
    renderItem={({item})=><FindCard item={item} onPress={()=>onOpen(item.id)}/>}/>;
}
