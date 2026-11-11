import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {FindQueryService} from './queryService';
const id='11111111-1111-4111-8111-111111111111';
const make=()=>{
 const detail={id,products:[{id,title:'Black mini dress',identityKey:null,catalogProductId:null,discoveredProductId:null,matchKind:'possible',saved:false,removed:false,imageUrl:null,discoverySeed:{brand:'ZARA',attributes:[{attribute:'brand',value:'ZARA',origin:'source_text'}]}}],places:[],outcome:{version:1,category:'completed',result:'partial',products:'failed',places:'complete',discoveryProducts:1,foundProducts:0,foundPlaces:0,resolvedPlaces:0,unverifiedPlaces:0,savedProducts:0,savedPlaces:0,stashSync:'complete',canRetryExtraction:true,canRetrySaving:false,extractionActive:false,delayed:false,finishedAt:null}};
 const calls:unknown[]=[];
 const db={rpc(name:string,args:Record<string,unknown>){calls.push([name,args]);return{abortSignal:async()=>args.p_user==='owner'?{data:detail,error:null}:{data:null,error:{code:'P0002'}}};}} as unknown as SupabaseClient;
 return {service:new FindQueryService(db),calls,detail};
};
test('owner-authorized discovery uses the requesting country without external discovery or identity writes',async()=>{
 const f=make();const india=await f.service.detail('owner',id,'IN');const usa=await f.service.detail('owner',id,'US');
 assert.match(india.products[0].discovery!.url,/zara.com\/in\//);assert.match(usa.products[0].discovery!.url,/zara.com\/us\//);
 assert.equal(india.products[0].identityKey,null);assert.equal('discoverySeed' in india.products[0],false);
 assert.deepEqual(f.calls.map(c=>(c as unknown[])[0]),['find_detail','find_detail']);
 await assert.rejects(f.service.detail('stranger',id,'IN'),/find_not_found/);
});
test('confirmed-only pages neither resolve country nor expose fallback actions',async()=>{
 const f=make();Object.assign(f.detail.products[0],{identityKey:'d:'+id});
 const d=await f.service.detail('owner',id,async()=>{throw new Error('Unnecessary country lookup');});
 assert.equal(d.products[0].discovery,null);
});
