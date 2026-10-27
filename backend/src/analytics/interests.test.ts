import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {buildInterestFeatures,supportedInterestFeatures,type InterestInput} from './interests';
const uuid=(n:number)=>`30000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const ref=(n=1)=>({kind:'product' as const,key:uuid(n),namespace:'catalog' as const,category:'electronics',creator_id:null});
function fixture():InterestInput{return {revision:uuid(999),since:'2026-03-04T00:00:00Z',observed_at:'2026-03-10T12:00:00Z',policy_version:1,current:[],events:[]};}
const event=(day:string,name:'product.opened'|'merchant.outbound_resolved'='product.opened',n=1)=>({...ref(n),name,occurred_at:`2026-03-${day}T10:00:00Z`});
describe('bounded interest snapshots',()=>{
 it('keeps repeated taps and an open→merchant flow to one maximum daily entity signal',()=>{
  const raw=fixture();raw.events=Array.from({length:100},()=>event('10'));raw.events.push(event('10','merchant.outbound_resolved'));
  const product=buildInterestFeatures(raw).features.find(f=>f.kind==='product')!;assert.equal(product.inferred_score,3);assert.equal(product.evidence_days,1);assert.equal(product.confidence,'emerging');
 });
 it('requires cross-day evidence for supported behavioral product interest',()=>{
  const raw=fixture();raw.events=[event('09'),event('10')];const p=buildInterestFeatures(raw).features.find(f=>f.kind==='product')!;
  assert.equal(p.evidence_days,2);assert.equal(p.confidence,'supported');assert.ok(p.inferred_score>1&&p.inferred_score<2);
 });
 it('decays old observations and excludes pre-purpose, expired and future activity',()=>{
  const raw=fixture();raw.events=[event('02'),event('03'),event('11'),event('05')];const p=buildInterestFeatures(raw).features.find(f=>f.kind==='product')!;
  assert.equal(p.evidence_days,1);assert.ok(p.inferred_score<.5);assert.equal(p.last_day,'2026-03-05');
 });
 it('uses maximum current-intent boost without duplicating current saves or namespaces',()=>{
  const raw=fixture();raw.current=[{...ref(),sources:['saved_product']},{...ref(),sources:['saved_product']},{...ref(),namespace:'discovered',sources:['saved_product']}];
  const p=buildInterestFeatures(raw).features.filter(f=>f.kind==='product');assert.equal(p.length,2);assert.ok(p.every(f=>f.explicit_score===6&&f.confidence==='explicit'));assert.notEqual(p[0].namespace,p[1].namespace);
 });
 it('keeps categories inferred even when derived from current saves',()=>{
  const raw=fixture();raw.current=[{...ref(1),sources:['saved_product']},{...ref(2),sources:['saved_product']}];const c=buildInterestFeatures(raw).features.find(f=>f.kind==='category')!;
  assert.equal(c.explicit_score,0);assert.deepEqual(c.explicit_sources,[]);assert.equal(c.confidence,'supported');assert.equal(c.evidence_entities,2);
 });
 it('does not turn one saved product into a confident broad category preference',()=>{
  const raw=fixture();raw.current=[{...ref(),sources:['saved_product']}];assert.equal(buildInterestFeatures(raw).features.find(f=>f.kind==='category')!.confidence,'emerging');
 });
 it('separates followed creators from weaker creator affinity through collections',()=>{
  const raw=fixture();raw.current=[{kind:'collection',key:uuid(4),namespace:null,category:null,creator_id:uuid(5),sources:['saved_collection']},{kind:'collection',key:uuid(6),namespace:null,category:null,creator_id:uuid(5),sources:['saved_collection']}];
  const creator=buildInterestFeatures(raw).features.find(f=>f.kind==='creator')!;assert.equal(creator.explicit_score,0);assert.equal(creator.confidence,'supported');
  raw.current.push({kind:'creator',key:uuid(5),namespace:null,category:null,creator_id:null,sources:['followed_creator']});assert.equal(buildInterestFeatures(raw).features.find(f=>f.kind==='creator')!.explicit_score,8);
 });
 it('retains no free-text categories, event payloads, search, location or player fields',()=>{
  const raw=fixture();raw.events=[{...event('10'),category:'private medical detail'}];Object.assign(raw.events[0],{query:'private query',url:'https://secret.invalid',position:99});
  const result=buildInterestFeatures(raw);assert.ok(result.features.every(f=>f.kind!=='category'));assert.doesNotMatch(JSON.stringify(result),/private|medical|secret|query|url|position|playback/i);
 });
 it('rejects unsupported playback events, bad references and mismatched signal kinds',()=>{
  assert.throws(()=>buildInterestFeatures({...fixture(),policy_version:2 as 1}));
  assert.throws(()=>buildInterestFeatures({...fixture(),events:[{...event('10'),name:'watch.completed' as 'product.opened'}]}));
  assert.throws(()=>buildInterestFeatures({...fixture(),current:[{...ref(),key:'invalid',sources:['saved_product']}]}));
  assert.throws(()=>buildInterestFeatures({...fixture(),current:[{...ref(),sources:['followed_creator']}]}));
 });
 it('caps computation and stored features with explicit sampling metadata',()=>{
  const raw=fixture();raw.current=Array.from({length:250},(_,i)=>({...ref(i+1),sources:['saved_product' as const]}));raw.events=Array.from({length:2100},()=>event('10'));
  const result=buildInterestFeatures(raw);assert.equal(result.features.length,50);assert.equal(result.capped,true);assert.ok(JSON.stringify(result.features).length<32768);
 });
 it('produces the same bounded output on repeated builds instead of accumulating counts',()=>{
  const raw=fixture();raw.events=[event('09'),event('10')];assert.deepEqual(buildInterestFeatures(raw),buildInterestFeatures(raw));
 });
 it('provides no supported context for missing consent, stale/expired or insufficient profiles',()=>{
  const raw=fixture();raw.current=[{...ref(),sources:['saved_product']}];const features=buildInterestFeatures(raw).features,now=Date.parse(raw.observed_at);
  const profile={status:'ready' as const,version:1 as const,policy_version:1 as const,built_at:raw.observed_at,expires_at:'2026-03-11T12:00:00Z',features};
  assert.equal(supportedInterestFeatures(profile,true,now).length,1);assert.deepEqual(supportedInterestFeatures(profile,false,now),[]);
  assert.deepEqual(supportedInterestFeatures({...profile,status:'insufficient'},true,now),[]);assert.deepEqual(supportedInterestFeatures(profile,true,now+3*3600000),[]);
  assert.deepEqual(supportedInterestFeatures({...profile,expires_at:'2026-03-10T11:00:00Z'},true,now),[]);
 });
});
