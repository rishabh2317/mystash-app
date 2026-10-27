import { randomUUID } from 'node:crypto';
import type { Request } from '../auth/requireAuth';
import type { SupabaseClient } from '@supabase/supabase-js';
import { UUID,type AnalyticsEvent } from './contracts';
import { requestMeasurement } from './context';
import { ingestMeasurement,MeasurementRateLimit } from './service';

const serverLimiter=new MeasurementRateLimit();
function common(req:Request,id:string):Pick<AnalyticsEvent,'event_id'|'schema_version'|'occurred_at'|'session_id'|'platform'|'app_version'>|null {
  const ctx=requestMeasurement(req);if(!ctx)return null;
  const p=String(req.headers['x-mystash-platform']),v=String(req.headers['x-mystash-app-version']);
  return {event_id:id,schema_version:1,occurred_at:new Date().toISOString(),session_id:ctx.sessionId,
    platform:['ios','android','web'].includes(p)?p as AnalyticsEvent['platform']:'server',
    app_version:/^\d{1,3}\.\d{1,3}\.\d{1,6}$/.test(v)?v:'0.0.0'};
}
async function bounded(task:Promise<unknown>):Promise<unknown>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([task,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1500);})]);}
  catch{return null;}finally{if(timer)clearTimeout(timer);}
}
export async function recordSearchResponse(admin:SupabaseClient,req:Request,userId:string|null,input:{
  results:{id:string;entityType:string}[];matchingCount:number;fallbackCount:number;latencyMs:number;
  retrievalMode:string;filterKeys:string[];queryLength:number;
}):Promise<string|null>{
  const ctx=requestMeasurement(req);if(!ctx||(req.headers.authorization&&!userId)||!serverLimiter.allow(req.socket?.remoteAddress??'unknown',1))return null;
  const supplied=String(req.headers['x-mystash-search-id']);const id=UUID.test(supplied)?supplied:randomUUID();
  const envelope=common(req,id);if(!envelope)return null;
  const event:AnalyticsEvent={...envelope,event_name:'search.results_served',entity_type:'search',entity_id:id,surface:'search',properties:{
    matching_count:input.matchingCount,fallback_count:input.fallbackCount,latency_ms:Math.min(120000,Math.round(input.latencyMs)),
    query_length_bucket:input.queryLength<=10?'1-10':input.queryLength<=30?'11-30':'31+',
    retrieval_mode:input.retrievalMode,filter_keys:input.filterKeys,
  }};
  const results=input.results.slice(0,100).map((r,rank)=>({id:r.id,entity_type:r.entityType,rank})).filter(r=>UUID.test(r.id));
  const result=await bounded(ingestMeasurement(admin,userId,ctx,[event],'server',results)) as {accepted?:unknown[]}|null;
  return result?.accepted?.length?id:null;
}
export async function recordOutboundObservation(admin:SupabaseClient,req:Request,userId:string|null,input:{
 productId:string;namespace:'catalog'|'discovered';collectionId?:string|null;destinationKind:string;affiliate:boolean;
}){
 const ctx=requestMeasurement(req);if(!ctx||(req.headers.authorization&&!userId)||!serverLimiter.allow(req.socket?.remoteAddress??'unknown',1))return;
 const supplied=String(req.headers['x-mystash-outbound-id']);const id=UUID.test(supplied)?supplied:randomUUID();
 const envelope=common(req,id);if(!envelope)return;
 await bounded(ingestMeasurement(admin,userId,ctx,[{...envelope,event_name:'merchant.outbound_resolved',entity_type:'product',
  entity_id:input.productId,namespace:input.namespace,collection_id:input.collectionId??undefined,surface:'product',
  properties:{destination_kind:input.destinationKind,affiliate:input.affiliate,request_id:id}}],'server'));
}
