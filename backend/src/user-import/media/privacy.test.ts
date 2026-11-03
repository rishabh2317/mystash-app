import assert from 'node:assert/strict';
import {test} from 'node:test';
import {publicMerchantIdentity} from './publicIdentity';
import {privateImageContext,privateImageLogFields,imageSafeSearchCache} from './privacy';
import type {DiscoveredProductDraft} from '../../product-intelligence/domain/types';
import {MerchantEnrichmentService} from '../../product-intelligence/enrichment/MerchantEnrichmentService';
import type {MerchantEnrichmentInput} from '../../product-intelligence/enrichment/types';
test('private evidence cannot become a global identity without independently verified merchant fields',()=>{
  const draft={name:'private OCR canary',brand:null,model:null,category:null,merchantUrl:'https://www.nike.com/t/shoe',imageUrl:'https://secret.invalid/find-private-images/capture',metadata:{evidence:'private OCR canary',frameRefs:['secret'],field_provenance:{title:{source:'ai',value:'private OCR canary'}}},identityKey:'private',price:null,currency:null,merchant:null,matchConfidence:1,completeness:null} as DiscoveredProductDraft;
  assert.equal(publicMerchantIdentity(draft),null);
  draft.metadata.field_provenance={title:{source:'merchant',value:'Nike Pegasus 41'},brand:{source:'merchant',value:'Nike'},model:{source:'merchant',value:'Pegasus 41'},offer:{source:'merchant',value:{merchantUrl:'https://www.nike.com/t/pegasus-41',merchant:'Nike'}}};
  const safe=publicMerchantIdentity(draft);assert.ok(safe);assert.equal(safe.name,'Nike Pegasus 41');assert.doesNotMatch(JSON.stringify(safe),/private OCR canary|secret|frameRefs/);assert.equal(safe.imageUrl,null);
});
test('private worker logs retain only bounded operational fields',()=>{
  const fields={event:'process',contentSourceId:'opaque',query:'private OCR canary',err:Error('token=SECRET'),frameCount:1,metadata:'secret'};
  const safe=privateImageContext.run(true,()=>privateImageLogFields(fields));assert.deepEqual(safe,{event:'process',contentSourceId:'opaque',frameCount:1});
  assert.equal(privateImageLogFields(fields),fields);
});
test('image query facts never enter shared search-cache storage; URL cache behavior is retained',async()=>{
  const calls:string[]=[];const cache=imageSafeSearchCache({get:async()=>{calls.push('get');return[];},set:async()=>{calls.push('set');}});
  await privateImageContext.run(true,async()=>{assert.equal(await cache.get('private OCR','provider'),null);await cache.set('private OCR','provider',[],100);});
  assert.deepEqual(calls,[]);await cache.get('public identity','provider');await cache.set('public identity','provider',[],100);assert.deepEqual(calls,['get','set']);
});
test('private merchant enrichment cannot launder image hints or GPT fallback into merchant facts',async()=>{
  let source:'merchant_html'|'tavily_gpt'='tavily_gpt';
  const seen:MerchantEnrichmentInput[]=[];
  const service=new MerchantEnrichmentService({name:'fixture',extract:async(input)=>{
    seen.push(input);return {title:'Running shoe',merchant:'Nike',merchantUrl:input.merchantUrl,identitySource:source,price:'100',currency:'USD',priceSource:'ai'};
  }});
  const input={merchantUrl:'https://www.nike.com/t/shoe',titleHint:'private OCR canary',brandHint:'private brand',categoryHint:'private category',ingestId:'fixture',traceId:'fixture'};
  const rejected=await privateImageContext.run(true,()=>service.enrich(input));
  assert.equal(rejected.kind,'failed');
  source='merchant_html';
  const accepted=await privateImageContext.run(true,()=>service.enrich(input));
  assert.equal(accepted.kind,'ok');
  if(accepted.kind==='ok'){
    assert.equal(accepted.metadata.category,null);assert.equal(accepted.metadata.price,null);
    assert.doesNotMatch(JSON.stringify(accepted.metadata),/private OCR|private brand|private category/);
  }
  assert.ok(seen.slice(0,2).every(value=>value.titleHint===null&&value.brandHint===null&&value.categoryHint===null));
  source='tavily_gpt';assert.equal((await service.enrich(input)).kind,'ok');
  assert.equal(seen[2].titleHint,input.titleHint);
});
