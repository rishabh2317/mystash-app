import React,{useCallback,useRef,useState,type ReactNode} from 'react';
import {ActivityIndicator,Pressable,ScrollView,useWindowDimensions,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Text} from '@/components/ui/Text';
import {useThemeMode} from '@/contexts/ThemeContext';
import {findApi} from '@/src/services/findApi';
import type {FindSourceSummary} from '@/src/services/findClient';
import {typeStyle} from '@/src/theme/typography';
import {StashSourceCard} from './StashSourceCard';

export function StashSourceRail({owner,kind,revision,onOpen,fallback}:{owner:string;kind:'product'|'place';revision:string;onOpen(id:string):void;fallback?:ReactNode}){
  const {tokens}=useThemeMode(),{width}=useWindowDimensions();
  const [state,setState]=useState<{owner:string;items:FindSourceSummary[];cursor:string|null;loading:boolean;more:boolean;error:boolean}>({owner,items:[],cursor:null,loading:true,more:false,error:false});
  const epoch=useRef(0),busy=useRef(false),stateRef=useRef(state);stateRef.current=state;
  const invalidate=useCallback(()=>{epoch.current++;busy.current=false;},[]);
  const load=useCallback(async(append=false)=>{
    if(busy.current)return;
    busy.current=true;const token=++epoch.current;
    setState(previous=>({...previous,owner,loading:!append,more:append,error:false}));
    try{
      const current=stateRef.current,cursor=append&&current.owner===owner?current.cursor:null;
      const page=await findApi.sourceSummaries(kind,{cursor:cursor??undefined},owner);
      if(token!==epoch.current)return;
      setState(previous=>({owner,items:append?[...previous.items.filter(old=>!page.items.some(item=>item.id===old.id)),...page.items]:page.items,cursor:page.nextCursor,loading:false,more:false,error:false}));
    }catch{if(token===epoch.current)setState(previous=>({...previous,owner,loading:false,more:false,error:true}));}
    finally{if(token===epoch.current)busy.current=false;}
  },[kind,owner]);
  useFocusEffect(useCallback(()=>{void revision;invalidate();setState({owner,items:[],cursor:null,loading:true,more:false,error:false});void load();return invalidate;},[owner,revision,load,invalidate]));
  const visible=state.owner===owner?state.items:[];
  const cardWidth=Math.max(112,Math.min(170,(width-32-24)/2.5));
  if(state.error&&!visible.length)return <View style={{gap:tokens.space.xs}}><Text style={typeStyle(tokens,'caption')}>Source views are unavailable. Your saved items are still below.</Text>{fallback}<Pressable accessibilityRole="button" onPress={()=>void load()} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'link')}>Retry source views</Text></Pressable></View>;
  return <View style={{gap:tokens.space.sm}}><Text accessibilityRole="header" style={typeStyle(tokens,'sectionTitle')}>Saved from your Finds</Text>
    {state.loading&&!visible.length?<ActivityIndicator color={tokens.color.primary}/>:visible.length?<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:tokens.space.sm,paddingRight:tokens.space.md}}>{visible.map(source=><StashSourceCard key={source.id} source={source} width={cardWidth} onPress={()=>onOpen(source.id)}/>)}{state.cursor?<Pressable accessibilityRole="button" onPress={()=>void load(true)} style={{minWidth:96,minHeight:44,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(tokens,'link')}>{state.more?'Loading…':'See more'}</Text></Pressable>:null}</ScrollView>:<Text style={typeStyle(tokens,'bodyMuted')}>Captures with saved items will appear here.</Text>}
    {state.error&&visible.length?<Pressable accessibilityRole="button" onPress={()=>void load()} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'link')}>Refresh source views</Text></Pressable>:null}
  </View>;
}
