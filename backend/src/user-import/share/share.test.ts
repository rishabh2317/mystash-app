import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseAcceptance, parseIntent, ShareError } from './contracts';
import { ShareAcceptanceService, type AcceptanceReply, type ShareAcceptanceStore } from './service';
import { assessSimilar, type ReviewCandidate } from './similarity';
import { rankForIntent } from './intentRanking';
import { parseHistoryCursor } from './history';

const capture=randomUUID(),url='https://youtube.com/shorts/ASkP2CRZOfc';
test('normalizes native deliveries through the existing source identity and hashes private intent',()=>{
 const value=parseAcceptance({text:url,clientCaptureId:capture,intent:{kind:'product',note:'brown handbag'}});
 assert.equal(value.identity.externalId,'ASkP2CRZOfc');assert.equal(value.digest.length,64);
 assert.notEqual(value.digest,parseAcceptance({text:url,clientCaptureId:capture}).digest);
 for(const text of ['http://127.0.0.1/private','javascript:alert(1)','https://user:password@example.com/'])assert.throws(()=>parseAcceptance({text,clientCaptureId:capture}));
 assert.throws(()=>parseAcceptance({text:url,clientCaptureId:capture,userId:randomUUID()}));
});
test('optional Unicode notes have a strict cap and typed kind',()=>{
 assert.equal(parseIntent({kind:null,note:'   '}).note,null);
 assert.equal(parseIntent({kind:'both',note:'😀'.repeat(280)}).note?.length,560);
 assert.throws(()=>parseIntent({kind:'product',note:'x'.repeat(281)}));
 assert.throws(()=>parseIntent({kind:'anything',note:null}));
});
test('acceptance uses no extraction, handles lost ACKs, and never reapplies intent on receipt replay',async()=>{
 const receipts=new Map<string,AcceptanceReply>();let writes=0,context=0;
 const store:ShareAcceptanceStore={
  async accept(user,input){const key=user+input.clientCaptureId;const existing=receipts.get(key);if(existing)return{...existing,replayed:true};
   const reply:AcceptanceReply={protocolVersion:2,importId:randomUUID(),created:true,replayed:false,delivery:'accepted'};receipts.set(key,reply);writes++;return reply;},
  async captureIntent(){context++;return{state:'saved',revision:1};},async updateIntent(){return 2;},
 };
 const service=new ShareAcceptanceService(store,async()=>true,()=>false);
 const body={text:url,clientCaptureId:capture};
 const replies=await Promise.all(Array.from({length:30},()=>service.accept('owner',body)));
 assert.equal(new Set(replies.map(r=>r.importId)).size,1);assert.equal(writes,1);assert.equal(context,0);
 await service.accept('different-owner',body);assert.equal(writes,2);
});
test('capacity and disabled intent do not discard or acknowledge pending shares',async()=>{
 let writes=0;const store={accept:async()=>{writes++;throw Error();}} as unknown as ShareAcceptanceStore;
 const denied=new ShareAcceptanceService(store,async()=>false,()=>false);
 await assert.rejects(()=>denied.accept('user',{text:url,clientCaptureId:capture}),e=>e instanceof ShareError&&e.status===429);
 await assert.rejects(()=>denied.accept('user',{text:url,clientCaptureId:capture,intent:{kind:'place',note:null}}));assert.equal(writes,0);
});
const product={name:'Brown leather handbag',brand:null,model:null,category:'Bags',confidence:0.95};
const candidate:ReviewCandidate={title:'Brown leather handbag',brand:null,model:null,category:'Bags',image:null,
 merchantUrl:'https://www.shop.example/products/brown-leather-handbag',merchant:'Shop',score:1,pdpVerdict:'pdp',pdpScore:1,sourceTier:'retailer',verifiedCatalogId:randomUUID()};
test('similar policy returns at most three distinct reviewed suggestions and does not mutate exact policy',()=>{
 const result=assessSimilar(product,Array.from({length:8},(_,i)=>({...candidate,merchantUrl:candidate.merchantUrl+i})));
 assert.equal(result.kind,'similar');assert.equal(result.suggestions.length,3);
 assert.equal(assessSimilar(product,[candidate],true).kind,'exact');
 assert.equal(assessSimilar({...product,name:'Handbag'},[candidate]).kind,'unable_to_identify');
});
test('rejects weak provenance, accessory, brand/model/variant conflict, non-commerce and invented destinations',()=>{
 for(const bad of [
  {...candidate,verifiedCatalogId:undefined,enrichmentSucceeded:false},
  {...candidate,title:'Brown leather handbag strap accessory'},
  {...candidate,merchantUrl:'https://www.shop.example/search?q=bag'},
  {...candidate,merchantUrl:'javascript:alert(1)'},
  {...candidate,pdpVerdict:'uncertain' as const},
 ]) assert.equal(assessSimilar(product,[bad]).suggestions.length,0);
 assert.equal(assessSimilar({...product,brand:'Gucci'},[{...candidate,brand:'Prada',title:'Prada brown leather handbag'}]).suggestions.length,0);
 assert.equal(assessSimilar({...product,name:'Brown leather handbag mini',model:'Mini'},[{...candidate,model:'Max',title:'Brown leather handbag Max'}]).suggestions.length,0);
 assert.equal(assessSimilar(product,[{...candidate,title:'White leather handbag'}]).suggestions.length,0);
});
test('private intent only reorders existing results and is stable without supporting evidence',()=>{
 const rows=[{name:'Red mug'},{name:'Brown leather handbag'},{name:'Café'}];
 assert.equal(rankForIntent(rows,{kind:'product',note:'brown handbag'},r=>r.name)[0],rows[1]);
 assert.deepEqual(rankForIntent(rows,{kind:'place',note:null},r=>r.name),rows);
 assert.equal(rows[0].name,'Red mug');
});
test('history cursors reject injection and malformed or oversized values',()=>{
 assert.equal(parseHistoryCursor(undefined),null);
 assert.throws(()=>parseHistoryCursor('x'.repeat(300)));
 assert.throws(()=>parseHistoryCursor(Buffer.from(JSON.stringify({id:'bad',created_at:'now()'})).toString('base64url')));
 const date=new Date().toISOString(),id=randomUUID();
 assert.deepEqual(parseHistoryCursor(Buffer.from(JSON.stringify({id,created_at:date})).toString('base64url')),{id,created_at:date});
  const micro='2026-11-02T08:48:59.699063+00:00';
  assert.equal(parseHistoryCursor(Buffer.from(JSON.stringify({id,created_at:micro})).toString('base64url'))?.created_at,micro);
});
