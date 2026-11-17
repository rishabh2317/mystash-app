import {PublicAppActions} from './PublicAppActions';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {View,Pressable,ScrollView,TextInput,Linking,AppState,Alert,Platform} from 'react-native';
import {useLocalSearchParams,useRouter,type Href,useFocusEffect} from 'expo-router';
import {TopBar} from '@/components/chrome/TopBar';
import {Text} from '@/components/ui/Text';
import {ProductPage} from '@/components/product/ProductPage';
import {FailureState} from '@/components/status/FailureState';
import {TextBlockSkeleton} from '@/components/status/TextBlockSkeleton';
import {useAuth} from '@/contexts/AuthContext';
import {useThemeMode} from '@/contexts/ThemeContext';
import {typeStyle} from '@/src/theme/typography';
import {hydrateProductPage} from '@/src/services/productPageMap';
import type {ProductPageView} from '@/src/types/productPage';
import {publicStashRequest,type StashPlace} from '@/src/services/publicStashApi';
import {analyticsHeaders} from '@/src/analytics/client';
import {newEventId} from '@/src/services/newEventId';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {merchantBrowserPath} from '@/src/ui/merchantBrowser';
import {useStashMeasurement} from '@/src/public-stash/useStashMeasurement';
import {PublicPlaceImage} from './PublicPlaceImage';
export default function PublicItemScreen(){
 const params=useLocalSearchParams<{publicId:string;productId?:string;placeId?:string;namespace?:string;preview?:string}>();
 const stash=String(params.publicId),id=String(params.productId??params.placeId),kind=params.productId?'product':'place',namespace=kind==='place'?'place':params.namespace==='catalog'?'catalog':'discovered',preview=params.preview==='1';
 const {user}=useAuth(),router=useRouter(),{tokens}=useThemeMode();
 const [loadedPage,setPage]=useState<ProductPageView|null>(null),[loadedPlace,setPlace]=useState<StashPlace|null>(null),[error,setError]=useState<unknown>(null),[saved,setSaved]=useState(false),[saving,setSaving]=useState(false),[countryChoice,setCountryChoice]=useState<{owner:string;country:string}|null>(null),[inputCountry,setInputCountry]=useState('');
 const visitor=user?.id??'guest',country=countryChoice?.owner===visitor?countryChoice.country:'';
 const locale=Intl.DateTimeFormat().resolvedOptions().locale;
 const loadedScope=useRef(''),scope=`${stash}:${id}:${namespace}:${preview}:${country}:${user?.id??'guest'}`;
 const page=loadedScope.current===scope?loadedPage:null,place=loadedScope.current===scope?loadedPlace:null;
 const generation=useRef(0),account=useRef(user?.id);account.current=user?.id;
 useEffect(()=>{let alive=true;setInputCountry('');void AsyncStorage.getItem(`mystash.publicStash.country.${visitor}`).then(value=>{if(alive&&value&&/^[A-Z]{2}$/.test(value)){setCountryChoice({owner:visitor,country:value});setInputCountry(value);}}).catch(()=>{});return()=>{alive=false;};},[visitor]);
 const base=`/public-stashes/${stash}/${kind==='product'?`products/${namespace}/${id}`:`places/${id}`}`;
 const load=useCallback(async()=>{const ticket=++generation.current;setError(null);
  try{if(kind==='product'){const raw=await publicStashRequest<unknown>(`${base}/page?country=${country}&locale=${encodeURIComponent(locale)}${preview?'&preview=1':''}`);const p=hydrateProductPage(raw);if(!p)throw Error('Product unavailable');if(ticket===generation.current){loadedScope.current=scope;setPage(p);setSaved(p.viewerSaved===true);const resolved=(raw as {commerceCountry?:string}).commerceCountry;if(resolved)setInputCountry(resolved);}}
   else{const p=await publicStashRequest<StashPlace>(`${base}${preview?'?preview=1':''}`);if(ticket===generation.current){loadedScope.current=scope;setPlace(p);setSaved(p.viewerSaved===true);}}
  }catch(e){if(ticket===generation.current){setPage(null);setPlace(null);setError(e);}}
 },[base,country,preview,kind,user?.id,scope,locale]);
 useFocusEffect(useCallback(()=>{setPage(null);setPlace(null);setSaved(false);void load();return()=>{generation.current++;};},[load]));
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state==='active')void load();});const onVisible=()=>{if(typeof document!=='undefined'&&document.visibilityState==='visible')void load();};if(typeof document!=='undefined')document.addEventListener('visibilitychange',onVisible);if(typeof window!=='undefined')window.addEventListener('pageshow',onVisible);return()=>{sub.remove();if(typeof document!=='undefined')document.removeEventListener('visibilitychange',onVisible);if(typeof window!=='undefined')window.removeEventListener('pageshow',onVisible);};},[load]);
 useStashMeasurement(page||place?stash:undefined,kind,id,namespace==='place'?undefined:namespace,preview);
 const save=useCallback(async()=>{if(saved||saving||preview)return;
  if(!user){router.push(`/stash/${stash}/sign-in?kind=${kind}&namespace=${namespace}&itemId=${id}` as Href);return;}
  const owner=user.id;setSaving(true);try{await publicStashRequest(`/public-stashes/${stash}/items/save`,{method:'POST',body:JSON.stringify({kind,namespace,itemId:id})},owner);if(account.current===owner)setSaved(true);}catch(e){if(account.current===owner)Alert.alert('Save',e instanceof Error?e.message:'Couldn’t save.');}finally{if(account.current===owner)setSaving(false);}
 },[saved,saving,preview,user,router,stash,kind,namespace,id]);
 const shop=useCallback(async(offerId?:string)=>{try{const headers=analyticsHeaders(),eventId=newEventId();const result=await publicStashRequest<{url:string;merchantName:string|null}>(`${base}/outbound?format=json&country=${country}&locale=${encodeURIComponent(locale)}&eventId=${eventId}${offerId?`&offerId=${encodeURIComponent(offerId)}`:'&discovery=1'}`,{headers:{...headers,'x-mystash-outbound-id':eventId}});
  if(Platform.OS==='web')await Linking.openURL(result.url);else router.push(merchantBrowserPath(result.url,result.merchantName) as Href);
 }catch(e){Alert.alert('Shopping',e instanceof Error?e.message:'Link unavailable');}},[base,country,locale,router]);
 const actions=useMemo(()=>({onSave:()=>void save(),onShop:shop,saved,canSave:!preview}),[save,shop,saved,preview]);
 const title=kind==='product'?'Product':'Place';
 return <View style={{flex:1,backgroundColor:tokens.color.canvas}}><TopBar mode="page" title={title} showBack showBag={false}/>
  {preview?<Text style={[typeStyle(tokens,'bodyMuted'),{padding:16}]}>Only you can see this preview</Text>:null}
  {error?<FailureState error={error} title="Item unavailable" onRetry={()=>void load()} fill/>:kind==='product'?page?<>
   <View style={{padding:16,flexDirection:'row',alignItems:'center',gap:12}}><Text style={typeStyle(tokens,'bodyMuted')}>Shopping country</Text><TextInput value={inputCountry} maxLength={2} autoCapitalize="characters" accessibilityLabel="Shopping country code" onChangeText={setInputCountry} style={{color:tokens.color.text,borderColor:tokens.color.divider,borderWidth:1,padding:8,width:56,minWidth:56}}/><Pressable accessibilityRole="button" onPress={()=>{if(/^[a-z]{2}$/i.test(inputCountry)){const next=inputCountry.toUpperCase();setCountryChoice({owner:visitor,country:next});void AsyncStorage.setItem(`mystash.publicStash.country.${visitor}`,next).catch(()=>{});}}}><Text style={typeStyle(tokens,'link')}>Apply</Text></Pressable></View>
   <ProductPage page={page} publicActions={actions}/>
  </>:<TextBlockSkeleton/>:place?<ScrollView contentContainerStyle={{padding:16,gap:16,maxWidth:900,width:'100%',alignSelf:'center'}}>
   <PublicPlaceImage stash={stash} id={id} name={place.name} preview={preview} style={{width:'100%',aspectRatio:1.6,borderRadius:tokens.radius.lg}}/>
   <Text style={typeStyle(tokens,'sectionTitle')}>{place.name}</Text><Text style={typeStyle(tokens,'body')}>{place.formattedAddress??[place.locality,place.city,place.country].filter(Boolean).join(', ')}</Text>
   {place.category?<Text style={typeStyle(tokens,'bodyMuted')}>{place.category}</Text>:null}
   {place.mapsUrl?<Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(place.mapsUrl!)}><Text style={typeStyle(tokens,'link')}>Open in Maps</Text></Pressable>:null}
   {place.latitude!==null&&place.longitude!==null?<Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${place.latitude},${place.longitude}`)}`)}><Text style={typeStyle(tokens,'link')}>Get directions</Text></Pressable>:null}
   <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent([place.name,place.city,place.country].filter(Boolean).join(' '))}`)}><Text style={typeStyle(tokens,'link')}>Search Google</Text></Pressable>
   {!preview?<Pressable accessibilityRole="button" disabled={saving||saved} onPress={()=>void save()} style={{minHeight:44}}><Text style={typeStyle(tokens,'link')}>{saved?'Saved':saving?'Saving…':'Stash it'}</Text></Pressable>:null}
  </ScrollView>:<TextBlockSkeleton/>}
  <PublicAppActions path={kind==='product'?`/stash/${stash}/products/${namespace}/${id}`:`/stash/${stash}/places/${id}`}/>
 </View>;
}
