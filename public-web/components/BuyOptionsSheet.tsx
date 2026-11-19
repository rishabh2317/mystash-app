import React,{useEffect,useId,useRef,useState} from 'react';
import {resolveShopOption,type ShopOptions} from './editorialActions';
import {productPagePriceLabel} from '@/src/ui/productPage';
import type {StashItem} from '@/src/services/publicStashApi';

/** Browser-only modal. Native dialog provides focus containment and focus restoration. */
export function BuyOptionsSheet({item,options,onClose}:{item:StashItem;options:ShopOptions;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement|null>(null),controller=useRef<AbortController|null>(null),pending=useRef(false);
 const [opening,setOpening]=useState<string|null>(null),[error,setError]=useState(''),label=useId();
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>{controller.current?.abort();element?.close();};},[]);
 const close=()=>{controller.current?.abort();onClose();};
 const buy=async(id:string)=>{if(pending.current)return;pending.current=true;setOpening(id);setError('');const abort=new AbortController();controller.current=abort;
  try{const result=await resolveShopOption(options,id,abort.signal);if(result&&!abort.signal.aborted)window.location.assign(result.url);else if(!abort.signal.aborted)setError('This option is no longer available.');}
  catch{if(!abort.signal.aborted)setError('Couldn’t open this option. Please try again or view the product.');}
  finally{if(!abort.signal.aborted){pending.current=false;setOpening(null);}}
 };
 return <dialog ref={dialog} className="stash-buy-sheet" aria-labelledby={label} onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}}}>
  <div className="stash-sheet-handle" aria-hidden="true"/>
  <header className="stash-sheet-heading"><div><p>FIND YOUR FAVOURITE</p><h2 id={label}>Buy options</h2></div><button type="button" className="stash-sheet-close" onClick={close} aria-label="Close buy options" autoFocus>×</button></header>
  <div className="stash-sheet-product">{item.image?<img src={item.image} alt="" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>:null}<div><h3>{item.title}</h3><p>{options.offers.length} buying options{options.country?` · Shopping in ${options.country}`:''}</p></div></div>
  <div className="stash-sheet-offers">{options.offers.map(offer=><button type="button" key={offer.id} className="stash-sheet-offer" onClick={()=>void buy(offer.id)} disabled={opening!==null} aria-label={`Buy at ${offer.merchant||'Store'}`}><span className="stash-sheet-store"><strong>{offer.merchant||'Store'}</strong><span>{offer.availability?.replace(/_/g,' ')||'View availability at store'}</span></span><span className="stash-sheet-price"><strong>{productPagePriceLabel(offer)||'View price'}</strong><span>{opening===offer.id?'Opening…':offer.action==='listing'?'View at store ↗':'Buy now ↗'}</span></span></button>)}</div>
  <p className="stash-sheet-error" role="status" aria-live="polite">{error}</p><p className="stash-sheet-note">Prices and availability may change. Confirm details at the store.</p>
 </dialog>;
}
