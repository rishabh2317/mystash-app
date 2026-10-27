import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response,requireAuthUserId} from '../auth/requireAuth';
import {registerAnalyticsRoutes} from './routes';
describe('privacy withdrawal during global shutdown',()=>{
 it('delegates decreases to the locked live-consent RPC, forbids increases there, and returns private actual settings',async t=>{
  const old=process.env.ANALYTICS_ENABLED;process.env.ANALYTICS_ENABLED='false';t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_ENABLED;else process.env.ANALYTICS_ENABLED=old;});
  const handlers=new Map<string,(req:Request,res:Response)=>Promise<void>>(),calls:Record<string,unknown>[]=[];
  const app={get(path:string,fn:never){handlers.set(`GET ${path}`,fn);},delete(){},post(){},put(path:string,fn:never){handlers.set(`PUT ${path}`,fn);}} as unknown as Express;
  const prefs={measurement_enabled:true,activity_enabled:true,revision:'10000000-0000-4000-8000-000000000001',policy_version:1};
  const db={from(){return {select(){return {eq(){return {async maybeSingle(){return {data:prefs,error:null};}};}};}};},async rpc(_name:string,args:Record<string,unknown>){calls.push(args);return {error:args.p_expected_revision==='10000000-0000-4000-8000-000000000099'?{code:'40001'}:null,data:prefs};}} as unknown as SupabaseClient;
  registerAnalyticsRoutes(app,db,(async()=> 'verified-self') as typeof requireAuthUserId);
  const request=async(method:string,body?:unknown)=>{let status=200,cache='',value:unknown;const res={setHeader(_k:string,v:string){cache=v;},status(n:number){status=n;return res;},json(v:unknown){value=v;return res;}} as unknown as Response;await handlers.get(`${method} /analytics/preferences`)!({body} as Request,res);assert.equal(cache,'private, no-store');return {status,value};};
  assert.equal((await request('PUT',{measurement_enabled:false,activity_enabled:false})).status,200);
  assert.equal((await request('PUT',{measurement_enabled:true,activity_enabled:false,decrease_only:true})).status,200);
  assert.deepEqual(calls.map(a=>[a.p_allow_increase,a.p_decrease_only]),[[false,false],[false,true]]);
  assert.deepEqual((await request('GET')).value,{enabled:false,preferences:prefs});
  assert.equal((await request('PUT',{measurement_enabled:true,activity_enabled:true,expected_revision:'10000000-0000-4000-8000-000000000099'})).status,409);
  assert.equal((await request('PUT',{measurement_enabled:true,activity_enabled:false,expected_revision:[prefs.revision]})).status,400);
 });
});
