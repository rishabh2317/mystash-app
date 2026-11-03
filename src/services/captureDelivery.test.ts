import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCaptureDelivery,CaptureDeliveryError,type ImageOutbox,type ImageTransport} from './captureDelivery';
import {createCaptureTransport,decodeCaptureBytes,privateFindImageUrl} from './captureTransport';
import {selectCapture,ImageCaptureError} from './imageCapture';
import type {PendingImage} from '../../modules/mystash-share';
const id='11111111-1111-4111-8111-111111111111',uploadId='22222222-2222-4222-8222-222222222222',importId='33333333-3333-4333-8333-333333333333',owner='44444444-4444-4444-8444-444444444444';
function setup(){
  const rows=new Map<string,PendingImage>([[id,{version:1,id,owner,origin:'gallery',mime:'image/jpeg',sha256:'a'.repeat(64),size:3,state:'pending',attempts:0,createdAt:1,notBefore:0}]]),pixels=new Map([[id,'/9j/']]);let current:string|null=owner,online=true,accepted=false,uploads=0,receipts=0,changes=0;
  const owned=(account:string)=>{if(account!==current)throw new CaptureDeliveryError(401,'account_changed');};
  const store:ImageOutbox={list:async account=>{owned(account);return [...rows.values()].filter(r=>r.owner===account).map(r=>({...r}));},bytes:async(key,account)=>{owned(account);return pixels.get(key)!;},update:async(key,account,patch)=>{owned(account);const row=rows.get(key)!;assert.equal(row.owner,account);rows.set(key,{...row,...patch});if(patch.state==='accepted')pixels.delete(key);},remove:async(key,account)=>{owned(account);rows.delete(key);pixels.delete(key);}};
  const receipt=()=>({uploadId,state:accepted?'accepted':'open',importId:accepted?importId:null,upload:{signedUrl:'fixture',path:'fixture'}});
  const api:ImageTransport={initialize:async row=>{owned(row.owner);if(!online)throw Error('offline');return receipt();},upload:async()=>{uploads++;},complete:async()=>{accepted=true;receipts++;return receipt();},exists:async()=>online};
  return{rows,pixels,store,api,delivery:()=>createCaptureDelivery(store,api,()=>{changes++;},()=>1000),switchAccount:(account:string|null)=>{current=account;},offline:()=>{online=false;},online:()=>{online=true;},counts:()=>({uploads,receipts,changes}),accept:()=>{accepted=true;}};
}
test('offline queue survives controller restart and delivers exactly once after reconnect',async()=>{
  const f=setup(),first=f.delivery();first.configure(owner);f.offline();await first.pump();assert.equal(f.rows.get(id)?.state,'pending');assert.ok(f.pixels.has(id));
  f.online();const restarted=f.delivery();restarted.configure(owner);await restarted.pump(true);assert.equal(f.rows.size,0);assert.equal(f.pixels.size,0);assert.equal(f.counts().receipts,1);
});
test('repeated foreground triggers share one upload and durable receipt',async()=>{
  const f=setup(),d=f.delivery();d.configure(owner);await Promise.all([d.pump(),d.pump(),d.pump()]);assert.equal(f.counts().uploads,1);assert.equal(f.counts().receipts,1);
});
test('restart after lost completion acknowledgement reconciles by capture ID without re-upload',async()=>{
  const f=setup();f.rows.set(id,{...f.rows.get(id)!,state:'uploading',uploadId});f.accept();const d=f.delivery();d.configure(owner);await d.pump();assert.equal(f.counts().uploads,0);assert.equal(f.rows.size,0);
});
test('a history refresh failure cannot downgrade an accepted capture or require deleted pixels',async()=>{
  const f=setup();f.api.exists=async()=>{throw Error('offline');};const d=f.delivery();d.configure(owner);await d.pump();assert.equal(f.rows.get(id)?.state,'accepted');assert.equal(f.pixels.size,0);
  f.api.exists=async()=>true;await d.pump();assert.equal(f.rows.size,0);assert.equal(f.counts().uploads,1);
});
test('an accepted capture with unavailable history does not block later pending uploads',async()=>{
  const f=setup(),acceptedId='55555555-5555-4555-8555-555555555555';
  const pending=f.rows.get(id)!;f.rows.clear();
  f.rows.set(acceptedId,{...pending,id:acceptedId,state:'accepted',importId});f.rows.set(id,pending);
  f.api.exists=async()=>{throw Error('history unavailable');};
  const d=f.delivery();d.configure(owner);await d.pump();
  assert.equal(f.counts().uploads,1);assert.equal(f.counts().receipts,1);
  assert.equal(f.rows.get(acceptedId)?.state,'accepted');assert.equal(f.rows.get(id)?.state,'accepted');
  assert.equal(f.pixels.size,0);
});
test('account switch while awaiting allocation prevents pixel reads/upload and keeps old owner records',async()=>{
  const f=setup(),d=f.delivery();let finish!:(value:Awaited<ReturnType<ImageTransport['initialize']>>)=>void;
  f.api.initialize=()=>new Promise(resolve=>{finish=resolve;});d.configure(owner);const pending=d.pump();await new Promise(resolve=>setImmediate(resolve));
  d.configure('B');f.switchAccount('B');finish({uploadId,state:'open',importId:null});await pending;assert.equal(f.counts().uploads,0);assert.equal(f.rows.get(id)?.owner,owner);assert.ok(f.pixels.has(id));
  await d.pump();assert.equal(f.counts().uploads,0);
});
test('authorization and permanent validation failures retain encrypted captures for explicit recovery',async()=>{
  for(const [status,state] of [[401,'needs_auth'],[422,'needs_review']] as const){const f=setup(),d=f.delivery();f.api.initialize=async()=>{throw new CaptureDeliveryError(status,'fixture');};d.configure(owner);await d.pump();assert.equal(f.rows.get(id)?.state,state);assert.ok(f.pixels.has(id));}
});
test('retryable admission errors respect backoff and do not spin or erase the record',async()=>{
  const f=setup(),d=f.delivery();let calls=0;f.api.initialize=async()=>{calls++;throw new CaptureDeliveryError(429,'rate_limit',120);};d.configure(owner);await d.pump();await d.pump();assert.equal(calls,1);assert.equal(f.rows.get(id)?.notBefore,121000);
});
test('signed upload is confined to private Storage, sends no account credential, and receipt replay tolerates immutable conflict',async()=>{
  const f=setup(),row=f.rows.get(id)!,requests:{url:string;init?:RequestInit}[]=[];let account=owner;
  const transport=createCaptureTransport({session:async()=>({userId:account,accessToken:'PRIVATE_ACCESS'}),base:()=> 'https://api.example.test',storage:()=> 'https://storage.example.test',fetch:async(url,init)=>{requests.push({url:String(url),init});return new Response('{}',{status:409});}});
  const r={uploadId,state:'open',importId:null,upload:{path:`${owner}/${uploadId}/input`,signedUrl:`https://storage.example.test/storage/v1/object/upload/sign/find-private-images/${owner}/${uploadId}/input?token=SECRET`}};
  await transport.upload(row,r,'/9j/');assert.equal(requests.length,1);assert.ok(!JSON.stringify(requests[0].init?.headers).includes('PRIVATE_ACCESS'));assert.equal(requests[0].init?.method,'PUT');assert.equal(requests[0].init?.redirect,'error');assert.deepEqual([...new Uint8Array(requests[0].init?.body as ArrayBuffer)],[255,216,255]);
  await assert.rejects(()=>transport.upload(row,{...r,upload:{...r.upload,signedUrl:r.upload.signedUrl.replace('storage.example.test','evil.example.test')}},'/9j/'));
  account='B';await assert.rejects(()=>transport.upload(row,r,'/9j/'));assert.equal(requests.length,1);
});
test('API responses arriving after sign-out cannot be used to acknowledge a capture',async()=>{
  let signedIn=true;const transport=createCaptureTransport({session:async()=>signedIn?{userId:owner,accessToken:'token'}:null,base:()=> 'https://api.example.test',storage:()=> 'https://storage.example.test',fetch:async()=>{signedIn=false;return Response.json({uploadId,state:'accepted',importId});}});
  await assert.rejects(()=>transport.initialize(setup().rows.get(id)!),error=>error instanceof CaptureDeliveryError&&error.status===401);
});
test('base64 decoder preserves bytes and rejects malformed or oversized inputs',()=>{
  for(const text of ['a','ab','abc','abcd','private bytes'])assert.deepEqual(Buffer.from(decodeCaptureBytes(Buffer.from(text).toString('base64'))),Buffer.from(text));
  assert.throws(()=>decodeCaptureBytes('!invalid'));assert.throws(()=>decodeCaptureBytes('A'.repeat(6990512)));
  for(const malformed of ['====','A===','AA=A','AABB='])assert.throws(()=>decodeCaptureBytes(malformed));
  const maximum=Buffer.alloc(5*1024*1024,42);assert.deepEqual(Buffer.from(decodeCaptureBytes(maximum.toString('base64'))),maximum);
});
test('private image reads never attach credentials to insecure or credential-bearing endpoints',()=>{
  for(const base of [undefined,'http://api.example.test','https://user:secret@api.example.test','https://api.example.test?token=private'])assert.equal(privateFindImageUrl(base,id,'original'),null);
  assert.equal(privateFindImageUrl('https://api.example.test',id,'thumbnail'),`https://api.example.test/finds/${id}/media/thumbnail`);
});
test('permissions support limited photo access, denial, permanent denial, cancellation and owner changes',async()=>{
  const calls:string[]=[];let granted=false,canAskAgain=true,picked=true,sameOwner=true;
  const ports={supported:async()=>true,permission:async(request:boolean)=>{calls.push(request?'request':'get');return{granted,canAskAgain,accessPrivileges:granted?'limited':'none'};},pick:async()=>{calls.push('pick');return picked?{uri:'file:///fixture',width:1,height:1}:null;},queue:async()=>{calls.push('queue');return{id};},sameOwner:()=>sameOwner};
  await assert.rejects(()=>selectCapture('camera',ports),error=>error instanceof ImageCaptureError&&error.kind==='permission');assert.deepEqual(calls,['get','request']);
  canAskAgain=false;await assert.rejects(()=>selectCapture('gallery',ports),error=>error instanceof ImageCaptureError&&error.kind==='settings');
  granted=true;assert.equal((await selectCapture('gallery',ports))?.id,id);
  picked=false;assert.equal(await selectCapture('gallery',ports),null);sameOwner=false;await assert.rejects(()=>selectCapture('gallery',ports));
  assert.equal(calls.filter(c=>c==='queue').length,1);
});
