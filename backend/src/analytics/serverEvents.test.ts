import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Request} from '../auth/requireAuth';
import {recordSearchResponse} from './serverEvents';
describe('authoritative search measurement',()=>{
 it('keeps original ranks, stores no raw query, and requires an acknowledged result',async t=>{
  const old=process.env.ANALYTICS_ENABLED;process.env.ANALYTICS_ENABLED='true';
  t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_ENABLED;else process.env.ANALYTICS_ENABLED=old;});
  const id='10000000-0000-4000-8000-000000000001',productId='30000000-0000-4000-8000-000000000001';
  let payload:Record<string,unknown>={};
  const admin={async rpc(_name:string,args:Record<string,unknown>){payload=args;return {data:{accepted:[id]},error:null};}} as unknown as SupabaseClient;
  const req={headers:{'x-mystash-session':'50000000-0000-4000-8000-000000000001','x-mystash-search-id':id,
    'x-mystash-anonymous-consent':'1','x-mystash-platform':'ios','x-mystash-app-version':'1.0.0'}} as unknown as Request;
  const result=await recordSearchResponse(admin,req,null,{results:[{id:'invalid-legacy-id',entityType:'product'},{id:productId,entityType:'product'}],
    matchingCount:2,fallbackCount:0,latencyMs:10,retrievalMode:'lexical_only',filterKeys:[],queryLength:20});
  assert.equal(result,id);assert.deepEqual(payload.p_search_results,[{id:productId,entity_type:'product',rank:1}]);
  assert.doesNotMatch(JSON.stringify(payload),/raw_input|query_text|email|destination_url/);
 });
});
