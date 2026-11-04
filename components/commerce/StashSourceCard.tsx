import React, {useState} from 'react';
import {Image} from 'expo-image';
import {Ionicons} from '@expo/vector-icons';
import {Pressable,StyleSheet,View} from 'react-native';
import {Text} from '@/components/ui/Text';
import {useThemeMode} from '@/contexts/ThemeContext';
import {outlineCardChrome} from '@/src/theme/tokens';
import {typeStyle} from '@/src/theme/typography';
import {stashRelativeTime} from '@/src/ui/bag';
import {sourceCollageSlots} from '@/src/ui/stashSourceCollage';
import type {FindSourceSummary} from '@/src/services/findClient';

export function StashSourceCard({source,width,onPress}:{source:FindSourceSummary;width:number;onPress():void}){
  const {tokens}=useThemeMode(), [failed,setFailed]=useState<string[]>([]);
  const slots=sourceCollageSlots(source),count=source.savedProducts+source.savedPlaces;
  const cell=(index:number)=><View key={index} style={{flex:1,minWidth:0,minHeight:0,overflow:'hidden',backgroundColor:tokens.color.surfaceSubtle,borderRadius:tokens.radius.sm}}>
    {slots[index]?.image && !failed.includes(slots[index].image!) ? <Image source={{uri:slots[index].image!}} contentFit="cover" style={StyleSheet.absoluteFill} onError={()=>setFailed(previous=>[...previous,slots[index].image!])} accessibilityLabel="Saved result preview"/> : <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><Ionicons name="albums-outline" color={tokens.color.textMuted} size={20}/></View>}
    {slots[index]?.more ? <View style={[StyleSheet.absoluteFill,{backgroundColor:tokens.overlay.scrim,alignItems:'center',justifyContent:'center'}]}><Text style={[typeStyle(tokens,'tileTitle'),{color:tokens.color.onPrimary}]}>+{slots[index].more}</Text></View>:null}
  </View>;
  const group=(indexes:number[],style:object={})=><View style={[{flex:1,flexDirection:'row',gap:3,minHeight:0},style]}>{indexes.map(cell)}</View>;
  const collage=slots.length===1?cell(0):slots.length===2?group([0,1]):slots.length===3?<View style={{flex:1,flexDirection:'row',gap:3}}>{cell(0)}<View style={{flex:1,gap:3}}>{cell(1)}{cell(2)}</View></View>:<View style={{flex:1,gap:3}}>{group([0,1])}{group([2,3])}</View>;
  const title=source.title?.trim()||({image:'Your image',youtube:'YouTube Short',instagram:'Instagram Reel',web:'Saved link'}[source.sourceType]);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${count} saved items`} onPress={onPress} style={({pressed})=>[{width,padding:6,borderWidth:StyleSheet.hairlineWidth,borderRadius:tokens.radius.lg,opacity:pressed?tokens.motion.pressOpacity:1,...outlineCardChrome(tokens)}]}>
    <View style={{width:'100%',aspectRatio:1,overflow:'hidden',borderRadius:tokens.radius.md,backgroundColor:tokens.color.surfaceSubtle}}>{collage}</View>
    <View style={{paddingHorizontal:2,paddingTop:tokens.space.xs,gap:2}}><Text numberOfLines={1} style={typeStyle(tokens,'tileTitle')}>{title}</Text><Text numberOfLines={1} style={typeStyle(tokens,'tileMeta')}>{stashRelativeTime(source.createdAt)??''}</Text></View>
  </Pressable>;
}
