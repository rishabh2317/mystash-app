import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response,requireAuthUserId} from '../auth/requireAuth';
import {registerCreatorReporting} from './creatorRoutes';
function harness(actor:string|null='verified-self',error:{code:string}|null=null){
 let handle:(req:Request,res:Response)=>Promise<void>=async()=>{};const calls:unknown[]=[];
 const app={get(path:string,fn:typeof handle){assert.equal(path,'/analytics/creator');handle=fn;}} as unknown as Express;
 const admin={async rpc(name:string,args:unknown){calls.push([name,args]);return {error,data:{days:7,end_day:'2026-03-10',generated_at:'2026-03-10T12:00:00Z',refreshed_at:null,daily:[],coverage:[],top_collections:[],top_products:[]}};}} as unknown as SupabaseClient;
 const auth=(async(_req:Request,res:Response)=>{if(!actor)res.status(401).json({error:'Unauthorized'});return actor;}) as typeof requireAuthUserId;
 registerCreatorReporting(app,admin,auth);
 return {calls,async request(query:Record<string,unknown>={}){let status=200,body:unknown;const headers:Record<string,string>={};
  const res={setHeader(k:string,v:string){headers[k]=v;},status(n:number){status=n;return res;},json(v:unknown){body=v;return res;}} as unknown as Response;
  await handle({query} as Request,res);return {status,body,headers};}};
}
describe('creator reporting endpoint security',()=>{
 it('defaults off and makes no data calls',async t=>{const old=process.env.ANALYTICS_CREATOR_REPORTING_ENABLED;delete process.env.ANALYTICS_CREATOR_REPORTING_ENABLED;t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_CREATOR_REPORTING_ENABLED;else process.env.ANALYTICS_CREATOR_REPORTING_ENABLED=old;});
  const h=harness();assert.equal((await h.request()).status,503);assert.equal(h.calls.length,0);
 });
 it('requires a verified self and rejects actor overrides and invalid ranges',async t=>{
  const old=process.env.ANALYTICS_CREATOR_REPORTING_ENABLED;process.env.ANALYTICS_CREATOR_REPORTING_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_CREATOR_REPORTING_ENABLED;else process.env.ANALYTICS_CREATOR_REPORTING_ENABLED=old;});
  const guest=harness(null);assert.equal((await guest.request()).status,401);assert.equal(guest.calls.length,0);
  const h=harness();for(const query of [{creator_id:'other'},{days:'365'},{days:['7']}])assert.equal((await h.request(query)).status,400);
  assert.equal(h.calls.length,0);const ok=await h.request({days:'7'});assert.equal(ok.status,200);
  assert.equal(ok.headers['Cache-Control'],'private, no-store');assert.deepEqual(h.calls,[['analytics_creator_report',{p_creator_id:'verified-self',p_days:7}]]);
 });
 it('maps creator denial and database errors without returning database detail',async t=>{
  const old=process.env.ANALYTICS_CREATOR_REPORTING_ENABLED;process.env.ANALYTICS_CREATOR_REPORTING_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_CREATOR_REPORTING_ENABLED;else process.env.ANALYTICS_CREATOR_REPORTING_ENABLED=old;});
  assert.equal((await harness('self',{code:'42501'}).request()).status,403);
  assert.deepEqual((await harness('self',{code:'private_database_detail'}).request()).body,{error:'Creator reporting unavailable'});
 });
});
