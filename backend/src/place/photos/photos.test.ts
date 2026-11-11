import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Request,Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GooglePlacePhotoProvider, PlacePhotoError, PLACE_PHOTO_FIELDS, selectPlacePhoto } from './GooglePlacePhotoProvider';
import { PlacePhotoService,supabaseOwnedPhotoPlace } from './PlacePhotoService';
import { createPlacePhotoHandler } from './routes';
import { InMemoryPlaceRepository } from '../InMemoryPlaceRepository';

const canonical='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const photo=(id='place-a',reference='photo1',widthPx=1600,heightPx=1200)=>({name:`places/${id}/photos/${reference}`,widthPx,heightPx,
  googleMapsUri:'https://www.google.com/maps/photo/example',flagContentUri:'https://www.google.com/maps/report/example',
  authorAttributions:[{displayName:'Fixture photographer',uri:'https://www.google.com/maps/contrib/fixture',photoUri:'https://lh3.googleusercontent.com/avatar'}]});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

it('uses free IDs-only metadata, selects a suitable image and exposes attribution without key/reference leakage',async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const provider=new GooglePlacePhotoProvider({apiKey:'DO_NOT_EXPOSE',fetchImpl:async(input,init)=>{
    const url=String(input);calls.push({url,init});
    return url.includes('/media?')?response({photoUri:'https://lh3.googleusercontent.com/visible-photo',name:'must-not-leak'}):response({id:'place-a',photos:[photo('place-a','panorama',4000,200),photo('place-a','good',1600,1200)]});
  }});
  const result=await provider.photo('place-a',640);
  assert.equal(calls.length,2);assert.equal(new Headers(calls[0].init?.headers).get('X-Goog-FieldMask'),PLACE_PHOTO_FIELDS);
  assert.equal(PLACE_PHOTO_FIELDS,'id,photos,attributions');assert.ok(calls[1].url.includes('/good/media?maxWidthPx=640&maxHeightPx=640&skipHttpRedirect=true'));
  assert.ok(calls.every(c=>c.init?.cache==='no-store'&&c.init?.redirect==='error'&&!c.url.includes('DO_NOT_EXPOSE')));
  assert.equal(result?.attribution.authors[0].name,'Fixture photographer');assert.equal(result?.cachePolicy,'none');
  assert.equal(result?.attribution.sourceUrl,photo().googleMapsUri);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPOSE')&&!JSON.stringify(result).includes('places/place-a/photos/'));
});
it('never selects photos of another place, unusable slivers or photos without a source link',()=>{
  for(const bad of [photo('other'),photo('place-a','tiny',20,20),photo('place-a','panorama',5000,300),{...photo(),googleMapsUri:'javascript:bad'}])assert.equal(selectPlacePhoto([bad],'place-a',640),null);
});
it('coalesces concurrent users by provider ID only while pending; subsequent views fetch fresh names',async()=>{
  let details=0,media=0;let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});
  const provider=new GooglePlacePhotoProvider({apiKey:'fixture',fetchImpl:async input=>{
    if(String(input).includes('/media?')){media++;return response({photoUri:'https://lh3.googleusercontent.com/photo'});}
    details++;await barrier;return response({id:'place-a',photos:[photo()]});
  }});
  const a=provider.photo('place-a',640),b=provider.photo('place-a',640);release();
  assert.deepEqual(await a,await b);assert.equal(details,1);assert.equal(media,1);
  await provider.photo('place-a',640);assert.equal(details,2);assert.equal(media,2);
});
it('empty photos remain null; provider errors carry safe typed failures without retry loops',async()=>{
  for(const mode of ['empty','expired','rate-limit','failure','wrong-id','unsafe-image']){
    let count=0;const provider=new GooglePlacePhotoProvider({apiKey:'fixture',fetchImpl:async input=>{
      count++;if(mode==='failure')throw Error('secret-error');if(mode==='rate-limit')return response({},429);
      if(String(input).includes('/media?'))return mode==='expired'?response({},404):response({photoUri:'http://127.0.0.1/private'});
      return response({id:mode==='wrong-id'?'other':'place-a',photos:mode==='empty'?[]:[photo()]});
    }});
    const kind=mode==='expired'?'expired':mode==='rate-limit'?'rate_limit':mode==='failure'?'transient':null;
    if(kind)await assert.rejects(provider.photo('place-a',256),error=>error instanceof PlacePhotoError&&error.kind===kind&&!error.message.includes('secret'));
    else assert.equal(await provider.photo('place-a',256),null,mode);
    assert.ok(count<=2,mode);
  }
});
it('two owners reuse one canonical row and keep memberships separate; strangers and unresolved/non-Google identities incur no photo requests',async()=>{
  const repo=new InMemoryPlaceRepository();const place=await repo.insertPlace({provider:'google',providerPlaceId:'place-a',name:'Fixture venue'});
  for(const user of ['owner-a','owner-b']){
    const hypothesis=await repo.insertHypothesis({contentSourceId:`source-${user}`,extractedName:'Fixture venue',unresolvedReason:'pending_resolution'});
    await repo.markHypothesisResolved(hypothesis.id,place.id);
    await repo.insertLead({userId:user,contentSourcePlaceId:hypothesis.id,contentSourceId:hypothesis.contentSourceId,userImportId:`import-${user}`});
  }
  let calls=0;const service=new PlacePhotoService(async(user,id)=>(await repo.findSaveByUserAndPlace(user,id))?repo.findPlaceById(id):null,{photo:async()=>{calls++;return null;}});
  await service.read('owner-a',place.id,640);await service.read('owner-b',place.id,640);
  assert.equal(repo.places.size,1);assert.equal(repo.saves.size,2,'photo reads never create saves');
  assert.equal((await repo.listSavesByUser('owner-a'))[0].placeId,(await repo.listSavesByUser('owner-b'))[0].placeId);
  assert.equal(await service.read('stranger',place.id,640),null);assert.equal(await service.read('owner-a','unresolved',640),null);assert.equal(calls,2);
  const partner=new PlacePhotoService(async()=>({...place,provider:'future-partner'}),{photo:async()=>{throw Error('wrong provider');}});
  assert.deepEqual(await partner.read('owner-a',place.id,640),{image:null});
});
it('concurrency and per-owner rate budgets cap photo work without blocking cards',async()=>{
  let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});let network=0;
  const provider=new GooglePlacePhotoProvider({apiKey:'fixture',maxConcurrent:1,fetchImpl:async()=>{network++;await wait;return response({id:'place-a',photos:[]});}});
  const pending=provider.photo('place-a',640);await assert.rejects(provider.photo('place-b',640),error=>error instanceof PlacePhotoError&&error.kind==='rate_limit');release();await pending;assert.equal(network,1);
  let calls=0,now=0;const service=new PlacePhotoService(async()=>({provider:'google',providerPlaceId:'place-a'} as never),{photo:async()=>{calls++;return null;}},()=>now);
  for(let i=0;i<61;i++)await service.read('owner',canonical,640);
  assert.equal(calls,60);now=60001;await service.read('owner',canonical,640);assert.equal(calls,61);
});
it('distinct places from one video never share a photo reference or source poster',async()=>{
  const requested:string[]=[];const provider=new GooglePlacePhotoProvider({apiKey:'fixture',fetchImpl:async input=>{
    const url=String(input);requested.push(url);const id=url.split('/places/')[1].split('/')[0].split('?')[0];
    return url.includes('/media?')?response({photoUri:`https://lh3.googleusercontent.com/${id}`}):response({id,photos:[photo(id)]});
  }});
  const result=await Promise.all(['place-a','place-b','place-c'].map(id=>provider.photo(id,256)));
  assert.equal(new Set(result.map(p=>p?.uri)).size,3);assert.equal(requested.length,6);
});
it('authorization SQL scopes both Stash membership and Find source access before reading canonical identity',async()=>{
  const calls:{table:string;filters:unknown[]}[]=[];
  const db={from(table:string){const record={table,filters:[] as unknown[]};calls.push(record);
    const q={select(){return q;},eq(...args:unknown[]){record.filters.push(['eq',...args]);return q;},is(...args:unknown[]){record.filters.push(['is',...args]);return q;},limit(){return q;},async maybeSingle(){return {data:table==='user_place_saves'?null:table==='user_imports'?{content_source_id:'source'}:table==='content_source_places'?{id:'hypothesis'}:{id:canonical,provider:'google',provider_place_id:'place-a',name:'Venue'},error:null};}};return q;}} as unknown as SupabaseClient;
  const load=supabaseOwnedPhotoPlace(db);
  assert.equal((await load('owner',canonical,other))?.providerPlaceId,'place-a');
  assert.ok(calls.find(c=>c.table==='user_place_saves')!.filters.some(f=>JSON.stringify(f)==='["eq","user_id","owner"]'));
  assert.ok(calls.find(c=>c.table==='user_imports')!.filters.some(f=>JSON.stringify(f)==='["eq","user_id","owner"]'));
  assert.ok(calls.find(c=>c.table==='user_imports')!.filters.some(f=>JSON.stringify(f)==='["is","hidden_at",null]'));
  assert.ok(calls.find(c=>c.table==='content_source_places')!.filters.some(f=>JSON.stringify(f)===`["eq","place_id","${canonical}"]`));
});
it('photo route preserves authentication, private no-store responses and safe errors',async()=>{
  for(const scenario of ['signed-out','invalid','not-owned','success','failure']){
    const headers:Record<string,string>={};let status=200,body:unknown;
    const res={setHeader(k:string,v:string){headers[k]=v;},status(n:number){status=n;return this;},json(v:unknown){body=v;return this;}} as unknown as Response;
    const handler=createPlacePhotoHandler({authenticate:async()=>scenario==='signed-out'?null:{userId:'owner'},service:{read:async()=>{if(scenario==='failure')throw Error('PRIVATE_KEY');return scenario==='not-owned'?null:{image:null};}}});
    await handler({params:{placeId:scenario==='invalid'?'bad':canonical},query:{}} as unknown as Request,res);
    assert.equal(status,scenario==='signed-out'?401:scenario==='invalid'||scenario==='not-owned'?404:scenario==='failure'?503:200);
    assert.match(headers['Cache-Control'],/no-store/);assert.equal(headers.Vary,'Authorization');assert.ok(!JSON.stringify(body).includes('PRIVATE_KEY'));
  }
});

it('an expired resource falls back once, and a later view obtains new metadata rather than reusing the expired name',async()=>{
  let round=0;const requests:string[]=[];
  const provider=new GooglePlacePhotoProvider({apiKey:'fixture',fetchImpl:async input=>{
    const url=String(input);requests.push(url);
    if(!url.includes('/media?'))return response({id:'place-a',photos:[photo('place-a',`photo${++round}`)]});
    return url.includes('/photo1/')?response({},400):response({photoUri:'https://lh3.googleusercontent.com/fresh'});
  }});
  await assert.rejects(provider.photo('place-a',128),error=>error instanceof PlacePhotoError&&error.kind==='expired');
  assert.equal((await provider.photo('place-a',128))?.uri,'https://lh3.googleusercontent.com/fresh');
  assert.equal(requests.length,4);assert.ok(requests[3].includes('/photo2/media?'));
});

it('missing configuration performs no Google requests',async()=>{
  const provider=new GooglePlacePhotoProvider({fetchImpl:async()=>{throw Error('No request expected');}});
  assert.equal(await provider.photo('place-a',640),null);
});

it('safe failure classification reaches the client; successful-photo billing counters exclude failures',async()=>{
  const provider=new GooglePlacePhotoProvider({apiKey:'fixture',fetchImpl:async input=>String(input).includes('/media?')
    ?new Response('{}',{status:429,headers:{'Retry-After':'30'}}):response({id:'place-a',photos:[photo()]})});
  const service=new PlacePhotoService(async()=>({provider:'google',providerPlaceId:'place-a'} as never),provider);
  assert.deepEqual(await service.read('owner',canonical,256),{image:null,failure:'rate_limit',retryAfterMs:30000});
  assert.deepEqual(provider.metrics(),{metadataRequests:1,photoRequests:1,successfulPhotoRequests:0,failures:1,coalesced:0,activeRequests:0});
  const success=new GooglePlacePhotoProvider({apiKey:'fixture',fetchImpl:async input=>String(input).includes('/media?')?response({photoUri:'https://lh3.googleusercontent.com/photo'}):response({id:'place-a',photos:[photo()]})});
  const accepted=new PlacePhotoService(async()=>({provider:'google',providerPlaceId:'place-a'} as never),success);
  assert.equal((await accepted.read('owner',canonical,128))?.googlePlaceId,'place-a');assert.equal(success.metrics().successfulPhotoRequests,1);
});
