import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {runAdminRollup,startAnalyticsMaintenance} from './worker';
function flags(t:{after:(fn:()=>void)=>void}){const keys=['ANALYTICS_ADMIN_ROLLUPS_ENABLED','ANALYTICS_ROLLUPS_ENABLED','ANALYTICS_MAINTENANCE_ENABLED','ANALYTICS_ENABLED'];const old=keys.map(k=>process.env[k]);keys.forEach(k=>delete process.env[k]);t.after(()=>keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}));}
describe('admin rollup gates and retention ordering',()=>{
 it('does no work by default',async t=>{flags(t);const db={rpc(){throw new Error('must not call');}} as unknown as SupabaseClient;await runAdminRollup(db);startAnalyticsMaintenance(db).close();});
 it('uses the collection flag as a coverage sample without enabling it',async t=>{flags(t);process.env.ANALYTICS_ADMIN_ROLLUPS_ENABLED='true';const calls:unknown[]=[];const db={async rpc(name:string,args:unknown){calls.push([name,args]);return {error:null};}} as unknown as SupabaseClient;
  await runAdminRollup(db);process.env.ANALYTICS_ENABLED='true';await runAdminRollup(db);assert.deepEqual(calls,[['analytics_rollup_admin',{p_measurement_enabled:false}],['analytics_rollup_admin',{p_measurement_enabled:true}]]);
 });
 it('runs privacy retention independently despite a rollup error',async t=>{flags(t);process.env.ANALYTICS_ADMIN_ROLLUPS_ENABLED='true';process.env.ANALYTICS_MAINTENANCE_ENABLED='true';const calls:string[]=[];
  const db={async rpc(name:string){calls.push(name);return {error:name==='analytics_rollup_admin'?{code:'failure'}:null};}} as unknown as SupabaseClient;
  const worker=startAnalyticsMaintenance(db);t.after(()=>worker.close());await new Promise<void>(resolve=>setImmediate(resolve));assert.deepEqual(calls.slice().sort(),['analytics_maintenance','analytics_rollup_admin']);
 });
});
