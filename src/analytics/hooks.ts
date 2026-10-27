import { ExposureDwell,visibleFraction } from './visibility';
import { useEffect,useRef,useSyncExternalStore } from 'react';
import { AppState, useWindowDimensions, type View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AnalyticsEvent } from '@/backend/src/analytics/contracts';
import { analyticsSnapshot,subscribeAnalytics,recordOnce } from './client';
export const analyticsSurface=(path:string)=>path.includes('search')?'search':path.includes('product')?'product':path.includes('creator')||path.includes('profile')?'creator':path.includes('stash')||path.includes('cart')||path.includes('bag')?'stash':path.includes('collection')?'collection':path==='/'||path.includes('reel')?'watch':'other';
export function useMeasuredOpen(name:AnalyticsEvent['event_name'],type:AnalyticsEvent['entity_type'],id:string|undefined,extra:Partial<AnalyticsEvent>={}){
  const state=useSyncExternalStore(subscribeAnalytics,analyticsSnapshot,analyticsSnapshot),focused=useIsFocused(),path=usePathname();
  const namespace=extra.namespace,collectionId=extra.collection_id;
  useEffect(()=>{if(state.enabled&&state.generation===analyticsSnapshot().generation&&focused&&id)recordOnce(name,type,id,analyticsSurface(path),{namespace,collection_id:collectionId});},
    [state.enabled,state.generation,focused,id,name,type,path,namespace,collectionId]);
}
type Candidate={ref:React.RefObject<View|null>;run:(fraction:number,now:number)=>void;top:number;bottom:number;right:number;visibleSince:number|null;dwell:ExposureDwell};
const candidates=new Set<Candidate>();let timer:ReturnType<typeof setInterval>|null=null;let cursor=0;let appStateSubscription:{remove():void}|null=null;
function start(){if(timer)return;
  appStateSubscription=AppState.addEventListener('change',()=>{for(const c of candidates){c.visibleSince=null;c.dwell.reset();}});
  timer=setInterval(()=>{const all=[...candidates];if(!all.length){if(timer)clearInterval(timer);timer=null;appStateSubscription?.remove();appStateSubscription=null;return;}
    if(AppState.currentState!=='active'){for(const c of all){c.visibleSince=null;c.dwell.reset();}return;}
    // Bound native measurement work; candidates already visible get priority for continuous dwell.
    const visible=all.filter(c=>c.visibleSince!==null),pending=all.filter(c=>c.visibleSince===null);
    const room=Math.max(0,16-visible.length),rotated=[...pending.slice(cursor),...pending.slice(0,cursor)];
    const batch=[...visible.slice(0,16),...rotated.slice(0,room)];cursor=pending.length?(cursor+Math.max(room,1))%pending.length:0;
    for(const c of batch)c.ref.current?.measureInWindow((x,y,w,h)=>{
      c.run(visibleFraction(x,y,w,h,c.right,c.top,c.bottom),Date.now());
    });
  },500);
}
export function useQualifiedExposure(name:AnalyticsEvent['event_name'],type:AnalyticsEvent['entity_type'],id:string|undefined,extra:Partial<AnalyticsEvent>={}){
  const ref=useRef<View>(null),state=useSyncExternalStore(subscribeAnalytics,analyticsSnapshot,analyticsSnapshot);
  const focused=useIsFocused(),path=usePathname(),{height,width}=useWindowDimensions(),insets=useSafeAreaInsets();
  const namespace=extra.namespace,collectionId=extra.collection_id;
  useEffect(()=>{
    if(!state.enabled||!focused||!id||candidates.size>=128)return;
    let alive=true;
    const c:Candidate={ref,top:insets.top+48,bottom:height-insets.bottom-64,right:width,visibleSince:null,dwell:new ExposureDwell(),run(fraction,now){
      if(!alive||state.generation!==analyticsSnapshot().generation||AppState.currentState!=='active')return;
      const qualified=c.dwell.observe(fraction,true,now);
      c.visibleSince=fraction>=0.5?now:null;
      if(qualified){recordOnce(name,type,id,analyticsSurface(path),{namespace,collection_id:collectionId});candidates.delete(c);}
    }};
    candidates.add(c);start();return()=>{alive=false;candidates.delete(c);};
  },[state.enabled,state.generation,focused,id,name,type,path,namespace,collectionId,height,width,insets.top,insets.bottom]);
  return ref;
}
