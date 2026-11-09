import React, { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useCart } from '@/contexts/CartContext';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { TactileFilterChip } from '@/components/ui/TactileFilterChip';
import { PlaceSourceVideoModal } from '@/components/place/PlaceSourceVideoModal';
import { typeStyle } from '@/src/theme/typography';
import { outlineCardChrome } from '@/src/theme/tokens';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';
import { fetchShareIntent, updateShareIntent, fetchShareReview, decideShareSuggestion, type ShareIntentValue, type ReviewProduct } from '@/src/services/shareReviewApi';
export function ShareImportDetails({importId,sourceUrl,placeCount=0,productCount=0,presentation='default'}:{importId:string;sourceUrl:string;placeCount?:number;productCount?:number;presentation?:'default'|'finds'}) {
  const {tokens}=useThemeMode(), {user}=useAuth(), {refresh}=useCart();
  const router=useRouter();
  const refined=presentation==='finds';
  const [intent,setIntent]=useState<ShareIntentValue|null>(null),[products,setProducts]=useState<ReviewProduct[]>([]);
  const [places,setPlaces]=useState<{id:string;name:string}[]>([]);
  const [owner,setOwner]=useState<string>(),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[video,setVideo]=useState(false);
  const intentEnabled=process.env.EXPO_PUBLIC_SHARE_INTENT_ENABLED==='true';
  const reviewEnabled=process.env.EXPO_PUBLIC_SHARE_SUGGESTIONS_ENABLED==='true';
  useEffect(()=>{let current=true;setIntent(null);setProducts([]);setPlaces([]);setError(null);setOwner(user?.id);
    if(user && intentEnabled)void fetchShareIntent(importId).then(v=>{if(current)setIntent(v);}).catch(()=>{if(current)setError('Interest settings are not available yet.');});
    if(user && reviewEnabled)void fetchShareReview(importId).then(v=>{if(current){setProducts(v.products);setPlaces(v.places);}}).catch(()=>{if(current)setError('Product suggestions are not available yet.');});
    return()=>{current=false;};
  },[importId,user,intentEnabled,reviewEnabled]);
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setError(null);try{await action();}catch(e){setError(e instanceof Error?e.message:'Could not confirm this change.');}finally{setBusy(false);}};
  if(owner!==user?.id)return null;
  const placeResults=places.length||placeCount>0?<View style={{gap:tokens.space.xs}}>
    <Text style={typeStyle(tokens,'body')}>Places found</Text>
    {places.slice(0,3).map(place=><Text key={place.id} style={typeStyle(tokens,'caption')}>{place.name}</Text>)}
    {refined?<View style={{alignSelf:'flex-start'}}><ActionButton label="View places in Stash" variant="quiet" minTouchHeight={48} onPress={()=>router.push('/(tabs)/stash?segment=places')}/></View>:<ActionButton label="View places in Stash" variant="quiet" onPress={()=>router.push('/(tabs)/stash?segment=places')}/>}
  </View>:null;
  const sourceAction=<ActionButton label="Source video" leadingIcon="play-outline" variant="quiet" minTouchHeight={refined?48:undefined} onPress={()=>setVideo(true)}/>;
  const reloadAction=<ActionButton label="Reload saved interest" disabled={busy} variant="quiet" minTouchHeight={refined?48:undefined} onPress={()=>void run(async()=>setIntent(await fetchShareIntent(importId)))}/>;
  return <View style={{gap:tokens.space.sm}}>
    {refined?<View style={{alignSelf:'flex-start'}}>{sourceAction}</View>:sourceAction}
    {video?<PlaceSourceVideoModal key={sourceUrl} source={{url:sourceUrl,thumbnailUrl:null}} onClose={()=>setVideo(false)}/>:null}
    {error?<Text accessibilityLiveRegion="polite" style={typeStyle(tokens,'caption')}>{error}</Text>:null}
    {intentEnabled && intent ? <View style={[{gap:tokens.space.sm},refined&&{...outlineCardChrome(tokens),borderWidth:tokens.stroke.thin,borderRadius:tokens.radius.md,padding:tokens.space.sm}]}>
      <Text style={refined?typeStyle(tokens,'tileTitle'):typeStyle(tokens,'body')}>What interested you?</Text>
      <View style={{flexDirection:'row',...(refined?{flexWrap:'wrap' as const}:{}),gap:refined?tokens.space.xs:tokens.space.sm}}>{(['product','place','both'] as const).map(kind=>{
        const label=kind[0].toUpperCase()+kind.slice(1);
        const press=()=>setIntent({...intent,kind:intent.kind===kind?null:kind});
        const text=<Text style={[typeStyle(tokens,'caption'),refined&&{color:tokens.color.text,fontFamily:intent.kind===kind?tokens.fontFamily.medium:tokens.fontFamily.regular}]}>{label}</Text>;
        return refined?<TactileFilterChip key={kind} selected={intent.kind===kind} disabled={busy}
          accessibilityRole="button" onPress={press}
          contentStyle={{minHeight:FEED_MIN_HIT_TARGET,paddingHorizontal:tokens.space.sm,justifyContent:'center'}}>{text}</TactileFilterChip>
          :<Pressable key={kind} disabled={busy} accessibilityRole="button" accessibilityState={{selected:intent.kind===kind}}
            onPress={press} style={{minHeight:FEED_MIN_HIT_TARGET,paddingHorizontal:tokens.space.sm,justifyContent:'center',borderRadius:tokens.radius.pill,borderWidth:tokens.stroke.thin,borderColor:tokens.color.border,backgroundColor:intent.kind===kind?tokens.color.primarySurface:tokens.color.surface}}>{text}</Pressable>;
      })}</View>
      <TextInput accessibilityLabel="Interest note" placeholder="Optional note" placeholderTextColor={tokens.color.textMuted} value={intent.note??''}
        editable={!busy} maxLength={280} multiline onChangeText={note=>setIntent({...intent,note:note||null})}
        style={{...typeStyle(tokens,'body'),padding:tokens.space.sm,borderWidth:tokens.stroke.thin,borderColor:tokens.color.border,borderRadius:tokens.radius.md}}/>
      <ActionButton label="Save interest" disabled={busy} variant="secondary" minTouchHeight={refined?48:undefined} onPress={()=>void run(async()=>{await updateShareIntent(importId,intent);setIntent(await fetchShareIntent(importId));})}/>
      {refined?<View style={{alignSelf:'flex-start'}}>{reloadAction}</View>:reloadAction}
    </View>:null}
    {intent?.kind==='place'?placeResults:null}
    {productCount>0?(refined?<View style={{alignSelf:'flex-start'}}><ActionButton label="View products in Stash" variant="quiet" minTouchHeight={48} onPress={()=>router.push('/(tabs)/stash')}/></View>:<ActionButton label="View products in Stash" variant="quiet" onPress={()=>router.push('/(tabs)/stash')}/>):null}
    {products.map(product=><View key={product.sourceProductId} style={{gap:tokens.space.sm}}>
      {product.assessment?.kind==='unable_to_identify'?<Text style={typeStyle(tokens,'bodyMuted')}>We couldn’t identify {product.title}. Your video is still saved.</Text>:null}
      {product.assessment?.suggestions.map(s=>{
        const decision=product.reviews.find(r=>r.candidate_key===s.key);
        if(decision?.state==='dismissed')return null;
        return <View key={s.key} style={{flexDirection:'row',gap:tokens.space.sm,padding:tokens.space.sm,borderWidth:tokens.stroke.thin,borderColor:tokens.color.border,borderRadius:tokens.radius.md}}>
          {s.image?<Image source={{uri:s.image}} style={{width:tokens.space.lg*4,height:tokens.space.lg*4,borderRadius:tokens.radius.sm}} contentFit="cover"/>:null}
          <View style={{flex:1,gap:tokens.space.xs}}><Text style={typeStyle(tokens,'caption')}>Similar product</Text><Text style={typeStyle(tokens,'body')}>{s.title}</Text>
            {decision?.state==='accepted'?<Text style={typeStyle(tokens,'caption')}>Saved to Products</Text>:<>
              <ActionButton label="Save to Products" disabled={busy} onPress={()=>void run(async()=>{await decideShareSuggestion(importId,product.sourceProductId,s.key,'save');setProducts((await fetchShareReview(importId)).products);await refresh();})}/>
              <ActionButton label="Dismiss" variant="quiet" disabled={busy} onPress={()=>void run(async()=>{await decideShareSuggestion(importId,product.sourceProductId,s.key,'dismiss');setProducts((await fetchShareReview(importId)).products);})}/>
            </>}
          </View>
        </View>;
      })}
    </View>)}
    {intent?.kind!=='place'?placeResults:null}
  </View>;
}
