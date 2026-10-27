import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {buildCreatorReport,creatorRange,type RawCreatorReport} from './creatorReport';
const dayMs=86400000;
function fixture():RawCreatorReport{return {days:7,end_day:'2026-03-10',generated_at:'2026-03-10T12:00:00Z',refreshed_at:'2026-03-10T11:59:00Z',daily:[],coverage:[],top_collections:[],top_products:[]};}
function complete(raw:RawCreatorReport){raw.coverage=Array.from({length:raw.days*2},(_,i)=>({day:new Date(Date.parse(`${raw.end_day}T00:00:00Z`)-(raw.days*2-i)*dayMs).toISOString().slice(0,10),windows:288}));return raw;}
describe('creator reporting periods and truthful denominators',()=>{
 it('accepts only bounded scalar ranges',()=>{
  assert.equal(creatorRange(undefined),7);for(const n of ['7','30','90'])assert.equal(creatorRange(n),+n);
  for(const n of ['0','08','365',7,['7'],null,{}])assert.equal(creatorRange(n),null);
 });
 for(const days of [7,30,90] as const)it(`returns ${days} complete UTC calendar days and an equal previous interval`,()=>{
  const raw=complete({...fixture(),days}),r=buildCreatorReport(raw);
  assert.equal(r.series.length,days);assert.equal(r.current.end,'2026-03-10');
  assert.equal(r.current.start,r.previous.end);assert.equal(Date.parse(r.current.end)-Date.parse(r.current.start),days*dayMs);
  assert.equal(r.current.coveredDays,days);assert.equal(r.previous.coveredDays,days);
 });
 it('never fills unavailable historical observations with zeros',()=>{
  const r=buildCreatorReport(fixture());
  assert.equal(r.current.values.collection_opens,null);assert.equal(r.series[0].values.collection_opens,null);
  assert.equal(r.current.coveredDays,0);assert.equal(r.changes.collection_opens,null);
 });
 it('shows partial positive counts while keeping unknown empty days as gaps',()=>{
  const raw=fixture();raw.daily=[{day:'2026-03-09',metric:'collection_opens',value:3}];
  raw.coverage=[{day:'2026-03-09',windows:287}];const r=buildCreatorReport(raw);
  assert.equal(r.current.values.collection_opens,3);assert.equal(r.series.at(-1)?.values.collection_opens,3);
  assert.equal(r.current.values.merchant_requests,null);assert.equal(r.changes.collection_opens,null);
 });
 it('fills zero only on fully covered days and suppresses division by zero',()=>{
  const r=buildCreatorReport(complete(fixture()));
  assert.equal(r.current.values.collection_opens,0);assert.equal(r.series[0].values.collection_opens,0);
  assert.equal(r.changes.collection_opens,null);
 });
 it('compares recorded metrics only across two fully covered periods',()=>{
  const raw=complete(fixture());raw.daily=[{day:'2026-03-01',metric:'saves_added',value:4},{day:'2026-03-09',metric:'saves_added',value:2}];
  assert.equal(buildCreatorReport(raw).changes.saves_added,-50);
  raw.coverage[0].windows=287;assert.equal(buildCreatorReport(raw).changes.saves_added,null);
 });
 it('labels late arrivals provisional and makes stale comparisons unavailable',()=>{
  const raw=complete(fixture());raw.daily=[{day:'2026-03-01',metric:'collection_opens',value:2},{day:'2026-03-09',metric:'collection_opens',value:3}];
  assert.equal(buildCreatorReport(raw).provisional,true);assert.equal(buildCreatorReport(raw).changes.collection_opens,50);
  raw.refreshed_at='2026-03-10T11:00:00Z';assert.equal(buildCreatorReport(raw).stale,true);
  assert.equal(buildCreatorReport(raw).changes.collection_opens,null);
  raw.refreshed_at=null;assert.equal(buildCreatorReport(raw).stale,true);
 });
 it('rejects corrupt dates and unsafe count values rather than presenting them as zero',()=>{
  assert.throws(()=>buildCreatorReport({...fixture(),end_day:'2026-02-31'}));
  for(const value of [NaN,-1,1.2,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>buildCreatorReport({...fixture(),daily:[{day:'2026-03-09',metric:'collection_opens',value}]}));
 });
 it('never exposes audience identifiers or playback properties in its response',()=>{
  const r=buildCreatorReport(fixture());assert.doesNotMatch(JSON.stringify(r),/actor|session|watch_duration|completion|replay|checkpoint|playback/i);
 });
 it('keeps missing ranked metrics unknown in partially covered periods',()=>{
  const raw=fixture();raw.top_collections=[{id:'a',title:'A',thumbnail_url:null,opens:2,saves:0,requests:0}];
  raw.top_products=[{id:'p',namespace:'catalog',title:'P',thumbnail_url:null,impressions:0,requests:1}];
  const r=buildCreatorReport(raw);assert.equal(r.topCollections[0].opens,2);assert.equal(r.topCollections[0].saves,null);
  assert.equal(r.topProducts[0].impressions,null);assert.equal(r.topProducts[0].requests,1);
  assert.equal(buildCreatorReport(complete(raw)).topCollections[0].saves,0);
 });
});
