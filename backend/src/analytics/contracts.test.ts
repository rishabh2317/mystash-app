import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {EVENT_NAMES,validateEvent,type AnalyticsEvent} from './contracts';
const base=():AnalyticsEvent=>({event_id:'10000000-0000-4000-8000-000000000001',session_id:'50000000-0000-4000-8000-000000000001',
 event_name:'product.impression',entity_type:'product',entity_id:'30000000-0000-4000-8000-000000000001',namespace:'catalog',
 occurred_at:new Date().toISOString(),schema_version:1,surface:'search',platform:'ios',app_version:'1.0.0',properties:{}});
describe('measurement contract',()=>{
 it('accepts bounded public product exposures on both platforms',()=>{
  for(const platform of ['ios','android'] as const)assert.equal(validateEvent({...base(),platform},'client').platform,platform);
 });
 it('rejects extra identifiers, URLs, query text and sensitive properties',()=>{
  for(const extra of [{email:'private'},{destination_url:'https://shop.invalid/?secret=x'},{query:'private search'}]){
   assert.throws(()=>validateEvent({...base(),...extra},'client'));
   assert.throws(()=>validateEvent({...base(),properties:extra},'client'));
  }
 });
 it('rejects every playback event and any playback property',()=>{
  for(const event_name of ['video.watch_summary','video.measurement_unavailable','video.completed','video.skipped','video.replayed'])
   assert.throws(()=>validateEvent({...base(),event_name},'client'));
  for(const field of ['position','watch_ms','completion_rate','playing_ms','revision','checkpoint'])
   assert.throws(()=>validateEvent({...base(),properties:{[field]:1}},'client'));
  assert.ok(EVENT_NAMES.every(n=>!n.startsWith('video.')));
 });
 it('rejects delayed/future events and invalid namespaces',()=>{
  assert.throws(()=>validateEvent({...base(),occurred_at:new Date(Date.now()-86400001).toISOString()},'client'));
  assert.throws(()=>validateEvent({...base(),namespace:'private-token'},'client'));
  assert.throws(()=>validateEvent({...base(),event_name:'creator.profile_opened',entity_type:'creator'},'client'));
 });
 it('only accepts outbound resolutions from the server',()=>{
  const e={...base(),event_name:'merchant.outbound_resolved',properties:{destination_kind:'merchant',affiliate:false,request_id:base().event_id}};
  assert.throws(()=>validateEvent(e,'client'));assert.equal(validateEvent(e,'server').event_name,'merchant.outbound_resolved');
 });
 it('requires search result identity, type and rank without raw text',()=>{
  const e={...base(),event_name:'search.result_clicked',properties:{request_id:base().event_id,result_type:'product',rank:0}};
  assert.equal(validateEvent(e,'client').properties.rank,0);
  assert.throws(()=>validateEvent({...e,properties:{...e.properties,rank:-1}},'client'));
  assert.throws(()=>validateEvent({...e,properties:{...e.properties,result_type:'creator'}},'client'));
 });
});
