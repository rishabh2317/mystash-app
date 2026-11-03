import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createPrivateImageService} from './factory';
import {PRIVATE_FIND_BUCKET} from './contracts';
test('Storage adapter confines signing to the private bucket and immutable writes accept identical replay only',async()=>{
  let bytes=Buffer.from('fixture'),failWrite=false,failRemove=false;
  const db={storage:{from(bucket:string){assert.equal(bucket,PRIVATE_FIND_BUCKET);return{
    createSignedUploadUrl:async(path:string,options:{upsert:boolean})=>{assert.equal(path,'allocated/path');assert.equal(options.upsert,false);return{data:{signedUrl:'https://fixture.invalid/private-upload',token:'secret'},error:null};},
    download:async()=>({data:new Blob([new Uint8Array(bytes)]),error:null}),
    upload:async(_path:string,_bytes:Buffer,options:{upsert:boolean;contentType:string})=>{assert.equal(options.upsert,false);assert.equal(options.contentType,'image/jpeg');return{error:failWrite?{statusCode:'409'}:null};},
    remove:async()=>({error:failRemove?{message:'private provider diagnostic'}:null}),
  };}}} as unknown as SupabaseClient;
  const service=createPrivateImageService(db);await service.storage.signUpload('allocated/path');
  await service.storage.put('allocated/output',bytes);failWrite=true;await service.storage.put('allocated/output',bytes);
  await assert.rejects(service.storage.put('allocated/output',Buffer.from('changed')),/image_object_conflict/);
  bytes=Buffer.alloc(5242881);await assert.rejects(service.storage.read('allocated/output'),/image_too_large/);
  failRemove=true;await assert.rejects(service.storage.remove(['allocated/output']),/image_deletion_deferred/);
});
test('RPC adapter binds the verified owner and safely classifies storage/ownership/conflict failures',async()=>{
  for(const [code,status]of [['P0002',404],['23514',409],['23505',409],['54000',429],['XX000',503]] as const){
    const db={storage:{from:()=>({})},rpc:(name:string,args:Record<string,unknown>)=>{assert.equal(name,'find_media_command');assert.equal(args.p_user,'owner');assert.equal(args.p_action,'status');return{abortSignal:async(signal:AbortSignal)=>{assert.equal(signal.aborted,false);return{data:null,error:{code,message:'PRIVATE CANARY'}};}};}} as unknown as SupabaseClient;
    await assert.rejects(createPrivateImageService(db).store.command('owner','status','opaque'),error=>{
      assert.equal((error as {status:number}).status,status);assert.doesNotMatch(String(error),/PRIVATE CANARY/);return true;
    });
  }
});
