import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useFocusEffect, useLocalSearchParams, useRouter, type Href} from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {useAuth} from '@/contexts/AuthContext';
import {queuePublicPhoto} from '@/src/public-stash/photoQueue';
import {readPlaceImageResource, type PlaceImageResource} from '@/backend/src/place/photos/contract';
import {itemPath, collectionHeading, shareCollection, loadShopOptions, resolveShopOption, type ShopOptions} from './editorialActions';
import {BuyOptionsSheet} from './BuyOptionsSheet';
import {useWindowDimensions} from 'react-native';
import {PublicAppActions} from '@/components/public-stash/PublicAppActions';
import {publicStashRequest, PublicStashApiError, type StashItem, type StashPage} from '@/src/services/publicStashApi';
import {useStashMeasurement} from '@/src/public-stash/useStashMeasurement';
import './public-stash-editorial.css';

type Tab = 'products' | 'places';
type LoadState = {scope:string; page?:StashPage; busy:boolean; error?:string};
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function Arrow(){return <span aria-hidden="true">↗</span>;}
function Bookmark(){return <svg viewBox="0 0 24 24" width="21" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>;}
function PublicPhoto({stash,item,preview,href,navigate}:{stash:string;item:StashItem;preview:boolean;href:string;navigate:(event:React.MouseEvent<HTMLAnchorElement>,href:string)=>void}){
 const [resource,setResource]=useState<PlaceImageResource|null>(null),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false);
 const pending=useRef(false),cleanup=useRef<()=>void>(()=>{});
 useEffect(()=>()=>cleanup.current(),[]);
 const request=()=>{if(pending.current)return;pending.current=true;setBusy(true);const controller=new AbortController();
  // Explicit visitor intent, existing bounded queue, and no scroll-triggered requests/retries.
  const release=queuePublicPhoto(async()=>{try{const result=await publicStashRequest<{image:unknown}>(`/public-stashes/${stash}/places/${item.id}/photo?width=640${preview?'&preview=1':''}`,{signal:controller.signal});if(!controller.signal.aborted)setResource(readPlaceImageResource(result.image));}catch{}finally{if(!controller.signal.aborted){setAttempted(true);setBusy(false);pending.current=false;}}});cleanup.current=()=>{controller.abort();release();};
 };
 return resource?<figure className="editorial-provider-photo"><a className="editorial-photo-link" href={href} onClick={event=>navigate(event,href)} aria-label={`Explore ${item.title}`}><img src={resource.uri} alt={`Photo of ${item.title}`} referrerPolicy="no-referrer" onError={()=>{setResource(null);setAttempted(true);}}/></a><figcaption><a href={resource.attribution.sourceUrl} target="_blank" rel="noreferrer"><img src="/home/media/attribution/google-maps-dark.png" alt="Google Maps"/></a>{resource.attribution.authors.map((author,index)=><span key={index}>{author.url?<a href={author.url} target="_blank" rel="noreferrer">{author.name}</a>:author.name}</span>)}{resource.attribution.providers.map((provider,index)=><span key={index}>{provider.url?<a href={provider.url} target="_blank" rel="noreferrer">{provider.name}</a>:provider.name}</span>)}{resource.attribution.reportUrl?<a href={resource.attribution.reportUrl} target="_blank" rel="noreferrer">Report photo</a>:null}</figcaption></figure>:<div className="editorial-photo-placeholder"><span className="editorial-location" aria-hidden="true">⌖</span><span>{[item.city,item.country].filter(Boolean).join(', ')||'A place worth discovering'}</span><button type="button" disabled={busy} className="editorial-photo-button" onClick={request} aria-label={`Show photo of ${item.title}`}>{busy?'Loading photo…':attempted?'Try photo again':'Show photo'} <Arrow/></button>{attempted&&!busy?<span role="status">Photo unavailable. Explore for place details.</span>:null}</div>;
}
type CardProps={item:StashItem;index:number;tab:Tab;stash:string;preview:boolean;visitor:string;navigate:(event:React.MouseEvent<HTMLAnchorElement>,href:string)=>void};
function EditorialCard({item,index,tab,stash,preview,visitor,navigate}:CardProps){
 const [imageFailed,setImageFailed]=useState(false),[ratio,setRatio]=useState<number|null>(null),[shopping,setShopping]=useState(false),[shopError,setShopError]=useState(''),[sheet,setSheet]=useState<ShopOptions|null>(null),href=itemPath(stash,tab,item,preview);
 const controller=useRef<AbortController|null>(null),pending=useRef(false),shopButton=useRef<HTMLButtonElement|null>(null),returnFocus=useRef(false);
 useEffect(()=>()=>{controller.current?.abort();},[]);
 useEffect(()=>{if(!sheet&&returnFocus.current){returnFocus.current=false;shopButton.current?.focus();}},[sheet]);
 const shop=async()=>{if(pending.current)return;pending.current=true;setShopping(true);setShopError('');const abort=new AbortController();controller.current=abort;
  try{const options=await loadShopOptions(stash,item,visitor,abort.signal);if(abort.signal.aborted)return;
   if(options.presentation==='sheet'){returnFocus.current=true;setSheet(options);return;}
   const result=await resolveShopOption(options,options.presentation==='direct'?options.offers[0].id:undefined,abort.signal);
   if(!abort.signal.aborted)window.location.assign(result?.url||href);
  }catch{if(!abort.signal.aborted)setShopError('Shopping unavailable. Open the product for details.');}
  finally{if(!abort.signal.aborted){pending.current=false;setShopping(false);}}
 };
 return <article className="editorial-card">
  <div className={`editorial-photo ${tab==='products'?'editorial-product-photo':''}`} style={tab==='products'?{aspectRatio:ratio??4/5}:undefined}>
   {tab==='places'?<PublicPhoto stash={stash} item={item} preview={preview} href={href} navigate={navigate}/>:<a className="editorial-photo-link" href={href} onClick={event=>navigate(event,href)} aria-label={`View ${item.title}`}>
    {item.image&&!imageFailed?<img src={item.image} alt={item.title} loading={index<6?'eager':'lazy'} decoding="async" onLoad={event=>{const image=event.currentTarget;if(image.naturalHeight)setRatio(image.naturalWidth/image.naturalHeight);}} onError={()=>setImageFailed(true)}/>:<span className="editorial-photo-placeholder"><Bookmark/><span>Image unavailable</span></span>}
   </a>}
   <div className="stash-pin-actions">{tab==='products'&&!preview?<button ref={shopButton} type="button" className="stash-pin-shop" disabled={shopping} onClick={()=>void shop()} aria-label={`Shop ${item.title}`}>{shopping?'Finding options…':'Shop'} <Arrow/></button>:null}<a className="stash-pin-view" href={href} onClick={event=>navigate(event,href)} aria-label={`View details for ${item.title}`}>{tab==='products'?'View':'Explore'} <Arrow/></a></div>
  </div>
  <div className="editorial-card-caption"><h2><a href={href} onClick={event=>navigate(event,href)} title={item.title}>{item.title}</a></h2><p className="editorial-item-category">{tab==='products'?(item.brand||'Product'):[item.category||'Place',item.city,item.country].filter(Boolean).join(' · ')}</p>{shopError?<p role="status" className="editorial-shop-error">{shopError}</p>:null}</div>
  {sheet?<BuyOptionsSheet item={item} options={sheet} onClose={()=>setSheet(null)}/>:null}
 </article>;
}
function Masonry({items,...props}:Omit<CardProps,'item'|'index'>&{items:StashItem[]}){
 const {width}=useWindowDimensions(),columns=width>=1200?5:width>=950?4:width>=650?3:2;
 return <div className="editorial-grid" style={{gridTemplateColumns:`repeat(${columns},minmax(0,1fr))`}}>{Array.from({length:columns},(_,column)=><div className="stash-pin-column" key={column}>{items.map((item,index)=>index%columns===column?<EditorialCard key={`${props.tab}:${item.namespace??'place'}:${item.id}`} {...props} item={item} index={index}/>:null)}</div>)}</div>;
}
export default function PublicStashEditorial(){
 const params=useLocalSearchParams<{publicId:string;tab?:string;preview?:string}>(),id=String(params.publicId),preview=params.preview==='1',tab:Tab=params.tab==='places'?'places':'products';
 const {user}=useAuth(),router=useRouter(),scope=`${id}:${preview}:${user?.id??'guest'}`;
 const [states,setStates]=useState<Partial<Record<Tab,LoadState>>>({}),[shareStatus,setShareStatus]=useState(''),[shareTools,setShareTools]=useState(false),[profile,setProfile]=useState<{scope:string;username:string;displayName:string|null;bio:string|null}|null>(null);
 const generation=useRef(0),abort=useRef<AbortController|null>(null),inflight=useRef(false),main=useRef<HTMLElement|null>(null);
 const state=states[tab]?.scope===scope?states[tab]:undefined,page=state?.page;
 const metadata=page??Object.values(states).find(value=>value?.scope===scope&&value.page)?.page;
 const username=metadata?.curator.username,publicProfile=profile?.scope===scope&&profile.username===username?profile:null,title=collectionHeading(username,publicProfile?.displayName);
 useEffect(()=>{if(!username)return;let alive=true;const controller=new AbortController();
  void publicStashRequest<{user:{username:string;displayName:string|null;bio:string|null}}>(`/users/by-username/${encodeURIComponent(username)}`,{signal:controller.signal}).then(({user:value})=>{if(alive&&value?.username?.toLowerCase()===username.toLowerCase())setProfile({scope,username,displayName:typeof value.displayName==='string'?value.displayName:null,bio:typeof value.bio==='string'?value.bio:null});}).catch(()=>{});
  return()=>{alive=false;controller.abort();};
 },[scope,username]);

 const load=useCallback(async(cursor?:string)=>{
  if(cursor&&inflight.current)return;
  abort.current?.abort();const controller=new AbortController();abort.current=controller;inflight.current=true;const ticket=++generation.current;
  setStates(old=>({...old,[tab]:{scope,...(cursor&&old[tab]?.scope===scope?{page:old[tab]?.page}:{}),busy:true}}));
  try{
   if(!validId.test(id))throw Error('Stash unavailable');
   const next=await publicStashRequest<StashPage>(`/public-stashes/${id}?tab=${tab}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}${preview?'&preview=1':''}`,{signal:controller.signal});
   if(ticket===generation.current)setStates(old=>({...old,[tab]:{scope,busy:false,page:{...next,items:cursor&&old[tab]?.page?[...old[tab]!.page!.items,...next.items].filter((item,index,all)=>all.findIndex(other=>other.id===item.id&&other.namespace===item.namespace)===index):next.items}}}));
  }catch(error){if(ticket===generation.current&&!controller.signal.aborted){
   if(!cursor||(error instanceof PublicStashApiError&&error.status===404))setStates({[tab]:{scope,busy:false,error:'This Stash may be private or no longer available.'}});
   else setStates(old=>({...old,[tab]:{...old[tab]!,scope,busy:false,error:'Couldn’t load more. Please try again.'}}));
  }}finally{if(ticket===generation.current)inflight.current=false;}
 },[id,preview,scope,tab]);
 useFocusEffect(useCallback(()=>{void load();return()=>{generation.current++;abort.current?.abort();inflight.current=false;};},[load]));
 useEffect(()=>{const visible=()=>{if(document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',visible);return()=>{document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',visible);};},[load]);
 useEffect(()=>{setShareStatus('');setShareTools(false);main.current?.scrollTo({top:0});},[scope,tab]);
 useStashMeasurement(page?.publicId,'stash',undefined,undefined,preview);
 const navigate=(event:React.MouseEvent<HTMLAnchorElement>,href:string)=>{if(!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();router.push(href as Href);}};
 const tabPath=(next:Tab)=>`/stash/${encodeURIComponent(id)}?tab=${next}${preview?'&preview=1':''}`;
 const copy=async()=>{setShareStatus(await shareCollection(id,'Public Stash',undefined,async text=>{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else await Clipboard.setStringAsync(text);}));};
 const share=async()=>{setShareTools(true);setShareStatus('');setShareStatus(await shareCollection(id,title,navigator.share?.bind(navigator),async text=>{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else await Clipboard.setStringAsync(text);}));};
 return <main ref={main} className="public-stash-web" aria-label="Public Stash"><div className="editorial-page-top"><a href="/" aria-label="Mystash home"><img src="/home/media/favicon-sage-cream-v3.svg" alt=""/>mystash</a><a className="stash-back-link" href="/" onClick={event=>{if(window.history.length>1){event.preventDefault();router.back();}}}>← Back</a><a href="#public-stash-content" className="editorial-skip">Skip to collection</a></div>
  <section className="editorial-sheet" aria-labelledby="editorial-stash-title">
   <header className="editorial-header"><div className="editorial-curator-avatar">{metadata?.curator.avatarUrl?<img src={metadata.curator.avatarUrl} alt={`@${username}`} onError={event=>{event.currentTarget.style.display='none';}}/>:null}<span aria-hidden="true">{(publicProfile?.displayName?.trim()||username)?.slice(0,1).toUpperCase()||'M'}</span></div><div className="editorial-header-copy"><p className="editorial-eyebrow">Public Stash{preview?' · Private preview':''}</p><h1 id="editorial-stash-title">{title}</h1><p className="editorial-attribution">{username?`@${username}`:'A little collection, all your own.'}</p>{publicProfile?.bio?.trim()?<p className="stash-profile-bio">{publicProfile.bio}</p>:null}{metadata?<p className="editorial-counts">{metadata.counts.products} {metadata.counts.products===1?'product':'products'} · {metadata.counts.places} {metadata.counts.places===1?'place':'places'}</p>:null}</div>{metadata&&!preview?<button type="button" className="editorial-share" onClick={()=>void share()}>Share <Arrow/></button>:null}</header>
   {preview?<p className="stash-preview-notice">Only you can see this preview</p>:null}<div className="editorial-share-feedback"><p className="editorial-share-status" role="status" aria-live="polite">{shareStatus}</p>{shareTools?<button type="button" className="editorial-copy-link" onClick={()=>void copy()}>Copy link</button>:null}</div>
   <div className="editorial-tabs" role="tablist" aria-label="Published discoveries">{(['products','places'] as const).map((value,index)=><a key={value} id={`editorial-tab-${value}`} role="tab" aria-selected={tab===value} aria-controls="public-stash-content" tabIndex={tab===value?0:-1} href={tabPath(value)} onClick={event=>navigate(event,tabPath(value))} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'products':event.key==='End'?'places':index===0?'places':'products';document.getElementById(`editorial-tab-${next}`)?.focus();router.push(tabPath(next) as Href);}}}>{value==='products'?'Products':'Places'}</a>)}</div>
   <div id="public-stash-content" role="tabpanel" aria-labelledby={`editorial-tab-${tab}`} tabIndex={0} aria-busy={state?.busy??true}>
    {state?.error&&!page?<div className="editorial-empty" role="alert"><h2>Stash unavailable</h2><p>{state.error}</p><button onClick={()=>void load()}>Try again</button></div>:!page?<div className="editorial-loading" role="status"><span/>Gathering the good finds…</div>:page.items.length?<Masonry items={page.items} tab={tab} stash={id} preview={preview} visitor={user?.id??'guest'} navigate={navigate}/>:<div className="editorial-empty"><Bookmark/><h2>A little room for what’s next.</h2><p>No {tab} published yet.</p></div>}
    {page&&state?.error?<p className="editorial-inline-error" role="alert">{state.error}</p>:null}
    {page?.nextCursor?<div className="editorial-pagination"><button disabled={state?.busy} onClick={()=>void load(page.nextCursor!)}>{state?.busy?'Gathering…':'More good finds'} <span aria-hidden="true">↓</span></button></div>:null}
   </div>
   <footer className="editorial-sheet-footer"><p>A few good finds, shared.</p><Bookmark/></footer>
  </section><div className="editorial-bottom"><p>Good taste. All together.</p><PublicAppActions path={`/stash/${id}`}/></div>
 </main>;
}
