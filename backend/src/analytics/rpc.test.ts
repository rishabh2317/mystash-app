import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {analyticsRpc} from './rpc';
import {startAnalyticsMaintenance} from './worker';
describe('bounded background work and independent privacy expiry',()=>{
 it('aborts the actual request even when its transport never settles',async()=>{
  let signal:AbortSignal|undefined;
  const db={rpc(){return {abortSignal(s:AbortSignal){signal=s;return new Promise(()=>{});}};}} as unknown as SupabaseClient;
  await assert.rejects(()=>analyticsRpc(db,'hung',undefined,10),/deadline/);assert.equal(signal?.aborted,true);
 });
 it('retains independently and retries after hung aggregation/maintenance without overlaps',async t=>{
  const keys=['ANALYTICS_ROLLUPS_ENABLED','ANALYTICS_MAINTENANCE_ENABLED','ANALYTICS_ADMIN_ROLLUPS_ENABLED','ANALYTICS_INTEREST_WORKER_ENABLED'];const old=keys.map(k=>process.env[k]);
  keys.forEach(k=>process.env[k]='false');process.env.ANALYTICS_ROLLUPS_ENABLED='true';process.env.ANALYTICS_MAINTENANCE_ENABLED='true';
  t.after(()=>keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}));
  let active=0,max=0,cleanups=0,rollups=0;
  const db={rpc(name:string){if(name==='analytics_rollup_creators')rollups++;else {cleanups++;active++;max=Math.max(max,active);}
   return {abortSignal(s:AbortSignal){return new Promise(resolve=>{s.addEventListener('abort',()=>{if(name==='analytics_maintenance')active--;resolve({error:{code:'aborted'}});},{once:true});});}};
  }} as unknown as SupabaseClient;
  const worker=startAnalyticsMaintenance(db,{rpcTimeoutMs:10,tickMs:5,maintenanceTickMs:5,maintenanceIntervalMs:0});
  try{await new Promise(r=>setTimeout(r,65));assert.ok(cleanups>=2);assert.ok(rollups>=2);assert.equal(max,1);}finally{worker.close();await new Promise(r=>setTimeout(r,15));}
 });
});
