import React from 'react';
import {Linking,Platform,Pressable,View} from 'react-native';
import {Text} from '@/components/ui/Text';
import {useThemeMode} from '@/contexts/ThemeContext';
import {typeStyle} from '@/src/theme/typography';
/** Release operators supply store URLs only after verifying the live listings. */
function storeUrl(raw:string|undefined,platform:'android'|'ios'):string|null{
 try{const url=new URL(raw??'');if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
 if(platform==='android')return url.hostname==='play.google.com'&&url.pathname==='/store/apps/details'&&url.searchParams.get('id')==='com.anonymous.Mystash'?url.href:null;
 return url.hostname==='apps.apple.com'&&/\/id\d+(?:\/|$)/.test(url.pathname)?url.href:null;
 }catch{return null;}
}
export function PublicAppActions({path}:{path:string}){
 const {tokens}=useThemeMode();if(Platform.OS!=='web')return null;
 const stores=[{label:'Google Play',url:storeUrl(process.env.EXPO_PUBLIC_MYSTASH_ANDROID_STORE_URL,'android')},{label:'App Store',url:storeUrl(process.env.EXPO_PUBLIC_MYSTASH_IOS_STORE_URL,'ios')}];
 return <View style={{padding:12,flexDirection:'row',flexWrap:'wrap',gap:16}}><Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(`mystash://${path.replace(/^\//,'')}`)}><Text style={typeStyle(tokens,'link')}>Open in Mystash</Text></Pressable>{stores.flatMap(store=>store.url?[<Pressable key={store.label} accessibilityRole="link" onPress={()=>void Linking.openURL(store.url!)}><Text style={typeStyle(tokens,'link')}>{store.label}</Text></Pressable>]:[])}</View>;
}
