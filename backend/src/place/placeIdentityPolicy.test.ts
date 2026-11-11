import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyPlace,isGeographyOnly} from './placeClassification';
import {dedupePlaceMentions,normalizedPlaceAddress,samePlaceMention} from './placeMentionDedupe';
import {parsePlaceMentions,type ExtractedPlaceMention} from './parseReasonerPayload';
import {InMemoryPlaceRepository} from './InMemoryPlaceRepository';
import {PlaceResolver} from './PlaceResolver';
import {PlaceService} from './PlaceService';
import {matchPlaceIdentity} from './placeIdentityMatch';
import {mapGooglePlacesTextSearchBody} from './GooglePlacesTextSearchProvider';

const mention=(name:string,extra:Partial<ExtractedPlaceMention>={}):ExtractedPlaceMention=>({name,category:null,city:null,country:null,locality:null,region:null,mentionedAddress:null,confidence:.9,evidence:{},sources:['TRANSCRIPT'],...extra});
test('administrative geography is rejected globally by structured evidence, not a city blacklist',()=>{
  for(const [name,category] of [['Bangalore','city'],['Bengaluru','city'],['Karnataka','state'],['India','country'],['Québec','province'],['Quito','city'],['東京都','administrative_area_level_1']]) {
    assert.equal(classifyPlace({name,category}),'geography');
    assert.equal(parsePlaceMentions({places:[{name,category}]}).length,0);
  }
  assert.equal(isGeographyOnly({name:'India'}),true);
  assert.equal(isGeographyOnly({name:'Oslo',city:'Oslo'}),true);
  assert.equal(classifyPlace({name:'Unclassified proper name'}),'unknown');
});
test('landmarks and named natural destinations keep their geography context',()=>{
  for(const name of ['Bangalore Palace','India Gate','Cubbon Park','Nandi Hills','Marina Beach','Seminyak Beach','Lake Victoria']) {
    const rows=parsePlaceMentions({places:[{name,city:'Bangalore',region:'Karnataka',country:'India'}]});
    assert.equal(rows.length,1,name);assert.equal(rows[0].city,'Bangalore');assert.equal(rows[0].country,'India');
  }
});
test('formatted addresses deduplicate a branch, while different branches and similar venues remain separate',()=>{
  assert.equal(normalizedPlaceAddress('12, M.G. Rd.'),normalizedPlaceAddress('MG Road 12'));
  const a=mention('Social',{mentionedAddress:'12, MG Rd.',city:'Bengaluru'});
  const b=mention('Social',{mentionedAddress:'MG Road, 12',city:'Bengaluru',sources:['OCR']});
  const c=mention('Social',{mentionedAddress:'13, MG Road',city:'Bengaluru'});
  const d=mention('Social House',{mentionedAddress:'12 MG Road',city:'Bengaluru'});
  const rows=dedupePlaceMentions([a,b,c,d]);assert.equal(rows.length,3);assert.deepEqual(rows[0].sources,['TRANSCRIPT','OCR']);
  assert.notEqual(normalizedPlaceAddress('12 Main Street 34'),normalizedPlaceAddress('34 Main Street 12'));
  assert.equal(samePlaceMention({...a,evidence:{branch:'Unit 1'}},{...a,evidence:{branch:'Unit 2'}}),false);
  assert.equal(samePlaceMention(a,mention('Social',{city:'Bengaluru'})),false,'a sparse row cannot identify a branch');
  assert.equal(samePlaceMention(mention('Social',{city:'Delhi'}),mention('Social',{city:'Bengaluru'})),false);
});
test('source-grounded aliases require branch agreement and can preserve Bangalore/Bengaluru context',()=>{
  const a=mention('Palace Cafe',{city:'Bangalore',mentionedAddress:'12 Palace Rd',evidence:{aliases:['Palace Café'],locationAliases:{city:['Bengaluru']}}});
  const b=mention('Palace Café',{city:'Bengaluru',mentionedAddress:'12 Palace Road'});
  assert.equal(dedupePlaceMentions([a,b]).length,1);
  assert.equal(dedupePlaceMentions([a,{...b,mentionedAddress:'99 Palace Road'}]).length,2);
  assert.equal(matchPlaceIdentity(a,[{providerPlaceId:'venue-1',name:'Palace Café',city:'Bengaluru',country:'India',types:['cafe'],formattedAddress:'12 Palace Road, Bengaluru, India'}]).outcome,'resolved');
});
test('provider administrative types cannot become canonical cards; natural features remain eligible',async()=>{
  let calls=0;const repo=new InMemoryPlaceRepository();
  const resolver=new PlaceResolver(repo,{name:'google',async search(){calls++;return {ok:true,candidates:mapGooglePlacesTextSearchBody({places:[{id:'city',displayName:{text:'Bangalore'},types:['locality','political']}]})};}});
  const result=await resolver.resolveMentions({contentSourceId:'source',imports:[{id:'import',userId:'owner'}],mentions:[mention('Bangalore')]});
  assert.equal(calls,1);assert.equal(result.discarded,1);assert.equal((await repo.listHypotheses('source')).length,0);
  assert.equal(matchPlaceIdentity({name:'Nandi Hills'},[{providerPlaceId:'hill',name:'Nandi Hills',types:['natural_feature','political']}]).outcome,'resolved');
});
test('deterministic geography rejection incurs no provider call and persistence enforces the same rule',async()=>{
  const repo=new InMemoryPlaceRepository();let calls=0;
  await new PlaceResolver(repo,{name:'google',async search(){calls++;return {ok:false,reason:'provider_failed'};}}).resolveMentions({contentSourceId:'source',imports:[],mentions:[mention('Karnataka',{category:'state'}),mention('India')]});
  assert.equal(calls,0);
  await assert.rejects(repo.upsertHypothesis({contentSourceId:'source',extractedName:'Bangalore',category:'city',unresolvedReason:'pending_resolution'}),/Administrative geography/);
  await assert.rejects(repo.insertPlace({provider:'google',providerPlaceId:'country',name:'India'}),/Administrative geography/);
});
test('address refinements do not multiply provider calls or persisted leads',async()=>{
  const repo=new InMemoryPlaceRepository();let calls=0;
  const resolver=new PlaceResolver(repo,{name:'google',async search(){calls++;return {ok:false,reason:'provider_failed'};}});
  await resolver.resolveMentions({contentSourceId:'source',imports:[{id:'import',userId:'owner'}],mentions:[mention('Venue One',{city:'London',mentionedAddress:'5 King St'}),mention('Venue One',{city:'London',mentionedAddress:'King Street, 5'})]});
  assert.equal(calls,1);assert.equal((await repo.listHypotheses('source')).length,1);assert.equal((await repo.listSavesByUser('owner')).length,1);
});
test('existing geographic cards are filtered reversibly without deleting saves',async()=>{
  const repo=new InMemoryPlaceRepository();const row=await repo.upsertHypothesis({contentSourceId:'source',extractedName:'Venue One',city:'Bangalore',unresolvedReason:'pending_resolution'});
  await repo.insertLead({userId:'owner',userImportId:'import',contentSourceId:'source',contentSourcePlaceId:row.id});
  const load=repo.loadStash.bind(repo);repo.loadStash=async user=>{const snapshot=await load(user);snapshot.hypotheses[0]={...snapshot.hypotheses[0],extractedName:'Bangalore',category:'city'};return snapshot;};
  assert.equal((await new PlaceService(repo).listForUser('owner')).items.length,0);
  assert.equal((await repo.listSavesByUser('owner')).length,1);
});

test('a same-name provider hit cannot resolve onto another street or branch number',()=>{
  const venue={name:'Social',city:'Bangalore',mentionedAddress:'12 King Road'};
  assert.equal(matchPlaceIdentity(venue,[{providerPlaceId:'wrong-number',name:'Social',city:'Bangalore',formattedAddress:'13 King Road, Bangalore',types:['restaurant']}]).outcome,'unresolved');
  assert.equal(matchPlaceIdentity(venue,[{providerPlaceId:'wrong-street',name:'Social',city:'Bangalore',formattedAddress:'12 Queen Road, Bangalore',types:['restaurant']}]).outcome,'unresolved');
  assert.equal(matchPlaceIdentity(venue,[{providerPlaceId:'correct',name:'Social',city:'Bangalore',formattedAddress:'12, King Rd., Bangalore',types:['restaurant']}]).outcome,'resolved');
});
