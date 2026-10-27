import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {describe,it} from 'node:test';
import ts from 'typescript';
import * as privacy from './privacy';
import * as measurementPrivacy from './measurementPrivacy';
import * as queue from './queue';
import * as contracts from '../../backend/src/analytics/contracts';
const id='10000000-0000-4000-8000-000000000001';
const source=ts.transpileModule(readFileSync(resolve('src/analytics/client.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function client(flag:boolean,values:Map<string,string>,network:(url:string,init:RequestInit)=>Promise<unknown>){
 let ids=0;const exports:Record<string,unknown>={};
 const deps:Record<string,unknown>={
  './privacy':privacy,'./measurementPrivacy':measurementPrivacy,'./queue':queue,'@/backend/src/analytics/contracts':contracts,
  '@react-native-async-storage/async-storage':{default:{getItem:async(k:string)=>values.get(k)??null,setItem:async(k:string,v:string)=>values.set(k,v),removeItem:async(k:string)=>values.delete(k)}},
  'expo-constants':{default:{expoConfig:{version:'1.0.0'}}},'react-native':{Platform:{OS:'ios'}},
  '@/src/services/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id},access_token:'synthetic-test-token'}}})}}},
  '@/src/services/newEventId':{newEventId:()=>{ids++;return id;}},'@/src/auth/emailVerified':{isAuthEmailVerified:()=>true},
 };
 runInNewContext(source,{exports,require:(key:string)=>{assert.ok(key in deps,key);return deps[key];},process:{env:{EXPO_PUBLIC_ANALYTICS_ENABLED:String(flag),EXPO_PUBLIC_MYSTASH_INGEST_URL:'https://example.invalid'}},fetch:network,AbortController,
  setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,Math.min(ms,25)),clearTimeout});return {api:exports as typeof import('./client'),ids:()=>ids};
}
describe('actual client privacy lifecycle without native modules',()=>{
 it('replays pending withdrawal with both flags off and creates no measurement IDs',async()=>{
  const values=new Map([['mystash.analytics.withdrawal.'+id,JSON.stringify({measurement_enabled:false,activity_enabled:false})]]),methods:string[]=[];
  const {api,ids}=client(false,values,async(_url,init)=>{methods.push(init.method??'GET');assert.equal('x-mystash-session' in (init.headers??{}),false);return {ok:true,json:async()=>({enabled:false,preferences:{...privacy.MEASUREMENT_OFF,revision:id}})};});
  await api.initializeAnalytics(id);assert.deepEqual(methods,['PUT','GET']);assert.equal(values.has('mystash.analytics.withdrawal.'+id),false);assert.equal(ids(),0);assert.equal(api.analyticsSnapshot().enabled,false);
 });
 it('cold loading/offline verification retains valid cache and uses no IDs, then withdrawal purges',async()=>{
  const values=new Map<string,string>(),q=new queue.AnalyticsQueue({getItem:async k=>values.get(k)??null,setItem:async(k,v)=>{values.set(k,v);},removeItem:async k=>{values.delete(k);}},async()=>({}));
  await q.configure(id,id,true);q.add({event_id:id,session_id:id,event_name:'session.started',schema_version:1,occurred_at:new Date().toISOString(),entity_type:'app',surface:'app',platform:'ios',app_version:'1.0.0',properties:{}});await q.pause();values.set(measurementPrivacy.measurementDeviceReceipt(id),id);
  const {api,ids}=client(true,values,async()=>{throw new Error('offline');});api.pauseAnalytics();await api.initializeAnalytics(id);assert.equal(api.analyticsQueue.count(),1);assert.equal(ids(),0);assert.deepEqual({...api.analyticsHeaders()},{});
  await assert.rejects(()=>api.updateMeasurementPreferences(false,false,{decreaseOnly:true}));assert.equal(api.analyticsQueue.count(),0);assert.equal(values.has('mystash.analytics.queue.v1'),false);
 });
 it('holds a valid queue during shutdown but purges pending withdrawal, unknown policies and changed revisions',async()=>{
  const event={event_id:id,session_id:id,event_name:'session.started',schema_version:1,occurred_at:new Date().toISOString(),entity_type:'app',surface:'app',platform:'ios',app_version:'1.0.0',properties:{}};
  for(const mode of ['shutdown','withdrawal','policy','revision']){
   const values=new Map([[measurementPrivacy.measurementDeviceReceipt(id),id],['mystash.analytics.queue.v1',JSON.stringify({scope:id,revision:id,events:[event]})]]);
   if(mode==='withdrawal')values.set('mystash.analytics.withdrawal.'+id,JSON.stringify({measurement_enabled:false,activity_enabled:false}));
   const {api,ids}=client(mode!=='shutdown',values,async()=>{if(mode==='withdrawal')throw new Error('offline');return {ok:true,json:async()=>({enabled:false,preferences:{measurement_enabled:true,activity_enabled:true,revision:mode==='revision'?'10000000-0000-4000-8000-000000000002':id,policy_version:mode==='policy'?2:1}})};});
   await api.initializeAnalytics(id);assert.equal(api.analyticsQueue.count(),mode==='shutdown'?1:0,mode);assert.equal(ids(),0,mode);assert.equal(api.analyticsSnapshot().enabled,false);
  }
 });
 it('bounds a hung transport and response body, aborting the real request',async()=>{
  for(const hungBody of [false,true]){let signal:AbortSignal|undefined;const values=new Map([[measurementPrivacy.measurementDeviceReceipt(id),id]]);
   const {api,ids}=client(true,values,async(_url,init)=>{signal=init.signal??undefined;if(!hungBody)return new Promise(()=>{});return {ok:true,json:()=>new Promise(()=>{})};});
   await api.initializeAnalytics(id);assert.equal(signal?.aborted,true);assert.equal(api.analyticsSnapshot().enabled,false);assert.equal(ids(),0);
  }
 });
});
