import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect, type Href } from 'expo-router';
import { TopBar } from '@/components/chrome/TopBar';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { FindDetailView } from '@/components/find/FindDetailView';
import { FeedProductSheet } from '@/components/feed/FeedProductSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useFindDetail } from '@/src/hooks/useFindDetail';
import { findApi } from '@/src/services/findApi';
import { FIND_ROUTES, safeFindUrl } from '@/src/ui/find';
import { typeStyle } from '@/src/theme/typography';
import { productPagePath } from '@/src/ui/productPage';
import {observeFind} from '@/src/analytics/findMeasurement';
import {enqueueObservation} from '@/src/analytics/client';
import { fetchAllPlaces } from '@/src/services/placesApi';
import { findPlaceDestination } from '@/src/ui/findDetail';
import type { Product } from '@/src/mocks/videos';
export default function FindDetailScreen() {
  const router = useRouter(), { tokens } = useThemeMode(), { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ findId: string }>(), id = typeof params.findId === 'string' ? params.findId : '';
  const detail = useFindDetail(id), owner = user?.id ?? null;
  const visibleId=detail.data?.id;
  useFocusEffect(useCallback(()=>{if(visibleId)observeFind(owner,'find.results_opened',{findId:visibleId});},[owner,visibleId]));
  const [shopping,setShopping] = useState<{owner:string;id:string;product:Product}|null>(null);
  const session = useRef({ owner,id, active: false }); session.current.owner = owner; session.current.id = id;
  useEffect(() => { setShopping(null); }, [owner,id]);
  useFocusEffect(useCallback(() => { session.current.active = true; return () => { session.current.active = false; }; }, []));
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvasSoft, paddingLeft: insets.left, paddingRight: insets.right }}>
    <TopBar mode="page" title="Find" showBack onBack={() => router.canGoBack() ? router.back() : router.replace(FIND_ROUTES.home as Href)} />
    {!user && !loading ? <View style={{ padding: tokens.space.lg, gap: tokens.space.md }}><Text style={typeStyle(tokens,'body')}>Sign in to open your Find.</Text><ActionButton wrapLabel minTouchHeight={48} label="Sign in" onPress={() => router.push(FIND_ROUTES.profile)} /></View> : <FindDetailView
      data={detail.data} loading={loading || !detail.loaded} refreshing={detail.refreshing} error={detail.error} actionError={detail.actionError} pending={detail.pending}
      onRefresh={() => { void detail.refresh(); }} onOriginal={() => { const url = safeFindUrl(detail.data?.sourceUrl); if (url) void Linking.openURL(url).catch(() => Alert.alert('Couldn’t open the original link', 'Try again when your connection is available.')); }}
      onStash={segment => router.push(segment === 'places' ? '/stash?segment=places' : '/(tabs)/stash')}
      onProduct={productId => router.push(productPagePath(productId, { contentSourceId: detail.data?.contentSourceId ?? undefined, userImportId: id }) as Href)}
      onShop={row => { if(owner && row.openProductId) setShopping({owner,id,product:{id:row.openProductId,...(row.catalogProductId?{catalog_product_id:row.catalogProductId}:{}),name:row.title,image:row.image??'',price:''}}); }}
      onPlace={row => { const account=owner,record=id; if(!account || !row.membership) return; void (async()=>{
        try { const page=await fetchAllPlaces(()=>session.current.active && session.current.owner===account && session.current.id===record);
          if(!session.current.active || session.current.owner!==account || session.current.id!==record) return;
          const destination=findPlaceDestination(page.items,record,row.membership!.id,row.placeId);
          if(destination) { enqueueObservation('place.outbound_requested',destination.kind==='resolved'?'place':'place_save',destination.id,'find',{destination_kind:'search'}); await Linking.openURL(destination.url); } else Alert.alert('Place unavailable','This place’s destination is not available right now.');
        } catch { if(session.current.active && session.current.owner===account && session.current.id===record) Alert.alert('Place unavailable','Couldn’t open this place. Please try again.'); }
      })(); }}
      onRetry={kind => { void detail.run(`retry:${kind}`, () => findApi.retry(id,kind)); }}
      onRemove={() => Alert.alert('Remove this capture from history?', 'Products and places in My Stash will stay saved.', [{ text: 'Cancel',style: 'cancel' }, { text: 'Remove',style: 'destructive',onPress: () => { void detail.run('remove', () => findApi.remove(id)).then(ok => { if (ok) router.replace(FIND_ROUTES.home as Href); }); } }])}
      onMembership={(row, restore) => {
        const key = row.kind === 'suggestion' ? `selected:${row.id}:${row.candidate}` : `${row.kind === 'places' ? 'place' : 'product'}:${row.id}`;
        void detail.run(key, () => row.kind === 'suggestion'
          ? restore ? findApi.restoreSavedSuggestion(id,row.id,row.candidate!,row.identity!) : findApi.removeSavedSuggestion(id,row.id,row.candidate!,row.identity!)
          : restore ? findApi.restoreResult(id,row.kind,row.id,row.identity) : findApi.removeResult(id,row.kind,row.id,row.identity));
      }}
      onSaveIntent={value => detail.run('intent', () => findApi.updateIntent(id,value))} options={[]} optionsLoaded={false}
      onDecide={(sourceId,key,action) => { void detail.run(`option:${sourceId}:${key}`, () => findApi.decideSuggestion(id,sourceId,key,action)); }}
    />}
    <FeedProductSheet video={null} product={shopping?.owner===owner && shopping.id===id?shopping.product:null} shoppingProductId={shopping?.owner===owner && shopping.id===id?shopping.product.id:undefined} visible={Boolean(owner && shopping?.owner===owner && shopping.id===id)} measurementSurface="find" onClose={()=>setShopping(null)}/>
  </View>;
}
