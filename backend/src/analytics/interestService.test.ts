import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {refreshInterestProfile,runInterestProfiles} from './interestService';
const uuid=(n:number)=>`30000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
function flags(t:{after:(fn:()=>void)=>void},enabled=false){const keys=['ANALYTICS_ENABLED','ANALYTICS_PERSONALIZATION_ENABLED','ANALYTICS_INTEREST_WORKER_ENABLED'];const old=keys.map(k=>process.env[k]);keys.forEach(k=>process.env[k]=enabled?'true':'false');t.after(()=>keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}));}
const source=()=>({revision:uuid(999),since:'2026-03-01T00:00:00Z',observed_at:'2026-03-10T00:00:00Z',policy_version:1,current:[],events:[]});
describe('interest worker staging and bounded processing',()=>{
 it('does no profiling work with default flags or global collection disabled',async t=>{flags(t);const db={rpc(){throw new Error('No calls allowed');}} as unknown as SupabaseClient;assert.equal(await refreshInterestProfile(db,uuid(1)),false);await runInterestProfiles(db);process.env.ANALYTICS_PERSONALIZATION_ENABLED='true';process.env.ANALYTICS_INTEREST_WORKER_ENABLED='true';await runInterestProfiles(db);});
 it('does not create an absent/withdrawn purpose profile',async t=>{flags(t,true);let count=0;const db={async rpc(){count++;return {data:null,error:null};}} as unknown as SupabaseClient;assert.equal(await refreshInterestProfile(db,uuid(1)),false);assert.equal(count,1);});
 it('commits with the source epoch and propagates a concurrent withdrawal rejection',async t=>{flags(t,true);const calls:unknown[]=[];const db={async rpc(name:string,args:unknown){calls.push([name,args]);return {data:name==='analytics_interest_source'?source():false,error:null};}} as unknown as SupabaseClient;
  assert.equal(await refreshInterestProfile(db,uuid(1)),false);assert.deepEqual(calls[1],['analytics_interest_store',{p_user_id:uuid(1),p_revision:uuid(999),p_features:[],p_capped:false,p_observed_at:source().observed_at}]);
 });
 it('processes leased accounts with at most four in flight',async t=>{flags(t,true);let active=0,max=0,stored=0;const db={async rpc(name:string){if(name==='analytics_interest_claim')return {data:Array.from({length:9},(_,i)=>uuid(i+1)),error:null};if(name==='analytics_interest_source'){active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;return {data:source(),error:null};}stored++;return {data:true,error:null};}} as unknown as SupabaseClient;
  await runInterestProfiles(db);assert.equal(stored,9);assert.ok(max<=4);
 });
 it('rejects oversized/malformed claims and reports partial failure without identities',async t=>{flags(t,true);for(const data of [['bad'],Array.from({length:101},(_,i)=>uuid(i+1))])await assert.rejects(()=>runInterestProfiles({async rpc(){return {data,error:null};}} as unknown as SupabaseClient));
  await assert.rejects(()=>runInterestProfiles({async rpc(name:string){return name==='analytics_interest_claim'?{data:[uuid(1)],error:null}:{data:null,error:{code:'private'}};}} as unknown as SupabaseClient),/Interest batch incomplete/);
 });
});
