import AsyncStorage from '@react-native-async-storage/async-storage';
import {analyticsHeaders} from '@/src/analytics/client';
import {newEventId} from '@/src/services/newEventId';
import {publicStashRequest, publicStashUrl, type StashItem} from '@/src/services/publicStashApi';
import {shoppableProductOffers, feedShopPresentation} from '@/src/ui/feedShop';
import type {ProductPageView} from '@/src/types/productPage';
export type EditorialTab='products'|'places';
export function itemPath(stash:string,tab:EditorialTab,item:StashItem,preview:boolean){
 return `/stash/${encodeURIComponent(stash)}/${tab==='products'?`products/${item.namespace==='catalog'?'catalog':'discovered'}/${encodeURIComponent(item.id)}`:`places/${encodeURIComponent(item.id)}`}${preview?'?preview=1':''}`;
}
export function collectionHeading(username:string|undefined,displayName:string|null|undefined){
 const firstName=displayName?.trim().split(/\s+/u)[0];
 return firstName?`${firstName}’s Stash`:username?`@${username}’s Stash`:'Public Stash';
}
export type ShopOptions={base:string;query:string;country:string;offers:ProductPageView['offers'];discovery:boolean;presentation:'direct'|'sheet'|'fallback'};
/** Same offer filtering and single/multiple presentation rules as the native feed. */
export async function loadShopOptions(stash:string,item:StashItem,visitor:string,signal?:AbortSignal):Promise<ShopOptions>{
 const base=`/public-stashes/${encodeURIComponent(stash)}/products/${item.namespace==='catalog'?'catalog':'discovered'}/${encodeURIComponent(item.id)}`;
 const stored=await AsyncStorage.getItem(`mystash.publicStash.country.${visitor}`).catch(()=>null);
 const country=stored&&/^[A-Z]{2}$/.test(stored)?stored:'',locale=Intl.DateTimeFormat().resolvedOptions().locale;
 const query=`country=${country}&locale=${encodeURIComponent(locale)}`;
 const page=await publicStashRequest<ProductPageView & {commerceCountry?:string}>(`${base}/page?${query}`,{signal});
 const offers=shoppableProductOffers(page.offers);
 return {base,query,country:page.commerceCountry||country,offers,discovery:!!page.discovery,presentation:feedShopPresentation(offers.length)};
}
/** Only an explicitly selected, authorized offer may be resolved. Affiliate routing stays server-side. */
export async function resolveShopOption(options:ShopOptions,offerId?:string,signal?:AbortSignal){
 if(offerId?!options.offers.some(offer=>offer.id===offerId):!options.discovery)return null;
 const eventId=newEventId(),choice=offerId?`offerId=${encodeURIComponent(offerId)}`:'discovery=1';
 return publicStashRequest<{url:string}>(`${options.base}/outbound?format=json&${options.query}&${choice}&eventId=${eventId}`,{signal,headers:{...analyticsHeaders(),'x-mystash-outbound-id':eventId}});
}
export async function shareCollection(id:string,title:string,share:((data:ShareData)=>Promise<void>)|undefined,copy:(text:string)=>Promise<void>){
 const url=publicStashUrl(id);
 if(share){try{await share({title,url});return 'Shared.';}catch(error){if(error instanceof Error&&error.name==='AbortError')return '';}}
 try{await copy(url);return 'Link copied.';}catch{return `Copy this link: ${url}`;}
}
