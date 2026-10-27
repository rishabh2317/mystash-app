import AsyncStorage from '@react-native-async-storage/async-storage';
import {supabase} from './supabase';
import {isAuthEmailVerified} from '@/src/auth/emailVerified';
import {PendingPersonalizationWithdrawals} from '@/src/analytics/personalizationPrivacy';
export type PersonalizationSettings={available:boolean;preferences:{enabled:boolean;revision:string|null;policy_version:number;since:string|null}};
const controlReceipt=(scope:string)=>`mystash.personalization.controls.${scope}`;
export async function hasPersonalizationControlReceipt(scope:string){return await AsyncStorage.getItem(controlReceipt(scope))==='1';}
async function request(scope:string,path:string,method='GET',body?:unknown){
 const base=process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/,'');if(!base)throw new Error('Service unavailable');
 const {data}=await supabase.auth.getSession();
 if(data.session?.user.id!==scope||!isAuthEmailVerified(data.session.user))throw new Error('Verified account required');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const r=await fetch(`${base}${path}`,{method,signal:controller.signal,headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw new Error(r.status===409?'Privacy settings changed. Please refresh and try again.':'Privacy change could not be confirmed');return r.json();
 }finally{clearTimeout(timer);}
}
export const personalizationWithdrawals=new PendingPersonalizationWithdrawals(AsyncStorage,async scope=>{await request(scope,'/analytics/personalization','PUT',{enabled:false});await AsyncStorage.removeItem(controlReceipt(scope));});
export async function getPersonalizationSettings(scope:string):Promise<PersonalizationSettings>{
 await personalizationWithdrawals.flush(scope);const result:PersonalizationSettings=await request(scope,'/analytics/personalization');
 if(result.preferences.enabled)await AsyncStorage.setItem(controlReceipt(scope),'1');else await AsyncStorage.removeItem(controlReceipt(scope));return result;
}
export async function enablePersonalization(scope:string,measurementRevision:string){
 const current=await getPersonalizationSettings(scope);
 const result=await request(scope,'/analytics/personalization','PUT',{enabled:true,policy_version:1,expected_revision:current.preferences.revision,measurement_revision:measurementRevision});
 await AsyncStorage.setItem(controlReceipt(scope),'1');return result;
}
export async function resetInterests(scope:string){await request(scope,'/analytics/interests','DELETE');}
