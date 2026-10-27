import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response,requireAuthUserId} from '../auth/requireAuth';
import {registerInterestRoutes} from './interestRoutes';
const uuid='30000000-0000-4000-8000-000000000001';
function flags(t:{after:(fn:()=>void)=>void},enabled=false){const keys=['ANALYTICS_ENABLED','ANALYTICS_PERSONALIZATION_ENABLED'];const old=keys.map(k=>process.env[k]);for(const key of keys)process.env[key]=enabled?'true':'false';t.after(()=>keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}));}
function harness(actor:string|null='verified-self',code?:string){
 const handlers=new Map<string,(req:Request,res:Response)=>Promise<void>>(),calls:{name:string;args:unknown}[]=[];
 const route=(method:string)=>(path:string,fn:(req:Request,res:Response)=>Promise<void>)=>handlers.set(method+path,fn);
 const admin={async rpc(name:string,args:unknown){calls.push({name,args});return {error:code?{code,details:'private database details'}:null,data:name==='analytics_interest_read'?{status:'disabled',features:[]}:null};}} as unknown as SupabaseClient;
 const auth=(async(_req:Request,res:Response)=>{if(!actor)res.status(401).json({error:'Unauthorized'});return actor;}) as typeof requireAuthUserId;
 registerInterestRoutes({get:route('GET'),put:route('PUT'),delete:route('DELETE')} as unknown as Express,admin,auth);
 return {calls,async request(method:string,path:string,body?:unknown,query:Record<string,unknown>={}){let status=200,result:unknown;const headers:Record<string,string>={};const res={status(n:number){status=n;return res;},json(v:unknown){result=v;return res;},setHeader(k:string,v:string){headers[k]=v;}} as unknown as Response;
  await handlers.get(method+path)!({body,query} as Request,res);return {status,result,headers};}};
}
describe('self-only personalization privacy API',()=>{
 it('blocks profile building/enablement with feature flags off but permits withdrawal and reset',async t=>{flags(t);const h=harness();assert.equal((await h.request('GET','/analytics/interests')).status,503);assert.equal(h.calls.length,0);
  assert.equal((await h.request('PUT','/analytics/personalization',{enabled:true,policy_version:1,expected_revision:uuid,measurement_revision:uuid})).status,503);assert.equal(h.calls.length,0);
  assert.equal((await h.request('PUT','/analytics/personalization',{enabled:false})).status,200);assert.equal((await h.request('DELETE','/analytics/interests')).status,200);
  assert.deepEqual(h.calls.map(c=>c.name),['analytics_set_personalization','analytics_reset_interests']);
 });
 it('requires a verified self for settings, mutations and profile reads',async t=>{flags(t,true);const h=harness(null);for(const [m,p,b] of [['GET','/analytics/personalization',undefined],['PUT','/analytics/personalization',{enabled:false}],['DELETE','/analytics/interests',undefined],['GET','/analytics/interests',undefined]] as const)assert.equal((await h.request(m,p,b)).status,401);assert.equal(h.calls.length,0);});
 it('rejects identity overrides, unknown purposes, missing receipts and policy mismatches',async t=>{flags(t,true);const h=harness();for(const body of [{enabled:true},{enabled:true,policy_version:2,expected_revision:uuid,measurement_revision:uuid},{enabled:false,user_id:'other'},{enabled:false,features:[]},{enabled:false,expected_revision:uuid}])assert.equal((await h.request('PUT','/analytics/personalization',body)).status,400);
  assert.equal((await h.request('GET','/analytics/interests',undefined,{user_id:'other'})).status,400);assert.equal((await h.request('DELETE','/analytics/interests',{user_id:'other'})).status,400);assert.equal(h.calls.length,0);
 });
 it('binds both consent receipts to verified self and maps conflicts without leaking SQL',async t=>{flags(t,true);const h=harness();const r=await h.request('PUT','/analytics/personalization',{enabled:true,policy_version:1,expected_revision:uuid,measurement_revision:uuid});assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.deepEqual(h.calls,[{name:'analytics_set_personalization',args:{p_user_id:'verified-self',p_enabled:true,p_expected_revision:uuid,p_measurement_revision:uuid,p_policy:1}}]);
  const error=await harness('self','40001').request('PUT','/analytics/personalization',{enabled:true,policy_version:1,expected_revision:uuid,measurement_revision:uuid});assert.equal(error.status,409);assert.doesNotMatch(JSON.stringify(error.result),/private|40001/);
 });
 it('queries only self and never falls back to another account or anonymous history',async t=>{flags(t,true);const h=harness();const r=await h.request('GET','/analytics/interests');assert.deepEqual(r.result,{status:'disabled',features:[]});assert.deepEqual(h.calls,[{name:'analytics_interest_source',args:{p_user_id:'verified-self'}},{name:'analytics_interest_read',args:{p_user_id:'verified-self'}}]);});
 it('rate-limits rebuild reads while keeping withdrawal available',async t=>{flags(t,true);const h=harness();for(let n=0;n<6;n++)assert.equal((await h.request('GET','/analytics/interests')).status,200);assert.equal((await h.request('GET','/analytics/interests')).status,429);assert.equal((await h.request('PUT','/analytics/personalization',{enabled:false})).status,200);});
 it('keeps privacy inspection available during shutdown and returns generic database errors',async t=>{flags(t);const h=harness();assert.equal((await h.request('GET','/analytics/personalization')).status,200);const failed=await harness('self','private').request('DELETE','/analytics/interests');assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.result),/private/);});
});
