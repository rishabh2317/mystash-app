import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {AnalyticsQueue,type Ack} from './queue';
import type {AnalyticsEvent} from '../../backend/src/analytics/contracts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function event(n:number,now=Date.now()):AnalyticsEvent{return {event_id:id(n),session_id:id(900),event_name:'collection.impression',
 schema_version:1,occurred_at:new Date(now).toISOString(),entity_type:'collection',entity_id:id(901),surface:'collection',
 platform:'android',app_version:'1.0.0',properties:{}};}
function memory(){const values=new Map<string,string>();return {values,getItem:async(k:string)=>values.get(k)??null,
 setItem:async(k:string,v:string)=>{values.set(k,v);},removeItem:async(k:string)=>{values.delete(k);}};}
describe('bounded measurement queue',()=>{
 it('does not collect or send without opt-in',async()=>{let sent=0;const q=new AnalyticsQueue(memory(),async()=>{sent++;return {};});
  q.add(event(1));await q.flush();assert.equal(q.count(),0);assert.equal(sent,0);
 });
 it('persists retries and acknowledges immutable IDs exactly once',async()=>{const store=memory();let sent:string[]=[];
  const send=async(batch:AnalyticsEvent[])=>{sent=batch.map(e=>e.event_id);return {accepted:sent};};
  const q=new AnalyticsQueue(store,send);await q.configure('account','revision',true);q.add(event(1));q.add(event(1));await q.persisted();
  const restored=new AnalyticsQueue(store,send);await restored.configure('account','revision',true);assert.equal(restored.count(),1);
  await restored.flush();assert.deepEqual(sent,[id(1)]);assert.equal(restored.count(),0);
 });
 it('never restores another account or an older consent revision',async()=>{const store=memory();const q=new AnalyticsQueue(store,async()=>({}));
  await q.configure('a','r1',true);q.add(event(1));await q.persisted();await q.configure('b','r1',true);assert.equal(q.count(),0);
  q.add(event(2));await q.persisted();await q.configure('b','r2',true);assert.equal(q.count(),0);
 });
 it('caps memory and request size, dropping low-priority exposures first',async()=>{let size=0;const q=new AnalyticsQueue(memory(),async batch=>{
  size=batch.length;return {accepted:batch.map(e=>e.event_id)};});await q.configure('a','r',true);
  q.add({...event(1),event_name:'collection.opened'});
  for(let n=2;n<=520;n++)q.add(event(n));assert.equal(q.count(),500);assert.equal(q.dropped,20);
  await q.flush();assert.equal(size,25);assert.equal(q.count(),475);
 });
 it('backs off and reuses the original event IDs',async()=>{let now=Date.now(),calls=0;const ids:string[]=[];
  const q=new AnalyticsQueue(memory(),async batch=>{calls++;ids.push(batch[0].event_id);if(calls===1)throw new Error('offline');return {accepted:ids};},()=>now);
  await q.configure('a','r',true);q.add(event(1,now));await q.flush();await q.flush();assert.equal(calls,1);
  now+=3000;await q.flush();assert.deepEqual(ids,[id(1),id(1)]);assert.equal(q.count(),0);
 });
 it('withdrawal purges disk state and ignores a late acknowledgement',async()=>{let finish!:(a:Ack)=>void;
  const store=memory(),q=new AnalyticsQueue(store,()=>new Promise(resolve=>{finish=resolve;}));
  await q.configure('a','r',true);q.add(event(1));const pending=q.flush();await q.configure('a','r',false);
  finish({accepted:[id(1)]});await pending;await q.persisted();assert.equal(q.count(),0);assert.equal(store.values.size,0);
 });
 it('drops expired and rejected observations instead of retrying indefinitely',async()=>{let now=Date.now();const q=new AnalyticsQueue(memory(),async batch=>({rejected_ids:batch.map(e=>e.event_id)}),()=>now);
  await q.configure('a','r',true);q.add(event(1,now));now+=86400001;await q.flush();assert.equal(q.count(),0);
  q.add(event(2,now));await q.flush();assert.equal(q.count(),0);
 });
 it('pauses without losing queued observations on foreground preference refresh',async()=>{const store=memory();const q=new AnalyticsQueue(store,async()=>({}));
  await q.configure('a','r',true);q.add(event(1));await q.pause();await q.configure('a','r',true);assert.equal(q.count(),1);
 });
});

describe('unavailable consent verification holds',()=>{
 it('survives cold startup and repeated offline refresh without collecting or sending',async()=>{
  const store=memory();let sent=0;const send=async()=>{sent++;return {};};const r=id(999);
  const q=new AnalyticsQueue(store,send);await q.configure('a',r,true);q.add(event(1));await q.pause();
  const cold=new AnalyticsQueue(store,send);await cold.pause();await cold.hold('a',r);cold.add(event(2));await cold.flush();
  assert.equal(cold.count(),1);assert.equal(sent,0);await cold.hold('a',r);assert.equal(cold.count(),1);
  await cold.configure('a',r,true);assert.equal(cold.count(),1);await cold.flush();assert.equal(sent,1);
 });
 it('expires held events and purges mismatched identity, revision and invalid receipt',async()=>{
  for(const [scope,receipt] of [['b',id(9)],['a',id(8)],['a',null],['a','bad']] as const){
   const store=memory(),q=new AnalyticsQueue(store,async()=>({}));await q.configure('a',id(9),true);q.add(event(1));await q.pause();await q.hold(scope,receipt);assert.equal(q.count(),0);assert.equal(store.values.size,0);
  }
  let now=Date.now();const store=memory(),q=new AnalyticsQueue(store,async()=>({}),()=>now);
  await q.configure('a',id(9),true);q.add(event(1,now));await q.pause();now+=86400001;await q.hold('a',id(9));assert.equal(q.count(),0);assert.equal(store.values.size,0);
 });
 it('ignores late upload results while a valid revision is held',async()=>{
  let done!:(a:Ack)=>void;const store=memory(),q=new AnalyticsQueue(store,()=>new Promise(r=>{done=r;}));await q.configure('a',id(9),true);q.add(event(1));const send=q.flush();await q.pause();await q.hold('a',id(9));done({reset:true});await send;assert.equal(q.count(),1);
 });
});

it('holds a consented batch when global collection stops between verification and upload',async()=>{
 const store=memory();let sends=0;const q=new AnalyticsQueue(store,async()=>{sends++;return {pause:true};});
 await q.configure('a',id(9),true);q.add(event(1));await q.flush();q.add(event(2));await q.flush();assert.equal(sends,1);assert.equal(q.count(),1);
 const restored=new AnalyticsQueue(store,async()=>({}));await restored.configure('a',id(9),true);assert.equal(restored.count(),1);
});
