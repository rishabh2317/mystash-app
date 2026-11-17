import {Platform} from 'react-native';
import {supabase} from './supabase';
import {analyticsHeaders} from '@/src/analytics/client';
import {newEventId} from './newEventId';
export type {StashPage,StashSettings,StashItem,Publication,StashPlace} from '@/backend/src/public-stash/contracts';
export class PublicStashApiError extends Error {constructor(readonly status:number,message:string){super(message);}}
export const publicStashClientEnabled=()=>process.env.EXPO_PUBLIC_PUBLIC_STASH_ENABLED==='true';
export const publicStashUrl=(id:string)=>`https://mystash.in/stash/${encodeURIComponent(id)}`;
export function publicStashBase(){return Platform.OS==='web'?'':process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/,'')??'';}
export async function publicStashRequest<T>(path:string,init:RequestInit={},expectedOwner?:string):Promise<T>{
 const {data}=await supabase.auth.getSession();const session=data.session;
 if(expectedOwner&&session?.user.id!==expectedOwner)throw new PublicStashApiError(409,'Account changed. Try again.');
 const result=await fetch(`${publicStashBase()}${path}`,{...init,cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',...analyticsHeaders(),'x-mystash-action-id':newEventId(),...(session?{Authorization:`Bearer ${session.access_token}`} : {}),...init.headers}});
 if(expectedOwner&&(await supabase.auth.getSession()).data.session?.user.id!==expectedOwner)throw new PublicStashApiError(409,'Account changed. Try again.');
 if(!result.ok)throw new PublicStashApiError(result.status,result.status===409?'Refresh publication state and try again.':result.status===404?'Stash unavailable':'Couldn’t load Public Stash. Please try again.');
 return result.json() as Promise<T>;
}
