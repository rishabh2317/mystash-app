import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {buildAdminReport,type AdminMetric,type RawAdminReport} from './adminReport';
import {adminFixture,fullAdminCoverage} from './testFixtures/adminReport';
function record(raw:RawAdminReport,metric:AdminMetric,value:number,day='2026-03-09',dimension='all'){
 if(dimension==='all')raw.daily.push({day,metric,value,dimension});else raw.breakdowns.push({metric,value,dimension});
}
describe('admin aggregate reporting',()=>{
 for(const days of [7,30,90] as const)it(`uses complete UTC days with equal previous ${days}-day periods`,()=>{
  const r=buildAdminReport(fullAdminCoverage({...adminFixture(),days}));assert.equal(r.series.length,days);assert.equal(r.current.coveredDays,days);assert.equal(r.current.end,'2026-03-10');assert.equal(r.current.start,r.previous.end);
  assert.equal(Date.parse(r.current.end)-Date.parse(r.current.start),days*86400000);
 });
 it('keeps unknown observations distinct from zero without masking exact business record zeros',()=>{
  const raw=adminFixture();record(raw,'merchant_requests',2);const r=buildAdminReport(raw);
  assert.equal(r.current.values.merchant_requests,2);assert.equal(r.current.values.product_opens,null);assert.equal(r.series[0].values.merchant_requests,null);
  assert.equal(r.snapshot.catalog_products_current,0);assert.equal(r.changes.merchant_requests,null);assert.equal(r.activity.active24h,null);
  assert.equal(buildAdminReport(fullAdminCoverage(adminFixture())).current.values.product_opens,0);
 });
 it('derives search rates only from the same recorded response population, including valid zero numerators',()=>{
  const raw=adminFixture();for(const [metric,value] of [['search_responses',4],['search_zero_matches',1],['search_with_fallback',2],['search_latency_ms',1000],['search_clicks',2],['search_click_rank_sum',4]] as [AdminMetric,number][])record(raw,metric,value);
  assert.deepEqual(buildAdminReport(raw).search,{zeroMatchPercent:25,fallbackPercent:50,meanLatencyMs:250,meanClickRank:2});
  raw.daily=raw.daily.filter(d=>d.metric!=='search_zero_matches');assert.equal(buildAdminReport(raw).search.zeroMatchPercent,0);
  assert.deepEqual(buildAdminReport(adminFixture()).search,{zeroMatchPercent:null,fallbackPercent:null,meanLatencyMs:null,meanClickRank:null});
 });
 it('never sums totals together with their platform/category breakdowns',()=>{
  const raw=adminFixture();record(raw,'merchant_requests',4);record(raw,'merchant_requests',2,'2026-03-09','platform:ios');record(raw,'merchant_requests',2,'2026-03-09','platform:android');record(raw,'merchant_requests',3,'2026-03-09','category:electronics');
  const r=buildAdminReport(raw);assert.equal(r.current.values.merchant_requests,4);assert.equal(r.platforms[0].values.merchant_requests,2);assert.equal(r.categories[0].values.merchant_requests,3);assert.equal(r.categories[0].values.product_opens,null);
 });
 it('keeps source failure and extraction coverage denominators separate',()=>{
  const raw=adminFixture();raw.source_statuses=[{status:'READY',value:6},{status:'FAILED',value:2},{status:'PROCESSING',value:100}];
  raw.extraction={ready_with_products:4,ready_without_products:2,product_candidates:4,bound_product_candidates:2,place_candidates:2,resolved_places:1};
  const r=buildAdminReport(raw);assert.equal(r.terminalSourceFailurePercent,25);assert.equal(r.productBindingPercent,50);assert.equal(r.placeResolutionPercent,50);
  assert.equal(buildAdminReport(adminFixture()).terminalSourceFailurePercent,null);
 });
 it('exposes opted-in active accounts only with explicit partial/full coverage, never population MAU',()=>{
  const raw=adminFixture();raw.activity={active_24h:3,active_7d:4,windows_24h:20,windows_7d:50};let r=buildAdminReport(raw);
  assert.equal(r.activity.active24h,3);assert.equal(r.activity.covered24h,false);assert.equal(r.activity.active7d,4);
  raw.activity={active_24h:0,active_7d:0,windows_24h:288,windows_7d:2016};r=buildAdminReport(raw);assert.equal(r.activity.active24h,0);assert.equal(r.activity.covered7d,true);
  raw.refreshed_at=null;assert.equal(buildAdminReport(raw).activity.active24h,null);assert.ok(r.unavailable.some(m=>m.metric.includes('MAU')));
 });
 it('suppresses growth when incomplete, stale, or the prior denominator is zero',()=>{
  const raw=fullAdminCoverage(adminFixture());record(raw,'product_opens',4,'2026-03-01');record(raw,'product_opens',2);
  assert.equal(buildAdminReport(raw).changes.product_opens,-50);raw.coverage[0].windows=287;assert.equal(buildAdminReport(raw).changes.product_opens,null);
  fullAdminCoverage(raw);raw.refreshed_at='2026-03-10T09:00:00Z';assert.equal(buildAdminReport(raw).changes.product_opens,null);assert.equal(buildAdminReport(raw).stale,true);
  assert.equal(buildAdminReport(fullAdminCoverage(adminFixture())).changes.product_opens,null);
 });
 it('keeps event and batch health units separate and missing diagnostics unknown',()=>{
  const raw=adminFixture();raw.health=[{day:'2026-03-09',metric:'accepted',value:3},{day:'2026-03-09',metric:'write_failed_batches',value:1}];const r=buildAdminReport(raw);
  assert.deepEqual(r.health.find(h=>h.metric==='accepted'),{metric:'accepted',unit:'events',value:3});assert.deepEqual(r.health.find(h=>h.metric==='write_failed_batches'),{metric:'write_failed_batches',unit:'batches',value:1});assert.equal(r.health.find(h=>h.metric==='duplicates')?.value,null);
 });
 it('whitelists outgoing business and reconciliation fields',()=>{
  const raw=adminFixture();Object.assign(raw.snapshot,{email:'never-return@example.invalid',actor_id:'private-actor'});Object.assign(raw,{session_id:'private-session',query:'private query'});
  raw.reconciliation={checked_at:'2026-03-10T11:30:00Z',collection_mismatches:1,user_mismatches:2};Object.assign(raw.reconciliation,{payload:'private payload'});
  const text=JSON.stringify(buildAdminReport(raw));assert.doesNotMatch(text,/private-|never-return|private query|private payload|actor_id|session_id/);
  assert.doesNotMatch(text,/watch_duration|completion_rate|replay|checkpoint|playback/i);
 });
 it('rejects invalid counts, unexpected dimensions/statuses/metrics and impossible dates',()=>{
  assert.throws(()=>buildAdminReport({...adminFixture(),end_day:'2026-02-31'}));
  for(const value of [-1,NaN,1.2,Number.MAX_SAFE_INTEGER+1]){const raw=adminFixture();record(raw,'product_opens',value);assert.throws(()=>buildAdminReport(raw));}
  const raw=adminFixture();record(raw,'product_opens',1,'2026-03-09','category:private-free-text');assert.throws(()=>buildAdminReport(raw));
  const bad=adminFixture();record(bad,'watch_duration' as AdminMetric,1);assert.throws(()=>buildAdminReport(bad));
  assert.throws(()=>buildAdminReport({...adminFixture(),source_statuses:[{status:'private failure text',value:1}]}));
 });
 it('fails closed on inconsistent ratio populations rather than reporting percentages over 100',()=>{
  const raw=adminFixture();record(raw,'search_responses',1);record(raw,'search_zero_matches',2);assert.throws(()=>buildAdminReport(raw));
  const extracted=adminFixture();extracted.extraction.bound_product_candidates=1;assert.throws(()=>buildAdminReport(extracted));
 });
});
