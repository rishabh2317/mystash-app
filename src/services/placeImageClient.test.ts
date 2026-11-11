import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createPlaceImageClient } from './placeImageClient';
import { imageDataUri, PlaceImageError, placeImageSize, schedulePlaceImage } from './placeImageMemory';
import type { PlaceImageResource } from '../../backend/src/place/photos/contract';
const photo:PlaceImageResource={source:'google_places',cachePolicy:'none',uri:'https://lh3.googleusercontent.com/photo',width:1200,height:800,
  attribution:{provider:'Google Maps',sourceUrl:'https://www.google.com/maps/photo/source',reportUrl:null,authors:[{name:'Photographer',url:null,avatar:null}],providers:[]}};
const metadata=(image:unknown=photo)=>new Response(JSON.stringify({image,googlePlaceId:'google-canonical'}));
const bytes=()=>new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Type':'image/jpeg'}});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const session=async()=>({userId:'a',accessToken:'secret'});
function fixture(options:Partial<Parameters<typeof createPlaceImageClient>[0]>={}){
  let api=0,downloads=0;
  const client=createPlaceImageClient({baseURL:()=> 'https://api.example',session,wait:async()=>{},fetch:async(input)=>{
    if(String(input).startsWith('https://api.example')){api++;return metadata();}downloads++;return bytes();
  },...options});
  return {client,counts:()=>({api,downloads})};
}
async function view(client:ReturnType<typeof createPlaceImageClient>,id='canonical',width:128|256|640=256,importId?:string){
  const handle=client.acquire('a',id,width,importId);try{return await handle.promise;}finally{handle.release();}
}
it('retains actual bytes and attribution across unmount/remount, tab/source-context switches, without metadata/media/CDN requests',async()=>{
  const {client,counts}=fixture();const first=await view(client);assert.ok(first?.uri.startsWith('data:image/jpeg;base64,'));
  const second=await view(client,'canonical',256,'different-find');assert.equal(first,second);assert.deepEqual(second?.attribution,photo.attribution);
  assert.deepEqual(counts(),{api:1,downloads:1});assert.equal(client.metrics().hits,1);assert.equal(client.metrics().avoidedApiRequests,1);
  assert.equal(JSON.stringify(client.metrics()).includes('https:'),false);
});
it('same owner/place/size coalesces requests and independent sizes remain independent',async()=>{
  const {client,counts}=fixture();const a=client.acquire('a','canonical',128),b=client.acquire('a','canonical',128);
  assert.equal(await a.promise,await b.promise);a.release();b.release();await view(client,'canonical',256);
  assert.deepEqual(counts(),{api:2,downloads:2});assert.equal(client.metrics().coalesced,1);
});
it('LRU updates recency, evicts within both byte and entry budgets, and never stores oversized entries',async()=>{
  let index=0;
  const {client}=fixture({maxEntries:2,fetch:async input=>String(input).startsWith('https://api.example')?new Response(JSON.stringify({image:photo,googlePlaceId:`google-${String(input).split('/places/')[1].split('/')[0]}`})):bytes()});
  await view(client,'one');await view(client,'two');await view(client,'one');await view(client,'three');
  assert.equal(client.metrics().entries,2);assert.equal(client.metrics().evictions,1);const before=client.metrics().apiRequests;
  await view(client,'one');assert.equal(client.metrics().apiRequests,before);await view(client,'two');assert.equal(client.metrics().apiRequests,before+1);
  const small=fixture({maxBytes:1});await view(small.client);await view(small.client);assert.equal(small.client.metrics().entries,0);assert.equal(small.counts().api,2);
  const capped=fixture({maxBytes:300000,fetch:async input=>String(input).startsWith('https://api.example')?new Response(JSON.stringify({image:photo,googlePlaceId:`google-${++index}`})):bytes()});
  await view(capped.client,'one');await view(capped.client,'two');assert.ok(capped.client.metrics().estimatedBytes<=300000);assert.equal(capped.client.metrics().evictions,1);
});
it('real session checks prevent cross-account cache delivery; signout/session cleanup and memory-pressure clear discard bytes',async()=>{
  let user:string|null='a';const {client,counts}=fixture({session:async()=>user?{userId:user,accessToken:`token-${user}`}:null});
  await view(client);user='b';assert.equal(await view(client),null);client.setOwner('b');assert.equal(client.metrics().entries,0);
  const b=client.acquire('b','canonical',256);assert.ok(await b.promise);b.release();user=null;client.setOwner(null);assert.equal(client.metrics().estimatedBytes,0);
  user='a';await view(client);assert.equal(counts().api,3);client.clear();assert.equal(client.metrics().entries,0);
});
it('switching account while a response is pending cannot retain or deliver old bytes',async()=>{
  let user='a',release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
  const {client}=fixture({session:async()=>({userId:user,accessToken:'secret'}),fetch:async()=>{await wait;return metadata();}});
  const a=client.acquire('a','canonical',128);await tick();user='b';client.setOwner('b');release();assert.equal(await a.promise,null);a.release();assert.equal(client.metrics().entries,0);
});
it('concurrency stays at three and released queued cards perform no fetch',async()=>{
  const releases:(()=>void)[]=[];let api=0;
  const {client}=fixture({fetch:async input=>{if(!String(input).startsWith('https://api.example'))return bytes();api++;await new Promise<void>(r=>releases.push(r));return metadata();}});
  const handles=Array.from({length:5},(_,i)=>client.acquire('a',`place-${i}`,128));await tick();assert.equal(api,3);
  handles[3].release();handles[4].release();releases.splice(0).forEach(r=>r());await Promise.all(handles.map(h=>h.promise));handles.forEach(h=>h.release());assert.equal(api,3);assert.equal(client.metrics().queuedRequests,0);
});
it('offline failure never retries immediately; transient/rate-limit retries back off and honor cooldown',async()=>{
  const offline=fixture({fetch:async()=>{throw new TypeError('Network request failed');}});await view(offline.client);assert.equal(offline.client.metrics().apiRequests,1);assert.equal(offline.client.metrics().retries,0);
  const delays:number[]=[];let calls=0;const transient=fixture({wait:async ms=>{delays.push(ms);},fetch:async input=>{
    if(!String(input).startsWith('https://api.example'))return bytes();return ++calls<3?new Response('{}',{status:503}):metadata();
  }});assert.ok(await view(transient.client));assert.deepEqual(delays,[500,1000]);
  let now=0;const rate=fixture({now:()=>now,fetch:async()=>new Response('{}',{status:429,headers:{'Retry-After':'60'}})});
  await view(rate.client);await view(rate.client);assert.equal(rate.client.metrics().apiRequests,1);now=60001;await view(rate.client);assert.equal(rate.client.metrics().apiRequests,2);
});
it('backend typed expiry refreshes metadata, image expiry refreshes only when needed; image transient reuses current URI',async()=>{
  let api=0,images=0;const delays:number[]=[];
  const {client}=fixture({wait:async ms=>{delays.push(ms);},fetch:async input=>{
    if(String(input).startsWith('https://api.example'))return ++api===1?new Response(JSON.stringify({image:null,failure:'expired'})):metadata();
    return ++images===1?new Response('{}',{status:404}):bytes();
  }});assert.ok(await view(client));assert.equal(api,3);assert.equal(images,2);assert.deepEqual(delays,[500,1000]);
  let metadataCalls=0,cdn=0;const retry=fixture({fetch:async input=>String(input).startsWith('https://api.example')?(metadataCalls++,metadata()):++cdn===1?new Response('{}',{status:503}):bytes()});
  assert.ok(await view(retry.client));assert.equal(metadataCalls,1);assert.equal(cdn,2);
});
it('invalid, missing, oversized and unsafe resources remain placeholders without retry storms',async()=>{
  for(const value of [null,{...photo,uri:'http://localhost/private'},{...photo,attribution:null}]){
    const {client}=fixture({fetch:async()=>metadata(value)});assert.equal(await view(client),null);assert.equal(client.metrics().retries,0);
  }
  const invalid=fixture({fetch:async input=>String(input).startsWith('https://api.example')?metadata():new Response('bad',{headers:{'Content-Type':'text/html'}})});assert.equal(await view(invalid.client),null);
});
it('provider-specific reuse policy can disable retention without changing presentation or requests',async()=>{
  const {client,counts}=fixture({allowSessionReuse:()=>false});await view(client);await view(client);assert.equal(counts().api,2);assert.equal(client.metrics().entries,0);
});
it('base64 bytes preserve every byte; pixel density chooses bounded resolution; 300ms demand can be cancelled',async()=>{
  for(const n of [1,2,3,100,12289]){const bytes=Uint8Array.from({length:n},(_,i)=>i%256);assert.equal(imageDataUri(bytes,'image/png'),`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);}
  assert.equal(placeImageSize(42,3),128);assert.equal(placeImageSize(64,3),256);assert.equal(placeImageSize(170,3),640);assert.equal(placeImageSize(500,4),640);
  let loaded=0;const cancel=schedulePlaceImage(()=>loaded++);cancel();await new Promise(r=>setTimeout(r,310));assert.equal(loaded,0);
  await new Promise<void>(resolve=>schedulePlaceImage(()=>{loaded++;resolve();},1));assert.equal(loaded,1);
});

it('memory hits bypass the download queue rather than waiting behind three slow photos',async()=>{
  let slow=false;const releases:(()=>void)[]=[];
  const {client}=fixture({fetch:async input=>{
    if(!String(input).startsWith('https://api.example'))return bytes();
    if(slow)await new Promise<void>(resolve=>releases.push(resolve));return metadata();
  }});
  await view(client,'cached');slow=true;
  const busy=[1,2,3].map(i=>client.acquire('a',`busy-${i}`,128));await tick();assert.equal(releases.length,3);
  const hit=client.acquire('a','cached',256);let ready=false;void hit.promise.then(()=>{ready=true;});await tick();assert.ok(ready);hit.release();
  releases.forEach(release=>release());await Promise.all(busy.map(h=>h.promise));busy.forEach(h=>h.release());
});
it('timeouts back off independently of cancellation, and explicit offline mode sends no requests',async()=>{
  let calls=0;const delays:number[]=[];const timeout=fixture({wait:async ms=>{delays.push(ms);},fetch:async input=>{
    if(!String(input).startsWith('https://api.example'))return bytes();if(++calls===1)throw new PlaceImageError('timeout');return metadata();
  }});assert.ok(await view(timeout.client));assert.deepEqual(delays,[500]);assert.equal(timeout.client.metrics().failures.timeout,1);
  const offline=fixture({isOnline:()=>false});assert.equal(await view(offline.client),null);assert.equal(offline.counts().api,0);
});

it('twenty repeat views consume one cold API request and one byte download, with nineteen measured hits',async()=>{
  const {client,counts}=fixture();for(let i=0;i<20;i++)assert.ok(await view(client));
  assert.deepEqual(counts(),{api:1,downloads:1});assert.equal(client.metrics().hits,19);assert.equal(client.metrics().avoidedApiRequests,19);
  assert.equal(client.metrics().cancelled,0);assert.ok(client.metrics().estimatedBytes>0);
});
