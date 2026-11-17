import {PublicAppActions} from './PublicAppActions';
import {PlaceCard} from '@/components/place/PlaceCard';
import {sharePublicStash} from '@/src/public-stash/share';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {View,Pressable,FlatList,AppState,useWindowDimensions,Linking} from 'react-native';
import {Image} from 'expo-image';
import {useFocusEffect,useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {TopBar} from '@/components/chrome/TopBar';
import {Text} from '@/components/ui/Text';
import {ProductCard} from '@/components/commerce/ProductCard';
import {ProfileContentTabs} from '@/components/profile/ProfileContentTabs';
import {FailureState} from '@/components/status/FailureState';
import {TextBlockSkeleton} from '@/components/status/TextBlockSkeleton';
import {useThemeMode} from '@/contexts/ThemeContext';
import {useAuth} from '@/contexts/AuthContext';
import {typeStyle} from '@/src/theme/typography';
import {catalogViewFromProductPage} from '@/src/ui/productPage';
import {publicStashRequest,type StashPage,type StashItem} from '@/src/services/publicStashApi';
import {useStashMeasurement} from '@/src/public-stash/useStashMeasurement';
import {PublicPlaceImage} from './PublicPlaceImage';
const idPattern=/^[0-9a-f-]{36}$/i;
export default function PublicStashScreen(){
 const params=useLocalSearchParams<{publicId:string;preview?:string}>(),id=String(params.publicId),preview=params.preview==='1';
 const {user}=useAuth(),router=useRouter(),{tokens}=useThemeMode(),{width}=useWindowDimensions();
 const [tab,setTab]=useState<'products'|'places'>('products'),[loaded,setPage]=useState<StashPage|null>(null),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false);
 const loadedScope=useRef(''),scope=`${id}:${tab}:${preview}:${user?.id??'guest'}`;
 const page=loadedScope.current===scope?loaded:null;
 const generation=useRef(0),columns=width>900?4:width>600?3:2;
 const load=useCallback(async(cursor?:string)=>{const ticket=++generation.current;setBusy(true);setError(null);
  try{if(!idPattern.test(id))throw Error('Stash unavailable');const next=await publicStashRequest<StashPage>(`/public-stashes/${id}?tab=${tab}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}${preview?'&preview=1':''}`);
   if(generation.current===ticket){loadedScope.current=scope;setPage(old=>({...next,items:cursor&&old?[...old.items,...next.items]:next.items}));}
  }catch(e){if(generation.current===ticket){setPage(null);setError(e);}}finally{if(generation.current===ticket)setBusy(false);}
 },[id,tab,preview,user?.id,scope]);
 useFocusEffect(useCallback(()=>{setPage(null);void load();return()=>{generation.current++;};},[load]));
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state==='active')void load();});const web=()=>{if(typeof document!=='undefined'&&document.visibilityState==='visible')void load();};if(typeof document!=='undefined')document.addEventListener('visibilitychange',web);if(typeof window!=='undefined')window.addEventListener('pageshow',web);return()=>{sub.remove();if(typeof document!=='undefined')document.removeEventListener('visibilitychange',web);if(typeof window!=='undefined')window.removeEventListener('pageshow',web);};},[load]);
 useStashMeasurement(page?.publicId,'stash',undefined,undefined,preview);
 const open=(item:StashItem)=>router.push((tab==='products'?`/stash/${id}/products/${item.namespace}/${item.id}`:`/stash/${id}/places/${item.id}`)+(preview?'?preview=1':'') as Href);
 return <View style={{flex:1,backgroundColor:tokens.color.canvas}}>
  <TopBar mode="page" title="Public Stash" showBack showBag={false} trailing={page&&!preview?<Pressable accessibilityRole="button" accessibilityLabel="Share Public Stash" onPress={()=>void sharePublicStash(id)}><Text style={typeStyle(tokens,'link')}>Share</Text></Pressable>:undefined}/>
  {error?<FailureState error={error} title="Stash unavailable" message="This Stash may be private or no longer available." onRetry={()=>void load()} fill/>:!page?<TextBlockSkeleton/>:<>
   <View style={{padding:16,gap:8,maxWidth:1100,width:'100%',alignSelf:'center'}}>
    {preview?<Text style={typeStyle(tokens,'bodyMuted')}>Only you can see this preview</Text>:null}
    {page.curator.avatarUrl?<Image source={{uri:page.curator.avatarUrl}} style={{width:48,height:48,borderRadius:24}} accessibilityLabel={`@${page.curator.username}`}/>:null}
    <Text style={typeStyle(tokens,'sectionTitle')}>Curated by @{page.curator.username}</Text>
    <Text style={typeStyle(tokens,'bodyMuted')}>{page.counts.products} Products · {page.counts.places} Places</Text>
    <ProfileContentTabs tabs={[{id:'products',label:'Products'},{id:'places',label:'Places'}]} active={tab} onChange={next=>setTab(next as typeof tab)}/>
   </View>
   <FlatList key={`${columns}:${tab}`} data={page.items} numColumns={columns} keyExtractor={item=>`${item.namespace??'place'}:${item.id}`} style={{flex:1}} contentContainerStyle={{padding:10,maxWidth:1100,width:'100%',alignSelf:'center'}}
    refreshing={busy} onRefresh={()=>void load()} onEndReached={()=>{if(page.nextCursor&&!busy)void load(page.nextCursor);}} onEndReachedThreshold={0.5}
    ListEmptyComponent={<Text style={[typeStyle(tokens,'bodyMuted'),{padding:16}]}>No {tab} published yet.</Text>}
    renderItem={({item})=><View style={{flex:1/columns,padding:6}}>{tab==='products'?<ProductCard publicRead product={catalogViewFromProductPage({productId:item.id,shoppingProductId:item.namespace==='catalog'?item.id:null,title:item.title,brand:item.brand??null,category:null,heroImage:item.image??null,galleryImages:[],price:null,currency:null,merchant:null,description:null,specifications:{},offers:[],canShop:false,source:null,relatedMedia:[],reviews:null,compareAvailable:false,detailsUpdating:false})} variant="related" onPress={()=>open(item)}/>:<PlaceCard publicRead onPress={()=>open(item)} item={{kind:'resolved',id:item.id,name:item.title,category:item.category??null,localityLabel:[item.city,item.country].filter(Boolean).join(', '),formattedAddress:null,image:null,destination:{kind:'google_search',query:item.title,url:`https://www.google.com/search?q=${encodeURIComponent([item.title,item.city,item.country].filter(Boolean).join(' '))}`}}} onSearch={url=>void Linking.openURL(url)} media={<PublicPlaceImage stash={id} id={item.id} name={item.title} preview={preview} style={{width:'100%',aspectRatio:1,borderRadius:tokens.radius.md}}/>}/>}</View>}/>
  </>}
  <PublicAppActions path={`/stash/${id}`}/>
 </View>;
}
