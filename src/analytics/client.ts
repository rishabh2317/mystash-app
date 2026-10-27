import {devicePreferences,MEASUREMENT_OFF,type Preferences} from './privacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {Platform} from 'react-native';
import {supabase} from '@/src/services/supabase';
import {newEventId} from '@/src/services/newEventId';
import {isAuthEmailVerified} from '@/src/auth/emailVerified';
import {validateEvent,UUID,type AnalyticsEvent} from '@/backend/src/analytics/contracts';
import {AnalyticsQueue} from './queue';
import {MeasurementPrivacy,measurementDeviceReceipt,type MeasurementChange,type MeasurementReply} from './measurementPrivacy';
export const ANALYTICS_CLIENT_ENABLED=process.env.EXPO_PUBLIC_ANALYTICS_ENABLED==='true';
export type {Preferences};
const OFF=MEASUREMENT_OFF,ANON_KEY='mystash.analytics.anonymous.consent.v1';
let state={enabled:false,available:false,ready:false,recoverable:false,preferences:OFF,accountPreferences:null as Preferences|null,scope:'',generation:0};
let sessionId='',lastActive=0,foreground=true;
const freshId=()=>{try{return newEventId();}catch{return null;}};
const seen=new Set<string>(),listeners=new Set<()=>void>();
let controller:AbortController|null=null;
const base=()=>process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/,'')??'';
const publish=()=>{for(const listener of listeners)listener();};
export const subscribeAnalytics=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const analyticsSnapshot=()=>state;
async function authorization(scope:string){
 const {data}=await supabase.auth.getSession();
 if(data.session?.user.id!==scope||!isAuthEmailVerified(data.session.user))throw new Error('identity_changed');
 return `Bearer ${data.session.access_token}`;
}
async function timedFetch(url:string,options:RequestInit={},c=new AbortController()){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([(async()=>{const response=await fetch(url,{...options,signal:c.signal});
  const body=await response.json().catch(()=>({}));return {response,body};})(),new Promise<never>((_resolve,reject)=>{
   timer=setTimeout(()=>{c.abort();reject(new Error('Privacy request deadline exceeded'));},10000);
  })]);}finally{if(timer)clearTimeout(timer);}
}
export const measurementPrivacy=new MeasurementPrivacy(AsyncStorage,async(scope:string,change?:MeasurementChange):Promise<MeasurementReply>=>{
 const {response:r,body}=await timedFetch(`${base()}/analytics/preferences`,{method:change?'PUT':'GET',headers:{Authorization:await authorization(scope),'Content-Type':'application/json'},body:change?JSON.stringify(change):undefined});
 if(!r.ok)throw new Error(r.status===401?'Invalid privacy identity':r.status===409?'Privacy settings changed; refresh required':'Privacy settings unavailable');
 const p=body.preferences;
 if(!p||p.policy_version!==1||typeof p.measurement_enabled!=='boolean'||typeof p.activity_enabled!=='boolean'||p.activity_enabled&&!p.measurement_enabled||
  p.revision!==null&&(typeof p.revision!=='string'||!UUID.test(p.revision)))throw new Error('Unknown privacy policy');
 return {enabled:body.enabled===true,preferences:p};
});
async function headers(scope=state.scope,revision=state.preferences.revision,session=sessionId){
 const h:Record<string,string>={'Content-Type':'application/json','x-mystash-session':session};
 if(scope==='guest')h['x-mystash-anonymous-consent']='1';else {h.Authorization=await authorization(scope);if(revision)h['x-mystash-consent-revision']=revision;}return h;
}
export const analyticsQueue=new AnalyticsQueue(AsyncStorage,async(events,scope,revision)=>{
 if(!ANALYTICS_CLIENT_ENABLED||!base())return {reset:true};
 const generation=state.generation,h=await headers(scope,revision||null,events[0].session_id);
 if(generation!==state.generation||scope!==state.scope)return {reset:true};
 const c=new AbortController();controller=c;
 try{const {response:r,body}=await timedFetch(`${base()}/analytics/batch`,{method:'POST',headers:h,body:JSON.stringify({events})},c);
  if(generation!==state.generation)return {reset:true};
  if([400,413].includes(r.status))return {discard:true};if(r.status===401)return {reset:true};
  if(generation!==state.generation)return {reset:true};
  if(body.consent_rejected){state={...state,enabled:false,preferences:OFF};publish();return {reset:true};}
  if(body.disabled){state={...state,enabled:false,available:false};publish();return {pause:true};}
  if(!r.ok)throw new Error('retry');return body;
 }finally{if(controller===c)controller=null;}
});
export async function initializeAnalytics(scope:string){
 const previous=state,generation=state.generation+1;controller?.abort();
 state={...state,scope,generation,enabled:false,ready:false,preferences:OFF,accountPreferences:previous.scope===scope?previous.accountPreferences:null};publish();
 await analyticsQueue.pause();
 const receipt=scope==='guest'?await AsyncStorage.getItem(ANON_KEY):await AsyncStorage.getItem(measurementDeviceReceipt(scope));
 if(state.generation!==generation)return;
 let preferences=OFF,accountPreferences:Preferences|null=previous.scope===scope?previous.accountPreferences:null,available=false,recoverable=scope==='guest'&&receipt==='1',unavailable=false,pendingWithdrawal=false;
 try{
  if(scope==='guest'){
   if(ANALYTICS_CLIENT_ENABLED&&base()){const {response:r,body}=await timedFetch(`${base()}/analytics/config`);if(!r.ok)throw new Error();available=body.enabled===true;preferences={...OFF,measurement_enabled:receipt==='1'};}
  }else{
   recoverable=await measurementPrivacy.recoverable(scope);pendingWithdrawal=await measurementPrivacy.hasPending(scope);
   if((ANALYTICS_CLIENT_ENABLED||recoverable)&&!base())unavailable=true;
   if((ANALYTICS_CLIENT_ENABLED||recoverable)&&base()){
    const r=await measurementPrivacy.read(scope);available=r.enabled;accountPreferences=r.preferences;
    const currentReceipt=await AsyncStorage.getItem(measurementDeviceReceipt(scope));preferences=devicePreferences(r.preferences,currentReceipt);
    recoverable=r.preferences.measurement_enabled||r.preferences.activity_enabled;
   }
  }
 }catch(error){unavailable=!(error instanceof Error&&['Unknown privacy policy','Invalid privacy identity'].includes(error.message));if(!unavailable)accountPreferences=null;}
 if(state.generation!==generation)return;
 const enabled=ANALYTICS_CLIENT_ENABLED&&available&&preferences.measurement_enabled;
 state={...state,ready:true,available,recoverable,enabled,preferences,accountPreferences};
 if(unavailable&&!pendingWithdrawal){
  // Unknown remote consent is a pause, never permission to send or to discard valid offline data.
  await analyticsQueue.hold(scope,scope==='guest'?(receipt==='1'?'':null):receipt);
 }else if(!enabled&&!pendingWithdrawal&&((scope==='guest'&&receipt==='1')||(scope!=='guest'&&accountPreferences?.measurement_enabled&&UUID.test(receipt??'')&&receipt===accountPreferences.revision))){
  await analyticsQueue.hold(scope,scope==='guest'?'':receipt);
 }else await analyticsQueue.configure(scope,preferences.revision??'',enabled);
 if(state.generation!==generation)return;
 if(!previous.ready||previous.scope!==scope||previous.preferences.revision!==preferences.revision||previous.enabled!==enabled){
  const next=enabled?freshId():'';if(next===null)state={...state,enabled:false};sessionId=next??'';seen.clear();lastActive=0;
 }
 publish();if(state.enabled)touchAnalyticsSession();
}
export function pauseAnalytics(){controller?.abort();state={...state,enabled:false,ready:false,generation:state.generation+1};void analyticsQueue.pause();publish();}
export function stopAnalytics(){controller?.abort();state={...state,enabled:false,ready:false,recoverable:false,generation:state.generation+1,preferences:OFF,accountPreferences:null,scope:''};seen.clear();void analyticsQueue.configure('','',false);publish();}
export async function updateMeasurementPreferences(measurement:boolean,activity:boolean,options:{activateDevice?:boolean;decreaseOnly?:boolean}={}){
 const scope=state.scope,prior=state.accountPreferences??state.preferences;
 const activateDevice=options.activateDevice??measurement;
 const decreasing=options.decreaseOnly??(!measurement||!activity&&prior.activity_enabled);
 controller?.abort();state={...state,enabled:false,generation:state.generation+1,preferences:{...state.preferences,measurement_enabled:measurement,activity_enabled:measurement&&activity}};publish();
 const generation=state.generation;await analyticsQueue.configure(scope,'',false);
 if(scope==='guest')await AsyncStorage.setItem(ANON_KEY,measurement?'1':'0');
 else await measurementPrivacy.change(scope,{measurement_enabled:measurement,activity_enabled:measurement&&activity,expected_revision:prior.revision,decrease_only:decreasing},activateDevice);
 if(state.scope===scope&&state.generation===generation)await initializeAnalytics(scope);
}
export function setAnalyticsForeground(active:boolean){foreground=active;if(active)touchAnalyticsSession();else void analyticsQueue.flush();}
export function touchAnalyticsSession(){if(!state.enabled||!foreground)return;
 const now=Date.now();if(!lastActive||now-lastActive>=1800000){const next=freshId();if(!next){state={...state,enabled:false};publish();return;}sessionId=next;seen.clear();enqueueObservation('session.started','app',undefined,'app',{});}lastActive=now;
}
export function analyticsHeaders():Record<string,string>{
 if(!state.enabled||!foreground)return {};touchAnalyticsSession();
 const h:Record<string,string>={'x-mystash-session':sessionId,'x-mystash-platform':Platform.OS,'x-mystash-app-version':Constants.expoConfig?.version??'1.0.0'};
 if(state.scope==='guest')h['x-mystash-anonymous-consent']='1';else if(state.preferences.revision)h['x-mystash-consent-revision']=state.preferences.revision;return h;
}
export function enqueueObservation(name:AnalyticsEvent['event_name'],type:AnalyticsEvent['entity_type'],id:string|undefined,surface:string,properties:Record<string,unknown>={},extra:Partial<AnalyticsEvent>={}){
 if(!state.enabled||!foreground)return;const eventId=freshId();if(!eventId)return;
 const event:AnalyticsEvent={event_id:eventId,event_name:name,schema_version:1,occurred_at:new Date().toISOString(),session_id:sessionId,entity_type:type,entity_id:id,surface,properties,platform:Platform.OS as AnalyticsEvent['platform'],app_version:Constants.expoConfig?.version??'1.0.0',...extra};
 try{validateEvent(event,'client');analyticsQueue.add(event);}catch{/* Unsupported identities are never guessed. */}
}
export function recordOnce(name:AnalyticsEvent['event_name'],type:AnalyticsEvent['entity_type'],id:string,surface:string,extra:Partial<AnalyticsEvent>={}){
 if(!state.enabled||!foreground)return;touchAnalyticsSession();const key=`${sessionId}:${name}:${surface}:${type}:${id}`;
 if(seen.has(key)||seen.size>=5000)return;seen.add(key);enqueueObservation(name,type,id,surface,{},extra);
}
