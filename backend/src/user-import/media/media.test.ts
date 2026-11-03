import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Express,Request,Response } from 'express';
import { imageUploadInput,imageRequestDigest,imageDigest,type ImageAsset } from './contracts';
import { PrivateImageService,type MediaStore,type PrivateImageStorage } from './service';
import { registerPrivateImageHandlers } from './routes';
import { ShareError } from '../share/contracts';
const id='11111111-1111-4111-8111-111111111111',importId='22222222-2222-4222-8222-222222222222';
const raw=Buffer.from('private-image-fixture'),input={captureId:id,sha256:imageDigest(raw),size:raw.length,mime:'image/jpeg',origin:'camera'};
function fixture(){
  let asset={id,user_id:'owner',capture_id:id,request_digest:imageRequestDigest(imageUploadInput(input)),expected_digest:input.sha256,expected_size:raw.length,mime:input.mime,
    state:'open',staging_path:'owner/opaque/input',original_path:'owner/opaque/original.jpg',thumbnail_path:'owner/opaque/thumbnail.jpg',source_id:null,import_id:null,
    upload_expires_at:new Date(Date.now()+10800000).toISOString(),verify_lease:null,cleanup_lease:null,normalized_digest:null} as ImageAsset;
  const calls:string[]=[],objects=new Map<string,Buffer>([[asset.staging_path,raw]]);
  let corrupt=false,failDelete=false,blockMedia=false;
  const store:MediaStore={async command<T>(owner:string|null,action:string,_id?:string|null,data?:Record<string,unknown>){
    calls.push(action);if(owner!==null&&owner!=='owner')throw new ShareError('image_not_found',404);
    if(action==='initialize'||action==='status')return {...asset} as T;
    if(action==='claim'){if(asset.state==='verifying')throw new ShareError('image_busy',409);if(asset.state==='open')asset={...asset,state:'verifying',verify_lease:String(data!.lease)};return {...asset} as T;}
    if(action==='verifyLease'&&asset.verify_lease!==data!.lease)throw new ShareError('image_conflict',409);
    if(action==='accept')asset={...asset,state:'accepted',import_id:importId,source_id:id,normalized_digest:String(data!.digest)};
    if(action==='release'&&asset.state==='verifying')asset={...asset,state:'open'};
    if(action==='cancel')asset={...asset,state:'deleting'};
    if(action==='media'&&(blockMedia||asset.state!=='accepted'))throw new ShareError('image_not_found',404);
    if(action==='cleanupClaim')return [asset] as T;
    if(action==='cleanupFinish')asset={...asset,state:'deleted'};
    return {...asset} as T;
  }};
  const storage:PrivateImageStorage={async signUpload(){return{signedUrl:'https://fixture.invalid/upload?token=SECRET',token:'SECRET'};},async read(path){return corrupt?Buffer.from('corrupt'):objects.get(path)!;},async put(path,bytes){objects.set(path,bytes);},async remove(paths){if(failDelete)throw Error('private storage details');paths.forEach(path=>objects.delete(path));}};
  const service=new PrivateImageService(store,storage,async()=>({original:raw,thumbnail:raw,width:1,height:1,digest:input.sha256}));
  return{service,calls,objects,getAsset:()=>asset,corrupt:()=>{corrupt=true;},failDelete:()=>{failDelete=true;},blockMedia:()=>{blockMedia=true;}};
}
test('image input is bounded, typed and path/owner injection is rejected',()=>{
  for(const bad of [{...input,size:5242881},{...input,mime:'image/svg+xml'},{...input,sha256:'bad'},{...input,origin:'inferred-screenshot'},{...input,userId:'other'},{...input,path:'profile-photos/public.jpg'}])assert.throws(()=>imageUploadInput(bad));
  assert.equal(imageUploadInput({...input,origin:undefined}).origin,null);
});
test('completion verifies bytes before accepting and replay never uploads or creates a second Find',async()=>{
  const f=fixture();const start=await f.service.initialize('owner',input);assert.ok('upload'in start);
  assert.equal((await f.service.complete('owner',id)).delivery,'accepted');assert.equal(f.getAsset().state,'accepted');
  const writes=f.calls.filter(call=>call==='accept').length;await f.service.complete('owner',id);assert.equal(f.calls.filter(call=>call==='accept').length,writes);
  assert.equal((await f.service.media('owner',importId,'thumbnail')).equals(raw),true);
  await assert.rejects(f.service.status('other',id),/image_not_found/);await assert.rejects(f.service.media('other',importId,'original'),/image_not_found/);
});
test('corrupt uploads are never accepted, deletion is rechecked after read, and failed cleanup remains pending',async()=>{
  const f=fixture();f.corrupt();await assert.rejects(f.service.complete('owner',id),/digest_mismatch/);assert.equal(f.getAsset().state,'open');assert.ok(!f.calls.includes('accept'));
  const active=fixture();await active.service.complete('owner',id);
  let reads=0;const read=active.service.storage.read;active.service.storage.read=async path=>{const bytes=await read(path);if(++reads===1)active.blockMedia();return bytes;};
  await assert.rejects(active.service.media('owner',importId,'original'),/image_not_found/);
  const deleting=fixture();await deleting.service.cancel('owner',id);deleting.failDelete();assert.equal(await deleting.service.reconcile(),0);assert.equal(deleting.getAsset().state,'deleting');assert.ok(!deleting.calls.includes('cleanupFinish'));
});
test('API reuses authentication, gates admission, preserves private headers and serves bytes without URLs',async()=>{
  const f=fixture(),routes=new Map<string,(req:Request,res:Response)=>Promise<void>>();let enabled=true,allow=true;
  const app=Object.fromEntries(['get','post','delete'].map(method=>[method,(path:string,fn:never)=>routes.set(method+' '+path,fn)])) as unknown as Express;
  registerPrivateImageHandlers(app,{authenticate:async req=>req.headers.authorization?{userId:String(req.headers.authorization)}:null,service:f.service,enabled:()=>enabled,admit:async()=>allow});
  async function request(key:string,owner:string|null='owner',body:unknown=undefined,params:Record<string,string>={}){
    let status=200,result:unknown;const headers:Record<string,string>={};const res={headersSent:false,setHeader(k:string,v:string){headers[k]=v;},status(n:number){status=n;return this;},json(data:unknown){result=data;this.headersSent=true;},send(data:unknown){result=data;this.headersSent=true;}};
    await routes.get(key)!({headers:{authorization:owner??undefined},body,params} as Request,res as unknown as Response);return{status,result,headers};
  }
  assert.equal((await request('post /finds/media/uploads',null,input)).status,401);
  enabled=false;assert.equal((await request('post /finds/media/uploads','owner',input)).status,503);enabled=true;
  allow=false;const limited=await request('post /finds/media/uploads','owner',input);assert.equal(limited.status,429);assert.equal(limited.headers['Retry-After'],'60');allow=true;
  assert.equal((await request('post /finds/media/uploads','owner',{...input,owner:'other'})).status,400);
  await request('post /finds/media/uploads/:uploadId/complete','owner',{}, {uploadId:id});
  enabled=false; // Pausing ingestion must not remove authenticated access to accepted media.
  const media=await request('get /finds/:findId/media/:variant','owner',undefined,{findId:importId,variant:'thumbnail'});
  assert.equal(media.status,200);assert.ok(Buffer.isBuffer(media.result));assert.equal(media.headers['Cache-Control'],'private, no-store');assert.equal(media.headers['Content-Type'],'image/jpeg');
  assert.equal((await request('get /finds/:findId/media/:variant','other',undefined,{findId:importId,variant:'original'})).status,404);
  const state=await request('get /finds/media/uploads/:uploadId','owner',undefined,{uploadId:id});assert.doesNotMatch(JSON.stringify(state.result),/SECRET|original.jpg|private-image-fixture/);
});
