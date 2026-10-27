import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response,requireAuthUserId} from '../auth/requireAuth';
import {registerAdminReporting} from './adminRoutes';
import {adminFixture} from './testFixtures/adminReport';
function enabled(t:{after:(fn:()=>void)=>void}){const old=process.env.ANALYTICS_ADMIN_REPORTING_ENABLED;process.env.ANALYTICS_ADMIN_REPORTING_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_ADMIN_REPORTING_ENABLED;else process.env.ANALYTICS_ADMIN_REPORTING_ENABLED=old;});}
function harness(options:{actor?:string|null;member?:boolean;permissionError?:boolean;reportError?:string}={}){
 let handle:(req:Request,res:Response)=>Promise<void>=async()=>{};const calls:{name:string;args:unknown}[]=[];
 const admin={async rpc(name:string,args:unknown){calls.push({name,args});return name==='analytics_admin_authorized'?{data:options.member??true,error:options.permissionError?{code:'sensitive permission error'}:null}:{data:adminFixture(),error:options.reportError?{code:options.reportError,details:'sensitive SQL'}:null};}} as unknown as SupabaseClient;
 const auth=(async(_req:Request,res:Response)=>{const id=options.actor===undefined?'verified-self':options.actor;if(!id)res.status(401).json({error:'Unauthorized'});return id;}) as typeof requireAuthUserId;
 registerAdminReporting({get(path:string,fn:typeof handle){assert.equal(path,'/analytics/admin');handle=fn;}} as unknown as Express,admin,auth);
 return {calls,async request(query:Record<string,unknown>={}){let status=200,body:unknown;const headers:Record<string,string>={};
  const res={status(n:number){status=n;return res;},json(v:unknown){body=v;return res;},setHeader(k:string,v:string){headers[k]=v;}} as unknown as Response;
  await handle({query,body:{admin_id:'other',role:'admin'},headers:{'x-admin':'true'}} as unknown as Request,res);return {status,body,headers};}};
}
describe('admin analytics API authorization',()=>{
 it('defaults off without database access',async t=>{const old=process.env.ANALYTICS_ADMIN_REPORTING_ENABLED;delete process.env.ANALYTICS_ADMIN_REPORTING_ENABLED;t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_ADMIN_REPORTING_ENABLED;else process.env.ANALYTICS_ADMIN_REPORTING_ENABLED=old;});const h=harness();assert.equal((await h.request()).status,503);assert.equal(h.calls.length,0);});
 it('requires a verified session before permission queries',async t=>{enabled(t);const h=harness({actor:null});assert.equal((await h.request()).status,401);assert.equal(h.calls.length,0);});
 it('denies ordinary creators/users regardless of client role claims',async t=>{enabled(t);const h=harness({member:false});assert.equal((await h.request()).status,403);assert.deepEqual(h.calls,[{name:'analytics_admin_authorized',args:{p_user_id:'verified-self'}}]);});
 it('rejects arbitrary scopes, actor overrides and unbounded ranges',async t=>{enabled(t);const h=harness();for(const query of [{admin_id:'other'},{days:'365'},{days:['7']},{actor_id:'other'},{export:'raw'}])assert.equal((await h.request(query)).status,400);assert.equal(h.calls.length,0);});
 it('uses verified self in both permission and report RPCs with no-store headers',async t=>{enabled(t);const h=harness();const r=await h.request({days:'7'});assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.deepEqual(h.calls,[{name:'analytics_admin_authorized',args:{p_user_id:'verified-self'}},{name:'analytics_admin_report',args:{p_admin_id:'verified-self',p_days:7}}]);});
 it('fails closed on permission errors and membership revoked between checks',async t=>{enabled(t);const failed=harness({permissionError:true});assert.equal((await failed.request()).status,503);assert.equal(failed.calls.length,1);const revoked=await harness({reportError:'42501'}).request();assert.equal(revoked.status,403);assert.doesNotMatch(JSON.stringify(revoked.body),/sensitive|42501/);});
 it('limits expensive reports without caching authorization',async t=>{enabled(t);const h=harness();for(let i=0;i<12;i++)assert.equal((await h.request()).status,200);const limited=await h.request();assert.equal(limited.status,429);assert.equal(limited.headers['Retry-After'],'60');assert.equal(h.calls.filter(c=>c.name==='analytics_admin_report').length,12);assert.equal(h.calls.filter(c=>c.name==='analytics_admin_authorized').length,13);});
 it('returns generic database failure responses',async t=>{enabled(t);const r=await harness({reportError:'private_database_error'}).request();assert.equal(r.status,503);assert.deepEqual(r.body,{error:'Admin reporting unavailable'});});
});
