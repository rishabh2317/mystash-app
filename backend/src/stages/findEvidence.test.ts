import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MultimodalContext, ProductCandidate } from '../domain/types';
import recording from './testing/denimRecordings.json';
import { prepareFindHypotheses, retainFindHypotheses, groundPlaceLocality } from './findEvidence';
import { parseVisualObjects, FIND_VISUAL_FACTS_SYSTEM } from '../providers/vision/OpenAiVisionProvider';
import { runProgressiveExtract } from './progressiveExtract';
import { parsePlaceMentions } from '../place/parseReasonerPayload';
import { hypothesisMayResolve } from '../content-source/processing/userAttachPolicy';
import type { ContentSourceProductRecord } from '../content-source/domain/types';

const product = (model: string | null = null): ProductCandidate => ({name:'Blue denim jacket',brand:null,model,category:'fashion',confidence:0.9,sources:['VISION'],
  evidence:{summary:'Visible upper-body denim garment',frames:[{frameIndex:4,timestampMs:35495}],frameCount:1,logoHits:[],transcriptMentions:false,ocrMentions:false}});
const context: MultimodalContext = {platform:'youtube',externalVideoId:'recorded',sourceUrl:'https://www.youtube.com/watch?v=whiDdYRALIU',metadata:{title:'How Levi’s Most Genius Design Works.'},
  transcript:{available:false,text:'',length:0},frames:[],pipelineVersion:'fixture',providerVersion:'fixture',
  media:{objects:[{label:'denim jacket',confidence:0.95,frameIndex:4,timestampMs:35495,attributes:{colour:'blue',material:'denim',uncertainty:['Exact style unknown']}}],
    scene:{label:'Unknown',confidence:0},activities:[],ocr:[],logos:[],frames:[],providerMeta:{}}};

it('human-observation fixture corrects unsupported jeans to the linked jacket without inventing Levi identity',()=>{
  const historical = recording.runs.find(r=>r.id==='whiDdYRALIU')!.products[0];
  const before = JSON.stringify(historical);
  const [after] = prepareFindHypotheses([{...product(),...historical} as ProductCandidate],context,'s2');
  assert.equal(after.name,'denim jacket'); assert.equal(after.brand,null); assert.equal(after.model,null);
  assert.equal(typeof after.evidence==='object' && after.evidence.identification?.kind,'possible');
  assert.equal(hypothesisMayResolve(after as unknown as ContentSourceProductRecord),false);
  assert.equal(JSON.stringify(historical),before);
});
it('retains attributes and stage provenance without combining different exact variants',()=>{
  const [first] = prepareFindHypotheses([product()],context,'s2');
  const [later] = prepareFindHypotheses([product()],context,'s3');
  const retained = retainFindHypotheses([first], [later]);
  assert.equal(retained.length,1);
  assert.deepEqual(typeof retained[0].evidence==='object' && retained[0].evidence.stages,['s2','s3']);
  assert.equal(typeof retained[0].evidence==='object' && retained[0].evidence.attributes?.filter(a=>a.attribute==='material').length,1);
  assert.equal(retainFindHypotheses([{...product('484402')}],[{...product('484403')}]).length,2);
  assert.equal(retainFindHypotheses([first],[]).length,1);
});
it('place locality comes only from its explicit same-line source span',()=>{
  const places=parsePlaceMentions({places:[{name:'Agonda Villas',sources:['METADATA']},{name:'Spinora Treehouse',sources:['METADATA']},{name:'Other Hotel',sources:['METADATA']}]});
  const grounded=groundPlaceLocality(places,'Agonda Villas, Goa\nSpinora Treehouse - Wayanad');
  assert.deepEqual(grounded.map(p=>p.locality),['Goa','Wayanad',null]);
  assert.equal(groundPlaceLocality(places,'Other Hotel near an amazing beach')[2].locality,null);
});
it('structured vision rejects invented frame provenance and preserves uncertainty',()=>{
  const objects=parseVisualObjects(JSON.stringify({objects:[context.media!.objects[0],{...context.media!.objects[0],frameIndex:88}]}),[{index:4,timestampMs:35495,storagePath:'fixture'}]);
  assert.equal(objects.length,1); assert.deepEqual(objects[0].attributes?.uncertainty,['Exact style unknown']);
  assert.match(FIND_VISUAL_FACTS_SYSTEM,/not jeans/); assert.match(FIND_VISUAL_FACTS_SYSTEM,/never guess a brand/i);
});
for(const run of recording.runs) it(`bounded no-write progressive replay ${run.id}`,async()=>{
  const first=run.id==='whiDdYRALIU'; let reasonerCalls=0, mediaCalls=0;
  const result=await runProgressiveExtract({admin:{} as SupabaseClient,platform:'youtube',externalVideoId:run.id,sourceUrl:`https://www.youtube.com/watch?v=${run.id}`,correlationId:'fixture',traceId:'fixture',cacheScope:'user-import'}, {
    context:async()=>({...run.metadata,transcript:''}),readCache:async()=>null,writeCache:async()=> 'fixture',
    reasoner:{name:'recorded-final-hypotheses',async reason(){reasonerCalls++;return {products:first&&reasonerCalls===1?[]:run.products as ProductCandidate[],places:[],meta:{provider:'recorded',durationMs:0}};}},
    workDir:async()=>'/no-files',video:{name:'fixture',download:async()=>({localPath:'/no-files/video',durationMs:42594}),cleanup:async()=>{}},
    adaptiveFrames:async()=>({durationMs:42594,frames:[{index:4,timestampMs:35495,storagePath:'fixture'}]}),upload:async(_,v)=>({...v,objectPaths:[],sha256s:[]}),
    media:{name:'human-observation-fixture-not-historical-model-output',async analyze(){mediaCalls++;return context.media!;}},
  });
  assert.equal(result.kind,'ok');if(result.kind!=='ok')return;
  assert.equal(reasonerCalls,first?2:1);assert.equal(mediaCalls,first?1:0);
  assert.equal(result.products.length,first?1:2);
  if(first){assert.equal(result.products[0].name,'denim jacket');assert.equal(hypothesisMayResolve(result.products[0] as unknown as ContentSourceProductRecord),false);}
  else assert.deepEqual(result.products.map(p=>p.model),['484402','A57820104']);
});

it('captured fresh responses retain a jacket and remove field labels without dropping SKU digits',async()=>{
  const fresh=(await import('./testing/denimFreshResponses.json')).default;
  const jacket=fresh.results.find(r=>r.id==='whiDdYRALIU')!.products[0];
  assert.match(jacket.name,/jacket/i);assert.doesNotMatch(jacket.name,/jeans/i);
  const explicit=fresh.results.find(r=>r.id==='ypyRj59jp9o')!.products;
  const result=prepareFindHypotheses(explicit as unknown as ProductCandidate[],{...context,media:null,metadata:{title:'Jackets',description:'UNIQLO Denim Trucker Jacket ID 484402. Levi’s Relaxed Fit Trucker Jacket ID A57820104.'}},'s1');
  assert.deepEqual(result.map(p=>p.model),['484402','A57820104']);
  assert.ok(result.every(p=>typeof p.evidence==='object'&&!p.evidence.identification));
});

it('final live visual schema supplies blue denim evidence without treating unknown as an observed value',async()=>{
  const fresh=(await import('./testing/denimFreshResponses.json')).default;
  const objects=parseVisualObjects(JSON.stringify({objects:fresh.finalVisionCall.objects}),[7099,14198,21297,28396,35495].map((timestampMs,index)=>({index,timestampMs,storagePath:'fixture'})));
  const jacket=objects.find(o=>o.label==='denim jacket');
  assert.equal(jacket?.attributes?.colour,'blue');assert.equal(jacket?.attributes?.material,'denim');
  assert.equal(jacket?.attributes?.fit,undefined);assert.equal(jacket?.attributes?.brandText,undefined);
});

it('malformed optional model fields cannot crash Find and source claims require literal support',()=>{
  const raw={...product(),model:42,evidence:{summary:'Source claim',frames:[],logoHits:0,attributes:[{attribute:'colour',value:'blue',origin:'source_text'},{attribute:'material',value:'silk',origin:'source_text'}]}} as unknown as ProductCandidate;
  const [safe]=prepareFindHypotheses([raw],{...context,metadata:{title:'A blue jacket'},media:null},'s1');
  assert.equal(safe.model,null);
  assert.deepEqual(typeof safe.evidence==='object'&&safe.evidence.attributes,[{attribute:'colour',value:'blue',origin:'source_text'}]);
});

it('a brand-only title cannot establish a garment type without frames',()=>{
  assert.deepEqual(prepareFindHypotheses([{...product(),name:"Levi's Jeans",sources:['METADATA']}],{...context,media:null},'s1'),[]);
});

it('a generic text hypothesis does not suppress the existing frame stage and stays opt-in afterward',async()=>{
  let calls=0,media=0;
  const generic={...product(),sources:['METADATA'] as ProductCandidate['sources']};
  const result=await runProgressiveExtract({admin:{} as SupabaseClient,platform:'youtube',externalVideoId:'generic-jacket',sourceUrl:'https://example.invalid/video',correlationId:'fixture',traceId:'fixture',cacheScope:'user-import'}, {
    context:async()=>({title:'Blue denim jacket',description:'',creator:'',descriptionSource:'fixture',thumbnailUrl:null,transcript:''}),readCache:async()=>null,writeCache:async()=> 'fixture',
    reasoner:{name:'fixture',async reason(){calls++;return {products:[generic],places:[],meta:{provider:'fixture',durationMs:0}};}},
    workDir:async()=>'/no-files',video:{name:'fixture',download:async()=>({localPath:'/no-files/video',durationMs:42594}),cleanup:async()=>{}},
    adaptiveFrames:async()=>({durationMs:42594,frames:[{index:4,timestampMs:35495,storagePath:'fixture'}]}),upload:async(_,v)=>({...v,objectPaths:[],sha256s:[]}),
    media:{name:'fixture',async analyze(){media++;return context.media!;}},
  });
  assert.equal(calls,2);assert.equal(media,1);assert.equal(result.kind,'ok');
  if(result.kind==='ok'){assert.equal(result.products.length,1);assert.equal(hypothesisMayResolve(result.products[0] as unknown as ContentSourceProductRecord),false);}
});

it('ambiguous jacket/shirt observations do not establish unseen jeans',()=>{
  const ambiguous={...context,media:{...context.media!,objects:[...context.media!.objects,{...context.media!.objects[0],label:'denim shirt'}]}};
  const [result]=prepareFindHypotheses([{...product(),name:'Jeans'}],ambiguous,'s2');
  assert.equal(result.name,'Clothing (type unconfirmed)');assert.equal(result.model,null);
  assert.equal(typeof result.evidence==='object'&&result.evidence.identification?.kind,'possible');
});
