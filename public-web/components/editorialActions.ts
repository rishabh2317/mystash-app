import AsyncStorage from '@react-native-async-storage/async-storage';
import {analyticsHeaders} from '@/src/analytics/client';
import {newEventId} from '@/src/services/newEventId';
import {publicStashRequest, publicStashUrl, type StashItem} from '@/src/services/publicStashApi';
import type {ProductPageView} from '@/src/types/productPage';
export type EditorialTab='products'|'places';
export function itemPath(stash:string,tab:EditorialTab,item:StashItem,preview:boolean){
 return `/stash/${encodeURIComponent(stash)}/${tab==='products'?`products/${item.namespace==='catalog'?'catalog':'discovered'}/${encodeURIComponent(item.id)}`:`places/${encodeURIComponent(item.id)}`}${preview?'?preview=1':''}`;
}
/** Select only a stored, ordered buying option. No card-level search or pricing work. */
export function shoppingSelection(page:Pick<ProductPageView,'offers'|'discovery'>):{offerId:string}|{discovery:true}|null{
 const offer=page.offers.find(row=>row.action==='buy'||row.action==='listing');
 return offer?{offerId:offer.id}:page.discovery?{discovery:true}:null;
}
/** Resolve via the same authorized product/outbound routes used by Product Page. */
export async function shopDestination(stash:string,item:StashItem,visitor:string){
 const base=`/public-stashes/${encodeURIComponent(stash)}/products/${item.namespace==='catalog'?'catalog':'discovered'}/${encodeURIComponent(item.id)}`;
 const stored=await AsyncStorage.getItem(`mystash.publicStash.country.${visitor}`).catch(()=>null);
 const country=stored&&/^[A-Z]{2}$/.test(stored)?stored:'',locale=Intl.DateTimeFormat().resolvedOptions().locale;
 const query=`country=${country}&locale=${encodeURIComponent(locale)}`;
 const page=await publicStashRequest<ProductPageView>(`${base}/page?${query}`),selection=shoppingSelection(page);
 if(!selection)return null;
 const eventId=newEventId(),choice='offerId' in selection?`offerId=${encodeURIComponent(selection.offerId)}`:'discovery=1';
 return publicStashRequest<{url:string}>(`${base}/outbound?format=json&${query}&${choice}&eventId=${eventId}`,{headers:{...analyticsHeaders(),'x-mystash-outbound-id':eventId}});
}
export async function shareCollection(id:string,title:string,share:((data:ShareData)=>Promise<void>)|undefined,copy:(text:string)=>Promise<void>){
 const url=publicStashUrl(id);
 if(share){try{await share({title,url});return 'Shared.';}catch(error){if(error instanceof Error&&error.name==='AbortError')return '';}}
 try{await copy(url);return 'Link copied.';}catch{return `Copy this link: ${url}`;}
}
