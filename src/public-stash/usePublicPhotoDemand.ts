import {useEffect,useState} from 'react';
import {Platform} from 'react-native';
import {useVisibleResource} from '@/src/ui/useVisibleResource';

/** Web demand follows DOM intersection; native keeps its existing focus/measurement policy. */
export function usePublicPhotoDemand(){
 const native=useVisibleResource(Platform.OS!=='web');
 const [nearViewport,setNearViewport]=useState(false);
 useEffect(()=>{
  if(Platform.OS!=='web')return;
  const element=native.ref.current as unknown as Element|null;
  if(!element)return;
  if(typeof IntersectionObserver==='undefined'){setNearViewport(true);return;}
  let current=true;
  const observer=new IntersectionObserver(entries=>{
   if(current)setNearViewport(entries.some(entry=>entry.isIntersecting));
  },{rootMargin:'200px',threshold:0});
  observer.observe(element);
  return()=>{current=false;observer.disconnect();};
 },[native.ref]);
 return {...native,visible:Platform.OS==='web'?nearViewport:native.visible};
}
