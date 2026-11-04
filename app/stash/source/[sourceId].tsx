import React,{useCallback,useRef,useState} from 'react';
import {Alert,FlatList,Linking,Pressable,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useFocusEffect,useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {TopBar} from '@/components/chrome/TopBar';
import {FeedProductSheet} from '@/components/feed/FeedProductSheet';
import {FindImage} from '@/components/find/FindImage';
import {ActionButton} from '@/components/ui/ActionButton';
import {Text} from '@/components/ui/Text';
import {useAuth} from '@/contexts/AuthContext';
import {useCartOptional} from '@/contexts/CartContext';
import {useThemeMode} from '@/contexts/ThemeContext';
import {findApi} from '@/src/services/findApi';
import type {FindSourceResult} from '@/src/services/findClient';
import {fetchAllPlaces} from '@/src/services/placesApi';
import {findPlaceDestination} from '@/src/ui/findDetail';
import {productPagePath} from '@/src/ui/productPage';
import {outlineCardChrome} from '@/src/theme/tokens';
import {typeStyle} from '@/src/theme/typography';
import type {Product} from '@/src/mocks/videos';

export default function StashSourceScreen(){
  const router=useRouter(),params=useLocalSearchParams<{sourceId:string}>(),id=typeof params.sourceId==='string'?params.sourceId:'';
  const {user}=useAuth(),owner=user?.id??null,{tokens}=useThemeMode(),insets=useSafeAreaInsets(),cart=useCartOptional();
  const [state,setState]=useState<{owner:string|null;id:string;items:FindSourceResult[];cursor:string|null;loading:boolean;more:boolean;error:boolean}>({owner:null,id:'',items:[],cursor:null,loading:true,more:false,error:false});
  const [shopping,setShopping]=useState<Product|null>(null),generation=useRef(0),busy=useRef(false),stateRef=useRef(state);stateRef.current=state;
  const invalidate=useCallback(()=>{generation.current++;busy.current=false;setShopping(null);},[]);
  const load=useCallback(async(append=false)=>{
    if(!owner||!id||busy.current)return;
    busy.current=true;const token=++generation.current;
    setState(previous=>({...previous,owner,id,loading:!append,more:append,error:false}));
    try{const current=stateRef.current,page=await findApi.sourceResults(id,{cursor:append&&current.owner===owner&&current.id===id?current.cursor??undefined:undefined},owner);
      if(token!==generation.current)return;
      setState(previous=>({owner,id,items:append?[...previous.items,...page.items]:page.items,cursor:page.nextCursor,loading:false,more:false,error:false}));
    }catch{if(token===generation.current)setState(previous=>({...previous,owner,id,loading:false,more:false,error:true}));}
    finally{if(token===generation.current)busy.current=false;}
  },[owner,id]);
  useFocusEffect(useCallback(()=>{invalidate();setState({owner,id,items:[],cursor:null,loading:true,more:false,error:false});void load();return invalidate;},[owner,id,load,invalidate]));
  const visible=state.owner===owner&&state.id===id?state.items:[];
  const openPlace=async(row:Extract<FindSourceResult,{kind:'place'}>)=>{
    if(!owner)return;const token=generation.current;
    try{const places=await fetchAllPlaces(()=>token===generation.current);
      if(token!==generation.current)return;
      const destination=findPlaceDestination(places.items,id,row.result.id,row.result.placeId);
      if(!destination)throw Error();await Linking.openURL(destination.url);
    }catch{if(token===generation.current)Alert.alert('Place unavailable','Couldn’t open this place right now.');}
  };
  const remove=(row:FindSourceResult)=>Alert.alert('Remove from My Stash?', 'The discovery will remain in Find history.',[
    {text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>{void (async()=>{try{
      if(row.kind==='place')await findApi.removeResult(id,'places',row.result.id);
      else if('candidateKey' in row.result)await findApi.removeSavedSuggestion(id,row.result.sourceProductId,row.result.candidateKey,row.result.identityKey);
      else await findApi.removeResult(id,'products',row.result.id,row.result.identityKey??undefined);
      await cart?.refresh();await load();
    }catch{Alert.alert('Couldn’t remove item','Please try again.');}})();}}]);
  const productId=(row:Extract<FindSourceResult,{kind:'product'}>)=>row.result.identityKey?.slice(2)??null;
  return <View style={{flex:1,backgroundColor:tokens.color.canvasSoft,paddingLeft:insets.left,paddingRight:insets.right}}>
    <TopBar mode="page" title="Saved from this Find" showBack showBag={false} onBack={()=>router.canGoBack()?router.back():router.replace('/(tabs)/stash' as Href)}/>
    {!owner?<View style={{padding:tokens.space.lg}}><Text style={typeStyle(tokens,'body')}>Sign in to view your saved items.</Text></View>:
    <FlatList data={visible} keyExtractor={row=>`${row.kind}:${row.kind==='product'?row.result.identityKey:row.result.placeId??row.result.id}`}
      contentContainerStyle={{padding:tokens.space.md,paddingBottom:insets.bottom+tokens.space.xl,gap:tokens.space.sm}}
      onRefresh={()=>void load()} refreshing={state.loading&&visible.length>0}
      ListHeaderComponent={<Text style={typeStyle(tokens,'bodyMuted')}>Products and places currently saved from this capture.</Text>}
      ListEmptyComponent={state.loading?<Text style={typeStyle(tokens,'bodyMuted')}>Loading saved items…</Text>:state.error?<ActionButton label="Retry" onPress={()=>void load()}/>:<Text style={typeStyle(tokens,'bodyMuted')}>No saved items remain from this Find.</Text>}
      ListFooterComponent={state.cursor?<ActionButton label={state.more?'Loading…':'Load more'} disabled={state.more} onPress={()=>void load(true)} variant="quiet"/>:null}
      renderItem={({item:row})=>{
        const product=row.kind==='product',productResult=row.kind==='product'?row.result:null,placeResult=row.kind==='place'?row.result:null;
        const shoppingId=row.kind==='product'?productId(row):null;
        return <View style={{...outlineCardChrome(tokens),borderWidth:tokens.stroke.thin,borderRadius:tokens.radius.lg,padding:tokens.space.sm,flexDirection:'row',gap:tokens.space.sm,alignItems:'center'}}>
          {productResult?.imageUrl?<FindImage url={productResult.imageUrl} cacheKey={shoppingId??productResult.title} style={{width:64,height:64,borderRadius:tokens.radius.md}}/>:<View style={{width:64,height:64,borderRadius:tokens.radius.md,backgroundColor:tokens.color.surfaceSubtle,alignItems:'center',justifyContent:'center'}}><Ionicons name={product?'cube-outline':'location-outline'} size={24} color={tokens.color.textMuted}/></View>}
          <View style={{flex:1,gap:tokens.space.xxs}}><Text numberOfLines={2} style={typeStyle(tokens,'tileTitle')}>{productResult?.title??placeResult?.name}</Text>
            {productResult&&shoppingId?<View style={{flexDirection:'row',gap:tokens.space.sm}}><Pressable accessibilityRole="button" onPress={()=>router.push(productPagePath(shoppingId,{userImportId:id}) as Href)} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'link')}>View product</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>setShopping({id:shoppingId,name:productResult.title,image:productResult.imageUrl??'',price:''})} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'link')}>Buy now</Text></Pressable></View>:placeResult?<Pressable accessibilityRole="button" onPress={()=>void openPlace(row as Extract<FindSourceResult,{kind:'place'}>)} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'link')}>View on Google</Text></Pressable>:null}
          </View><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${productResult?.title??placeResult?.name} from My Stash`} onPress={()=>remove(row)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="trash-outline" size={18} color={tokens.color.textMuted}/></Pressable>
        </View>;
      }}/>}<FeedProductSheet video={null} product={shopping} shoppingProductId={shopping?.id} visible={Boolean(shopping)} measurementSurface="find" onClose={()=>setShopping(null)}/>
  </View>;
}
