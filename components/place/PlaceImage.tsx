import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, PixelRatio, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';
import { useVisibleResource } from '@/src/ui/useVisibleResource';
import { placeImageSize, schedulePlaceImage } from '@/src/services/placeImageMemory';
import { placeImages } from '@/src/services/placeImages';
import type { PlaceImageResource } from '@/backend/src/place/photos/contract';
import { attributionLink } from '@/backend/src/place/photos/contract';

type Props={placeId:string|null;name:string;importId?:string;style:StyleProp<ViewStyle>;width?:128|256|640;
  /** Small thumbnails put attribution beside the image, in the same card. */
  children?:(slots:{image:React.ReactNode;attribution:React.ReactNode})=>React.ReactNode};

/** Provider-neutral card boundary. Future licensed sources change its resource adapter. */
export function PlaceImage({placeId,name,importId,style,width=640,children}:Props) {
  const {tokens}=useThemeMode(),{user}=useAuth(),owner=user?.id??null,reduceMotion=usePrefersReducedMotion();
  const visibility=useVisibleResource(Boolean(owner&&placeId));
  const [state,setState]=useState<{key:string;photo:PlaceImageResource|null;loaded:boolean;readyAt?:number}|null>(null);
  const [retry,setRetry]=useState<{key:string;count:number}>({key:'',count:0}),[credits,setCredits]=useState(false);
  const [measuredWidth,setMeasuredWidth]=useState(0);
  const variant=measuredWidth?placeImageSize(measuredWidth,PixelRatio.get(),width):width;
  const key=JSON.stringify([owner,placeId,importId,variant]);
  const attempts=retry.key===key?retry.count:0;
  useEffect(()=>{
    if(!owner||!placeId){setState(null);setCredits(false);return;}
    if(!visibility.visible){
      // Brief edge crossings keep their current image; offscreen views release local byte references.
      const timer=setTimeout(()=>{setState(null);setCredits(false);},600);
      return()=>clearTimeout(timer);
    }
    if(state?.key===key&&state.photo)return;
    let alive=true,release:(()=>void)|undefined;
    const cancel=schedulePlaceImage(()=>{
      const request=placeImages.acquire(owner,placeId,variant,importId);release=request.release;
      void request.promise.then(photo=>{if(alive)setState({key,photo,loaded:false,readyAt:Date.now()});});
    });
    return()=>{alive=false;cancel();release?.();};
    // Completed state deliberately survives visibility changes; the service owns session reuse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[visibility.visible,owner,placeId,variant,importId,key,attempts]);
  const current=owner&&placeId&&state?.key===key?state:null,photo=current?.photo;
  const activePhoto=useRef<{key:string;uri:string|null}>({key,uri:null});activePhoto.current={key,uri:photo?.uri??null};
  const openLink=(url:string|null)=>{const safe=attributionLink(url);if(safe)void Linking.openURL(safe).catch(()=>{});};
  const credit=photo&&current?.loaded?<Pressable accessibilityRole="button" accessibilityLabel={`Photo credits and Google Maps source, ${name}`} onPress={event=>{event.stopPropagation();setCredits(true);}}
    style={{minHeight:children?20:44,justifyContent:'center',alignSelf:'flex-start',maxWidth:'100%'}} hitSlop={children?6:0}>
    <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{fontFamily:tokens.fontFamily.regular,fontWeight:'400',fontStyle:'normal',fontSize:12,color:children?(tokens.mode==='nebula'?'#FFFFFF':'#1F1F1F'):'#FFFFFF'}}>Google Maps</Text>
  </Pressable>:null;
  const image=<View ref={visibility.ref} collapsable={false} onLayout={event=>{
      // Native synthetic events may be released before React executes a queued updater.
      const nextWidth=event.nativeEvent.layout.width;
      if(Number.isFinite(nextWidth)&&nextWidth>0)setMeasuredWidth(previous=>Math.abs(previous-nextWidth)>1?nextWidth:previous);
      visibility.onLayout();
    }} accessibilityLabel={`Place photo, ${name}`}
    style={[{backgroundColor:tokens.color.surfaceSubtle,overflow:'hidden',alignItems:'center',justifyContent:'center'},style]}>
    <Ionicons accessible={false} name="location-outline" size={24} color={tokens.color.textMuted}/>
    {photo?<Image source={{uri:photo.uri,headers:{'Cache-Control':'no-store'}}} style={[StyleSheet.absoluteFill,{opacity:current?.loaded?1:0}]} contentFit="cover" cachePolicy="none"
      accessibilityLabel={`Photo of ${name}`} recyclingKey={`${key}:${attempts}`}
      transition={reduceMotion?tokens.motion.thumbnailFadeReducedMs:tokens.motion.thumbnailFadeMs}
      onLoad={()=>{if(activePhoto.current.key!==key||activePhoto.current.uri!==photo.uri)return;
        if(!current?.loaded&&current?.readyAt)placeImages.recordDisplay?.(Date.now()-current.readyAt);
        setState(previous=>previous?.key===key&&previous.photo?.uri===photo.uri?{...previous,loaded:true}:previous);}}
      onError={()=>{if(activePhoto.current.key!==key||activePhoto.current.uri!==photo.uri)return;placeImages.invalidate(placeId!,variant);setState(null);if(attempts<1)setRetry({key,count:attempts+1});}}/>:null}
    {!children&&credit?<View style={{position:'absolute',left:4,top:4,paddingHorizontal:6,borderRadius:tokens.radius.sm,backgroundColor:'rgba(0,0,0,0.75)'}}>{credit}</View>:null}
  </View>;
  return <>{children?children({image,attribution:credit}):image}
    {credits&&photo&&current?.loaded?<Modal visible animationType="fade" onRequestClose={()=>setCredits(false)}>
      <SafeAreaView style={{flex:1,backgroundColor:tokens.color.canvas}}>
        <ScrollView contentContainerStyle={{padding:tokens.space.md,gap:tokens.space.md}}>
          <Text accessibilityRole="header" style={typeStyle(tokens,'sectionTitle')}>Photo credits</Text>
          <Image source={{uri:photo.uri,headers:{'Cache-Control':'no-store'}}} cachePolicy="none" contentFit="contain" style={{width:'100%',aspectRatio:photo.width/photo.height,maxHeight:340}} accessibilityLabel={`Photo of ${name}`}/>
          <View style={{paddingHorizontal:10,paddingTop:10,paddingBottom:5,alignSelf:'flex-start'}}>
            <Image source={tokens.mode==='nebula'?require('../../assets/attribution/google-maps-white.png'):require('../../assets/attribution/google-maps-dark.png')}
              style={{height:18,width:98}} contentFit="contain" cachePolicy="none" accessibilityLabel="Google Maps"/>
          </View>
          {photo.attribution.authors.map((author,index)=><View key={index} style={{gap:tokens.space.xs}}>
            {author.avatar?<Image source={{uri:author.avatar,headers:{'Cache-Control':'no-store'}}} cachePolicy="none" style={{width:32,height:32,borderRadius:16}} accessibilityLabel={author.name}/>:null}
            <Pressable accessibilityLabel={author.name} accessibilityRole={author.url?'link':undefined} disabled={!author.url} onPress={()=>openLink(author.url)} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'body')}>{author.name}</Text></Pressable>
          </View>)}
          {photo.attribution.providers.map((provider,index)=><Pressable key={index} accessibilityLabel={provider.name} disabled={!provider.url} accessibilityRole={provider.url?'link':undefined} onPress={()=>openLink(provider.url)} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'body')}>{provider.name}</Text></Pressable>)}
          <ActionButton label="View original photo on Google Maps" variant="secondary" onPress={()=>openLink(photo.attribution.sourceUrl)}/>
          {photo.attribution.reportUrl?<ActionButton label="Report photo" variant="quiet" onPress={()=>openLink(photo.attribution.reportUrl)}/>:null}
          <ActionButton label="Close" onPress={()=>setCredits(false)}/>
        </ScrollView>
      </SafeAreaView>
    </Modal>:null}
  </>;
}
