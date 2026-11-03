import NativeShare from '@/modules/mystash-share';
import type {PendingImage} from '@/modules/mystash-share';
import {nativeSharingEnabled,notifyPendingShares} from './nativeShare';
import {supabase} from './supabase';
import {isAuthEmailVerified} from '../auth/emailVerified';
import {createCaptureDelivery,type ImageOutbox} from './captureDelivery';
import {createCaptureTransport} from './captureTransport';
// Missing methods mean an older binary or Expo Go. Never substitute plaintext storage.
export async function captureCapabilities(){
  if(!nativeSharingEnabled()||!NativeShare?.captureCapabilities)return{urls:false,images:false};
  try{const caps=await NativeShare.captureCapabilities();return{urls:caps.version===1&&caps.urls===true&&!!NativeShare.enqueueUrl,
    images:caps.version===1&&caps.images===true&&!!NativeShare.enqueueImage&&!!NativeShare.listImages&&!!NativeShare.imageBytes&&!!NativeShare.updateImage&&!!NativeShare.removeImage};}
  catch{return{urls:false,images:false};}
}
const decode=(value:PendingImage|string):PendingImage=>typeof value==='string'?JSON.parse(value):value;
export const imageOutbox:ImageOutbox={
  list:async owner=>NativeShare?.listImages?(await NativeShare.listImages(owner)).map(decode).sort((a,b)=>a.createdAt-b.createdAt):[],
  bytes:async(id,owner)=>{if(!NativeShare?.imageBytes)throw Error('Secure capture unavailable');return NativeShare.imageBytes(id,owner);},
  update:async(id,owner,patch)=>{if(!NativeShare?.updateImage)throw Error('Secure capture unavailable');await NativeShare.updateImage(id,owner,patch);},
  remove:async(id,owner)=>{if(!NativeShare?.removeImage)throw Error('Secure capture unavailable');await NativeShare.removeImage(id,owner);},
};
const transport=createCaptureTransport({base:()=>process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL,storage:()=>process.env.EXPO_PUBLIC_SUPABASE_URL,fetch:(...args)=>fetch(...args),session:async()=>{
  const {data}=await supabase.auth.getSession();const s=data.session;return s&&isAuthEmailVerified(s.user)?{userId:s.user.id,accessToken:s.access_token}:null;
}});
export const captureDelivery=createCaptureDelivery(imageOutbox,transport,notifyPendingShares);
export async function enqueueFindUrl(url:string,owner:string){
  if(!NativeShare?.enqueueUrl)throw Error('Secure capture needs an updated Mystash installation.');
  const result=await NativeShare.enqueueUrl(url,owner);notifyPendingShares();return{captureId:result.id,created:true};
}
export async function enqueueFindImage(uri:string,origin:'camera'|'gallery',owner:string){
  if(!NativeShare?.enqueueImage)throw Error('Secure capture needs an updated Mystash installation.');
  const row=decode(await NativeShare.enqueueImage(uri,origin,owner));notifyPendingShares();void captureDelivery.pump();return row;
}
export async function retryImageCaptures(owner:string){
  // Native list checks the caller's current identity. State changes stay inside
  // the serialized drainer so a retry cannot downgrade a concurrent acceptance.
  await imageOutbox.list(owner);await captureDelivery.pump(true);
}
