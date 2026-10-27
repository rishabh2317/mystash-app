import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {runCreatorRollup,startAnalyticsMaintenance} from './worker';
describe('creator rollup staging gates',()=>{
 it('keeps all worker calls off by default',async t=>{
  const keys=['ANALYTICS_ROLLUPS_ENABLED','ANALYTICS_ADMIN_ROLLUPS_ENABLED','ANALYTICS_MAINTENANCE_ENABLED','ANALYTICS_ENABLED'];const saved=keys.map(k=>process.env[k]);
  keys.forEach(k=>delete process.env[k]);t.after(()=>keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];}));
  const db={rpc(){throw new Error('must not touch database');}} as unknown as SupabaseClient;
  await runCreatorRollup(db);startAnalyticsMaintenance(db).close();
 });
 it('samples actual collection availability and propagates rollup failures',async t=>{
  const saved=[process.env.ANALYTICS_ROLLUPS_ENABLED,process.env.ANALYTICS_ENABLED];
  t.after(()=>['ANALYTICS_ROLLUPS_ENABLED','ANALYTICS_ENABLED'].forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];}));
  process.env.ANALYTICS_ROLLUPS_ENABLED='true';delete process.env.ANALYTICS_ENABLED;const calls:unknown[]=[];
  const db={async rpc(name:string,args:unknown){calls.push([name,args]);return {error:null};}} as unknown as SupabaseClient;
  await runCreatorRollup(db);process.env.ANALYTICS_ENABLED='true';await runCreatorRollup(db);
  assert.deepEqual(calls,[['analytics_rollup_creators',{p_measurement_enabled:false}],['analytics_rollup_creators',{p_measurement_enabled:true}]]);
  await assert.rejects(()=>runCreatorRollup({async rpc(){return {error:{code:'failure'}};}} as unknown as SupabaseClient));
 });
});
