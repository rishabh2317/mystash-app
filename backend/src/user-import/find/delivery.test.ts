import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {buildMaterializeRender} from '../../notifications/domain/eventTypes';
import {pushText,type BegunDelivery} from '../../notifications/domain/pushContent';
import {findTerminalKey} from '../../notifications/domain/idempotencyKeys';
import {isAllowedDeepLink} from '../../notifications/domain/deepLinks';
import {validateEvent,type AnalyticsEvent} from '../../analytics/contracts';
import {ingestMeasurement} from '../../analytics/service';
import {reconcileFindDelivery} from './terminalDelivery';
import {recordFindResultAction} from '../../analytics/serverEvents';
import type {Request} from '../../auth/requireAuth';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
test('Find summaries are capture-level task notifications with generic copy for found, partial, empty and failed outcomes',()=>{
 for(const outcome of ['found','partial','empty','failed']){
  const eventType=outcome==='failed'?'find.failed':'find.completed';
  const render=buildMaterializeRender({eventType,recipientUserId:id,payload:{findId:id,outcome,productCount:5,placeCount:2,note:'PRIVATE CANARY',thumbnail:'https://private.invalid/image'}});
  assert.equal(render.category,'task');assert.equal(render.group_key,null);assert.equal(render.requires_actor,false);assert.equal(render.deep_link,`/find/${id}`);
  assert.ok(isAllowedDeepLink(render.deep_link));assert.doesNotMatch(JSON.stringify(render),/PRIVATE CANARY|private.invalid|productCount|placeCount/);
  const push=pushText({type:eventType,category:'task',title:render.title,body:'PRIVATE CANARY',deepLink:render.deep_link} as BegunDelivery,new Map());assert.doesNotMatch(JSON.stringify(push),/PRIVATE CANARY/);
 }
 assert.equal(findTerminalKey(id,other,id),`find:${id}:${other}:${id}`);
 assert.notEqual(findTerminalKey(id,other,id),findTerminalKey(id,other,other));
});
test('Find links and payloads reject external destinations, query strings and guessed source fields',()=>{
 for(const link of [`/find/${id}?token=secret`,`/find/${id}/media/original`,'https://evil.invalid/find/'+id,'/find/not-an-id'])assert.equal(isAllowedDeepLink(link),false);
 assert.throws(()=>buildMaterializeRender({eventType:'find.completed',recipientUserId:id,payload:{findId:'https://evil.invalid',outcome:'found'}}));
});
function observation(name:AnalyticsEvent['event_name'],properties:Record<string,unknown>={}):AnalyticsEvent{return{event_id:id,event_name:name,occurred_at:new Date().toISOString(),session_id:other,schema_version:1,entity_type:'find',entity_id:id,surface:'find',platform:'ios',app_version:'1.0.0',properties};}
test('measurement contract enforces private Find classification, bounded properties and backend-only outcomes',()=>{
 assert.equal(validateEvent(observation('find.results_opened'),'client').entity_type,'find');
 for(const property of ['url','ocr','filename','hash','note','media_path'])assert.throws(()=>validateEvent(observation('find.results_opened',{[property]:'PRIVATE CANARY'}),'client'));
 for(const name of ['find.processing_completed','find.result_removed','find.ingestion_accepted'] as const)assert.throws(()=>validateEvent(observation(name),'client'));
 assert.equal(validateEvent(observation('find.processing_completed',{capture_origin:'gallery',outcome:'partial',count_bucket:'6+'}),'server').properties.count_bucket,'6+');
 assert.throws(()=>validateEvent(observation('find.processing_completed',{capture_origin:'gallery',outcome:'found',count_bucket:7}),'server'));
 assert.throws(()=>validateEvent(observation('find.processing_completed',{capture_origin:['gallery'],outcome:'found',count_bucket:'1'}),'server'));
});
test('result actions reuse authenticated request consent and the existing ingestion service with bounded server properties',async()=>{
 const prior={...process.env};process.env.ANALYTICS_ENABLED='true';process.env.FIND_MEASUREMENT_ENABLED='true';const calls:Record<string,unknown>[]=[];
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{assert.equal(name,'analytics_ingest');calls.push(args);return{data:{accepted:[id]},error:null};}} as unknown as SupabaseClient;
 const req={headers:{'x-mystash-session':id,'x-mystash-consent-revision':other,'x-mystash-find-action-id':id,'x-mystash-platform':'ios','x-mystash-app-version':'1.0.0'},body:{note:'PRIVATE CANARY'},socket:{remoteAddress:'192.0.2.99'}} as unknown as Request;
 try{
  await recordFindResultAction(db,req,other,id,'place',true);assert.equal(calls.length,1);assert.equal(calls[0].p_user_id,other);assert.equal(calls[0].p_revision,other);assert.equal(calls[0].p_source,'server');
  const event=(calls[0].p_events as AnalyticsEvent[])[0];assert.equal(event.event_id,id);assert.equal(event.event_name,'find.result_restored');assert.deepEqual(event.properties,{result_type:'place'});assert.doesNotMatch(JSON.stringify(calls),/PRIVATE/);
  delete req.headers['x-mystash-session'];await recordFindResultAction(db,req,other,id,'place',false);assert.equal(calls.length,1);
  process.env.ANALYTICS_ENABLED='false';await recordFindResultAction(db,req,other,id,'place',false);assert.equal(calls.length,1);
 }finally{for(const key of ['ANALYTICS_ENABLED','FIND_MEASUREMENT_ENABLED']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
});
test('recovery reuses one bounded SQL handoff and keeps all new feature flags disabled by default',async()=>{
 const prior={...process.env};delete process.env.FIND_NOTIFICATIONS_ENABLED;delete process.env.FIND_MEASUREMENT_ENABLED;process.env.ANALYTICS_ENABLED='true';let args:Record<string,unknown>|undefined;
 const db={rpc:(name:string,input:Record<string,unknown>)=>{assert.equal(name,'find_reconcile_delivery');args=input;return{abortSignal:async()=>({data:0,error:null})};}} as unknown as SupabaseClient;
 try{await reconcileFindDelivery(db);assert.deepEqual(args,{p_notifications:false,p_measurement:false,p_limit:25});
  process.env.FIND_NOTIFICATIONS_ENABLED='true';process.env.FIND_MEASUREMENT_ENABLED='true';await reconcileFindDelivery(db);assert.equal(args?.p_notifications,true);assert.equal(args?.p_measurement,true);
  process.env.NOTIFICATIONS_PRODUCERS_ENABLED='false';process.env.ANALYTICS_ENABLED='false';await reconcileFindDelivery(db);assert.equal(args?.p_notifications,false);assert.equal(args?.p_measurement,false);
 }finally{for(const key of ['FIND_NOTIFICATIONS_ENABLED','FIND_MEASUREMENT_ENABLED','ANALYTICS_ENABLED','NOTIFICATIONS_PRODUCERS_ENABLED']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
});
test('disabled Find measurement drops only Find observations and preserves existing measurement behavior',async()=>{
 const prior={...process.env};process.env.ANALYTICS_ENABLED='true';delete process.env.FIND_MEASUREMENT_ENABLED;let received:AnalyticsEvent[]=[];
 const db={rpc:async(_name:string,args:{p_events:AnalyticsEvent[]})=>{received=args.p_events;return{data:{accepted:received.map(e=>e.event_id)},error:null};}} as unknown as SupabaseClient;
 try{const find=observation('find.results_opened'),normal={...observation('session.started'),event_id:other,entity_type:'app',entity_id:undefined,surface:'app'} as AnalyticsEvent;
  const result=await ingestMeasurement(db,id,{sessionId:other,revision:id,anonymousConsent:false},[find,normal]);assert.equal(received.length,1);assert.equal(received[0].event_name,'session.started');assert.ok(result.rejected_ids.includes(id));
 }finally{if(prior.ANALYTICS_ENABLED===undefined)delete process.env.ANALYTICS_ENABLED;else process.env.ANALYTICS_ENABLED=prior.ANALYTICS_ENABLED;if(prior.FIND_MEASUREMENT_ENABLED===undefined)delete process.env.FIND_MEASUREMENT_ENABLED;else process.env.FIND_MEASUREMENT_ENABLED=prior.FIND_MEASUREMENT_ENABLED;}
});
