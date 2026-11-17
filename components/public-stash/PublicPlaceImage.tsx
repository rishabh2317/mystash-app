import React,{useEffect,useState} from 'react';
import {View,Pressable,Linking,PixelRatio,Platform,type StyleProp,type ViewStyle} from 'react-native';
import {Image} from 'expo-image';
import {Ionicons} from '@expo/vector-icons';
import {Text} from '@/components/ui/Text';
import {useThemeMode} from '@/contexts/ThemeContext';
import {usePublicPhotoDemand} from '@/src/public-stash/usePublicPhotoDemand';
import {queuePublicPhoto} from '@/src/public-stash/photoQueue';
import {placeImageSize,schedulePlaceImage} from '@/src/services/placeImageMemory';
import {publicStashRequest} from '@/src/services/publicStashApi';
import {readPlaceImageResource} from '@/backend/src/place/photos/contract';
import type {PlaceImageResource} from '@/backend/src/place/photos/contract';
export function PublicPlaceImage({stash,id,name,preview=false,style}:{stash:string;id:string;name:string;preview?:boolean;style:StyleProp<ViewStyle>}){
 const {tokens}=useThemeMode(),visible=usePublicPhotoDemand(),[photo,setPhoto]=useState<{key:string;value:PlaceImageResource|null}|null>(null);
 const [width,setWidth]=useState<128|256|640>(640),[retry,setRetry]=useState(0);
 const key=`${stash}:${id}:${preview}:${width}`;
 useEffect(()=>{if(!visible.visible){const clear=setTimeout(()=>setPhoto(null),600);return()=>clearTimeout(clear);}let alive=true,release:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
  const cancel=schedulePlaceImage(()=>{release=queuePublicPhoto(async()=>{if(!alive)return;try{
   const r=await publicStashRequest<{image:PlaceImageResource|null;retryAfterMs?:number}>(`/public-stashes/${stash}/places/${id}/photo?width=${width}${preview?'&preview=1':''}`,{signal:controller.signal});
   if(alive){setPhoto({key,value:readPlaceImageResource(r.image)});if(r.retryAfterMs&&retry<2)timer=setTimeout(()=>setRetry(n=>n+1),Math.max(500,Math.min(3000,r.retryAfterMs)));}
  }catch{if(alive)setPhoto({key,value:null});}});});
  return()=>{alive=false;cancel();release?.();controller.abort();if(timer)clearTimeout(timer);};
 },[key,visible.visible,stash,id,preview,width,retry]);
 const resource=photo?.key===key?photo.value:null;
 return <View ref={visible.ref} onLayout={event=>{const next=event.nativeEvent.layout.width;if(next>0)setWidth(placeImageSize(next,PixelRatio.get(),640));visible.onLayout();}} collapsable={false}>
  <View style={[{backgroundColor:tokens.color.surfaceSubtle,alignItems:'center',justifyContent:'center',overflow:'hidden'},style]}>
   {resource?<Image source={Platform.OS==='web'?{uri:resource.uri}:{uri:resource.uri,headers:{'Cache-Control':'no-store'}}} cachePolicy="none" contentFit="cover" style={{width:'100%',height:'100%'}} accessibilityLabel={`Photo of ${name}`} onError={()=>{setPhoto(null);if(retry<2)setRetry(n=>n+1);}}/>:<Ionicons name="location-outline" size={28} color={tokens.color.textMuted}/>}
  </View>
  {resource?<View style={{padding:4}}><Pressable accessibilityRole="link" onPress={event=>{event.stopPropagation();void Linking.openURL(resource.attribution.sourceUrl);}}><Image source={tokens.mode==='nebula'?require('../../assets/attribution/google-maps-white.png'):require('../../assets/attribution/google-maps-dark.png')} style={{width:98,height:18}} accessibilityLabel="Google Maps" contentFit="contain"/></Pressable>{resource.attribution.authors.map((author,index)=><Pressable key={index} disabled={!author.url} accessibilityRole="link" onPress={event=>{event.stopPropagation();if(author.url)void Linking.openURL(author.url);}}><Text style={{color:tokens.color.textMuted,fontSize:12}}>{author.name}</Text></Pressable>)}{resource.attribution.providers.map((provider,index)=><Pressable key={`provider:${index}`} disabled={!provider.url} accessibilityRole="link" onPress={event=>{event.stopPropagation();if(provider.url)void Linking.openURL(provider.url);}}><Text style={{color:tokens.color.textMuted,fontSize:12}}>{provider.name}</Text></Pressable>)}{resource.attribution.reportUrl?<Pressable accessibilityRole="link" onPress={event=>{event.stopPropagation();void Linking.openURL(resource.attribution.reportUrl!);}}><Text style={{color:tokens.color.textMuted,fontSize:12}}>Report photo</Text></Pressable>:null}</View>:null}
 </View>;
}
