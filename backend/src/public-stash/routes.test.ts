import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Express,Request,Response} from 'express';
import type {SupabaseClient} from '@supabase/supabase-js';
import {registerPublicStashRoutes} from './routes';
import type {requireAuthUserId} from '../auth/requireAuth';
const id='11111111-1111-4111-8111-111111111111';
type Handler=(req:Request,res:Response)=>Promise<void>;
function harness(actor:string|null=id,errorCode?:string){
 const handlers=new Map<string,Handler>(),calls:{name:string;args:Record<string,unknown>}[]=[];
 const db={rpc(name:string,args:Record<string,unknown>){calls.push({name,args});return {async abortSignal(){return {error:errorCode?{code:errorCode}:null,data:name==='public_stash_read'?{publicId:id,curator:{username:'curator',avatarUrl:'https://x.supabase.co/storage/v1/object/sign/private/avatar?token=canary'},counts:{products:1,places:0},items:[{id,title:'Mug',namespace:'catalog',image:'https://merchant.example/image.jpg',cursor_time:'2026-11-17T00:00:00Z',cursor_id:id,source_url:'private-canary',metadata:{secret:'canary'}}]}:{publicId:id,visibility:'private',version:0,products:[],places:[]}};}};}} as unknown as SupabaseClient;
 const app={get(path:string,handler:Handler){handlers.set(`GET ${path}`,handler);},put(path:string,handler:Handler){handlers.set(`PUT ${path}`,handler);},post(path:string,handler:Handler){handlers.set(`POST ${path}`,handler);}} as unknown as Express;
 const authenticate=(async(_req:Request,res:Response)=>{if(!actor)res.status(401).json({error:'Unauthorized'});return actor;}) as typeof requireAuthUserId;
 registerPublicStashRoutes(app,{db,authenticate});
 return {calls,async request(route:string,body:Record<string,unknown>={},query:Record<string,string>={}){
  let status=200,result:unknown;const headers:Record<string,string>={};
  const req={params:{publicId:id,membershipId:id},body,query,headers:{},socket:{remoteAddress:'127.0.0.1'}} as unknown as Request;
  const res={setHeader(k:string,v:string){headers[k]=v;},status(n:number){status=n;return res;},json(v:unknown){result=v;return res;}} as unknown as Response;
  const handle=handlers.get(route);assert.ok(handle,route);await handle(req,res);return {status,result,headers};
 }};
}
test('public routes are disabled by default without reading the database',async t=>{
 const old=process.env.PUBLIC_STASH_ENABLED;delete process.env.PUBLIC_STASH_ENABLED;t.after(()=>{if(old===undefined)delete process.env.PUBLIC_STASH_ENABLED;else process.env.PUBLIC_STASH_ENABLED=old;});
 const h=harness();assert.equal((await h.request('GET /public-stashes/:publicId')).status,404);assert.equal(h.calls.length,0);
});
test('public list response strips cursor identities, source metadata and private avatar URLs',async t=>{
 const old=process.env.PUBLIC_STASH_ENABLED;process.env.PUBLIC_STASH_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.PUBLIC_STASH_ENABLED;else process.env.PUBLIC_STASH_ENABLED=old;});
 const h=harness();const r=await h.request('GET /public-stashes/:publicId');assert.equal(r.status,200);assert.match(r.headers['Cache-Control'],/no-store/);assert.doesNotMatch(JSON.stringify(r.result),/canary|cursor_id|cursor_time|source_url|metadata/);
});
test('owner mutations derive their actor from auth and reject actor injection',async t=>{
 const old=process.env.PUBLIC_STASH_ENABLED;process.env.PUBLIC_STASH_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.PUBLIC_STASH_ENABLED;else process.env.PUBLIC_STASH_ENABLED=old;});
 const guest=harness(null);assert.equal((await guest.request('PUT /public-stashes/me/visibility',{visibility:'public',expectedVersion:0})).status,401);assert.equal(guest.calls.length,0);
 const h=harness();assert.equal((await h.request('PUT /public-stashes/me/visibility',{visibility:'public',expectedVersion:0,userId:'other'})).status,400);assert.equal(h.calls.length,0);
 await h.request('PUT /public-stashes/me/visibility',{visibility:'public',expectedVersion:0});assert.equal(h.calls[0].args.p_user,id);
});
test('owner preview requires authentication and private reads expose only unavailable',async t=>{
 const old=process.env.PUBLIC_STASH_ENABLED;process.env.PUBLIC_STASH_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.PUBLIC_STASH_ENABLED;else process.env.PUBLIC_STASH_ENABLED=old;});
 const guest=harness(null);assert.equal((await guest.request('GET /public-stashes/:publicId',{}, {preview:'1'})).status,401);assert.equal(guest.calls.length,0);
 const hidden=harness(id,'P0002');const r=await hidden.request('GET /public-stashes/:publicId');assert.equal(r.status,404);assert.deepEqual(r.result,{error:'Stash unavailable'});
});

test('expected-version conflict preserves HTTP 409 from PostgREST',async t=>{
 const old=process.env.PUBLIC_STASH_ENABLED;process.env.PUBLIC_STASH_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.PUBLIC_STASH_ENABLED;else process.env.PUBLIC_STASH_ENABLED=old;});
 const h=harness(id,'PT409');assert.equal((await h.request('PUT /public-stashes/me/visibility',{visibility:'public',expectedVersion:0})).status,409);
});
