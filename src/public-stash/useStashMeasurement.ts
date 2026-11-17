import {useEffect,useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {analyticsSnapshot,subscribeAnalytics,enqueueObservation} from '@/src/analytics/client';
export function useStashMeasurement(stash:string|undefined,kind:'stash'|'product'|'place',id?:string,namespace?:'catalog'|'discovered',preview=false){
 const state=useSyncExternalStore(subscribeAnalytics,analyticsSnapshot,analyticsSnapshot),focused=useIsFocused();
 useEffect(()=>{
  if(!stash||preview||!state.enabled||!focused||(kind!=='stash'&&!id))return;
  let timer:ReturnType<typeof setTimeout>|undefined,sent=false;
  const schedule=()=>{if(timer)clearTimeout(timer);if(AppState.currentState!=='active'||sent)return;
   timer=setTimeout(()=>{if(typeof document!=='undefined'&&document.visibilityState!=='visible')return;sent=true;
    enqueueObservation(kind==='stash'?'stash.opened':kind==='product'?'product.opened':'place.opened',kind==='stash'?'app':kind,id,'public_stash',{public_stash_id:stash},kind==='product'?{namespace:namespace??'catalog'}:{});
   },kind==='stash'?1000:0);
  };
  schedule();const sub=AppState.addEventListener('change',schedule);
  return()=>{if(timer)clearTimeout(timer);sub.remove();};
 },[stash,kind,id,namespace,preview,state.enabled,state.generation,focused]);
}
