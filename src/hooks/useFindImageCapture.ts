import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Linking} from 'react-native';
import {useAuth} from '@/contexts/AuthContext';
import {captureCapabilities} from '@/src/services/captureRuntime';
import {captureDeviceImage} from '@/src/services/imageCaptureDevice';
import {ImageCaptureError,type CaptureOrigin} from '@/src/services/imageCapture';
import {observeFind} from '@/src/analytics/findMeasurement';
export function useFindImageCapture(){
  const {user}=useAuth(),owner=user?.id??null,latest=useRef(owner),busyRef=useRef(false);latest.current=owner;
  const [supported,setSupported]=useState(false),[result,setResult]=useState<{owner:string;queued:boolean;message:string;settings:boolean}|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{let mounted=true;const check=()=>{void captureCapabilities().then(c=>{if(mounted)setSupported(c.images);});};check();const sub=AppState.addEventListener('change',s=>{if(s==='active')check();});return()=>{mounted=false;sub.remove();};},[]);
  const capture=useCallback(async(origin:CaptureOrigin)=>{
    if(busyRef.current)return;if(!owner)return;
    busyRef.current=true;setBusy(true);setResult(null);
    observeFind(owner,'find.capture_action_chosen',{origin});
    try{const queued=await captureDeviceImage(origin,owner,()=>latest.current===owner);if(latest.current===owner){observeFind(owner,queued?'find.capture_submitted':'find.capture_cancelled',{origin});if(queued)setResult({owner,queued:true,message:'Securely queued on this device. We’ll send it when you’re connected.',settings:false});}}
    catch(error){if(latest.current===owner)setResult({owner,queued:false,message:error instanceof ImageCaptureError?error.message:'Couldn’t securely save this image. Please try again.',settings:error instanceof ImageCaptureError&&error.kind==='settings'});}
    finally{busyRef.current=false;setBusy(false);}
  },[owner]);
  return{supported,busy,result:result?.owner===owner?result:null,capture,openSettings:()=>Linking.openSettings().catch(()=>{})};
}
