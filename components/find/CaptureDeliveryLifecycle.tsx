import {useEffect} from 'react';
import {AppState} from 'react-native';
import {useAuth} from '@/contexts/AuthContext';
import {captureCapabilities,captureDelivery} from '@/src/services/captureRuntime';
import {pendingNativeShares,syncNativeShareSession,notifyPendingShares} from '@/src/services/nativeShare';
/** Foreground delivery only for images. Native URL delivery keeps its existing lifecycle. */
export function CaptureDeliveryLifecycle(){
  const {session}=useAuth();
  useEffect(()=>{
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,lastURLs='',synced=false,cycle=0;
    const stop=()=>{cycle++;captureDelivery.configure(null);if(timer)clearTimeout(timer);};
    async function tick(){
      if(disposed||AppState.currentState!=='active'||!session)return;
      const token=cycle;
      try{
        if(!synced){await syncNativeShareSession(session);synced=true;}
        if(disposed||token!==cycle||AppState.currentState!=='active')return;
        const caps=await captureCapabilities();if(disposed||token!==cycle||AppState.currentState!=='active')return;
        captureDelivery.configure(caps.images?session.user.id:null);
        await captureDelivery.pump();
        const urls=await pendingNativeShares(session.user.id),signature=JSON.stringify(urls.map(r=>[r.id,r.state]));
        if(!disposed&&token===cycle&&signature!==lastURLs){lastURLs=signature;notifyPendingShares();}
      }catch{/* Offline or identity changes leave encrypted records intact. */}
      finally{if(!disposed&&token===cycle&&AppState.currentState==='active')timer=setTimeout(()=>void tick(),15000);}
    }
    const app=AppState.addEventListener('change',value=>{stop();synced=false;if(value==='active')void tick();});
    void tick();return()=>{disposed=true;stop();app.remove();};
  },[session]);
  return null;
}
