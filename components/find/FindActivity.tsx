import { FailureState } from '@/components/status/FailureState';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { FindItem } from '@/src/services/findClient';
import { findResultLabel, findSourceLabel } from '@/src/ui/find';
import { findDetailStatus } from '@/src/ui/findDetail';
import { findActivityExpanded, findActivityProgress, findActivityRevision, type FindActivityPreview } from '@/src/ui/findDashboard';
import { createFindActivityPreviewController } from '@/src/state/findActivityPreviewController';
import { findApi } from '@/src/services/findApi';
import { shareActivityRelativeTime } from '@/src/ui/shareActivity';
import { FindStatusProgress } from './FindStatusProgress';
import { FindImage } from './FindImage';
import { PrivateFindImage } from './PrivateFindImage';
import { PlaceImage } from '@/components/place/PlaceImage';

export function FindActivityPreviewRows({rows,onOpen}:{rows:FindActivityPreview[];onOpen():void}){
  const {tokens}=useThemeMode();
  return <>{rows.map(row=>{
    const content=(image:React.ReactNode,attribution?:React.ReactNode)=><>{image}<View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={typeStyle(tokens,'tileTitle')}>{row.title}</Text><Text numberOfLines={1} style={typeStyle(tokens,'tileMeta')}>{row.note}</Text>{attribution}</View></>;
    return <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={`View ${row.title} in Find`} onPress={onOpen} style={{flexDirection:'row',alignItems:'center',gap:tokens.space.sm,minHeight:48}}>
      {row.kind==='place'?<PlaceImage placeId={row.placeId??null} importId={row.importId} name={row.title} width={128} style={{width:42,height:42,borderRadius:tokens.radius.sm}}>
        {({image,attribution})=>content(image,attribution)}
      </PlaceImage>:content(<FindImage url={row.imageUrl} cacheKey={row.key} placeholder="cube-outline" style={{width:42,height:42,borderRadius:tokens.radius.sm}}/>)}
    </Pressable>;
  })}</>;
}

export function FindActivity({item,owner,onOpen,onRetry,busy,error}:{item:FindItem;owner:string|null;onOpen():void;onRetry(kind:'extraction'|'saving'):void;busy:boolean;error:string|null}){
  const {tokens}=useThemeMode();
  const [choice,setChoice]=useState<{id:string;expanded:boolean}|null>(()=>({id:item.id,expanded:findActivityExpanded(item,null)}));
  const working=item.outcome.extractionActive||item.outcome.stashSync==='pending';
  const previousWork=useRef(working);
  useEffect(()=>{if(working&&!previousWork.current)setChoice({id:item.id,expanded:true});previousWork.current=working;},[working,item.id]);
  const expanded=findActivityExpanded(item,choice);
  const status=findDetailStatus(item);
  const revision=findActivityRevision(item),hasResults=item.outcome.foundProducts+item.outcome.foundPlaces>0;
  const controllerRef=useRef<ReturnType<typeof createFindActivityPreviewController>|null>(null);
  if(!controllerRef.current)controllerRef.current=createFindActivityPreviewController(findApi);
  const controller=controllerRef.current;
  const preview=useSyncExternalStore(controller.subscribe,controller.getState,controller.getState);
  useEffect(()=>{controller.configure(owner,item.id,revision,expanded,hasResults);},[controller,owner,item.id,revision,expanded,hasResults]);
  useEffect(()=>()=>controller.clear(),[controller]);
  const visiblePreview=preview.owner===owner&&preview.id===item.id&&preview.revision===revision;
  return <View style={{...outlineCardChrome(tokens),borderWidth:tokens.stroke.thin,borderRadius:tokens.radius.lg,padding:tokens.space.sm,gap:tokens.space.xs}}>
    <View style={{flexDirection:'row',alignItems:'center',gap:tokens.space.sm,minHeight:64}}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title || findSourceLabel(item.sourceType)}`} onPress={onOpen} style={{width:80,height:64,borderRadius:tokens.radius.md,overflow:'hidden',backgroundColor:tokens.color.surfaceSubtle}}>{item.sourceType==='image'?<PrivateFindImage id={item.id} style={{width:'100%',height:'100%'}}/>:<FindImage url={item.thumbnailUrl} cacheKey={item.id} style={{width:'100%',height:'100%'}}/>}</Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{expanded}} accessibilityLabel={`${item.title || findSourceLabel(item.sourceType)}. ${findResultLabel(item)}`} onPress={()=>setChoice({id:item.id,expanded:!expanded})} style={{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:tokens.space.xs,minHeight:64}}>
      <View style={{flex:1,minWidth:0,gap:tokens.space.xxs}}><Text numberOfLines={2} style={typeStyle(tokens,'tileTitle')}>{item.title||findSourceLabel(item.sourceType)}</Text><Text numberOfLines={2} style={typeStyle(tokens,'tileMeta')}>{findResultLabel(item)}</Text><Text style={typeStyle(tokens,'tileMeta')}>{shareActivityRelativeTime(item.createdAt)}</Text></View>
      <Ionicons name={expanded?'chevron-up-outline':'chevron-down-outline'} size={18} color={tokens.color.textMuted}/>
      </Pressable>
    </View>
    {expanded?<View style={{padding:tokens.space.sm,borderRadius:tokens.radius.md,backgroundColor:tokens.color.surfaceSubtle,gap:tokens.space.xs}}><Text style={typeStyle(tokens,'tileTitle')}>{status.label}</Text><Text accessibilityLiveRegion="polite" style={typeStyle(tokens,'caption')}>{status.message}</Text>
      {!working&&item.outcome.category==='completed'?<Text style={typeStyle(tokens,'caption')}>This Find is complete. You can also find it in Completed.</Text>:null}
      <View accessibilityLabel="Find progress" style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.space.sm}}>{findActivityProgress(item).map(line=><Text key={line} style={typeStyle(tokens,'tileMeta')}>{line}</Text>)}</View>
      <FindStatusProgress color={status.tone==='error'?tokens.color.danger:status.tone==='success'?tokens.color.success:status.tone==='empty'?tokens.color.textMuted:tokens.color.warning} active={item.outcome.extractionActive||item.outcome.stashSync==='pending'||status.tone==='queued'} label={status.label}/>
      {hasResults&&visiblePreview&&preview.loading&&!preview.loaded?<Text style={typeStyle(tokens,'tileMeta')}>Loading found items…</Text>:null}
      {hasResults&&visiblePreview?<FindActivityPreviewRows rows={preview.items} onOpen={onOpen}/>:null}
      {hasResults&&visiblePreview&&preview.error?<Text style={typeStyle(tokens,'tileMeta')}>Preview unavailable. Open this Find to see its results.</Text>:null}
      {error?<FailureState error={error} variant="inline"/>:null}
      {item.outcome.canRetryExtraction?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>onRetry('extraction')} style={{minHeight:44,justifyContent:'center',alignSelf:'flex-start'}}><Text style={typeStyle(tokens,'link')}>{busy?'Retrying…':'Retry finding'}</Text></Pressable>:null}
      {item.outcome.canRetrySaving && item.outcome.stashSync==='failed'?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>onRetry('saving')} style={{minHeight:44,justifyContent:'center',alignSelf:'flex-start'}}><Text style={typeStyle(tokens,'link')}>{busy?'Retrying…':'Retry saving'}</Text></Pressable>:null}
    </View>:null}
    <Pressable accessibilityRole="button" accessibilityLabel="View Find" onPress={onOpen} style={{minHeight:44,alignSelf:'flex-start',justifyContent:'center',paddingHorizontal:tokens.space.xs,flexDirection:'row',alignItems:'center',gap:tokens.space.xxs}}><Text style={typeStyle(tokens,'link')}>View Find</Text><Ionicons name="chevron-forward-outline" size={16} color={tokens.color.primary}/></Pressable>
  </View>;
}
