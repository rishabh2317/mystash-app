/** Offline real routes/service/codec/PostgreSQL integration. Storage and paid providers are fixtures. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {PrivateImageService,type MediaStore,type PrivateImageStorage} from './service';
import {registerPrivateImageHandlers} from './routes';
import {imageDigest,type ImageAsset} from './contracts';
import {normalizeImage} from './imageCodec';
import {ShareError} from '../share/contracts';
const socket=process.env.FIND_TEST_PG_SOCKET;
if(!socket?.startsWith('/private/tmp/mystash-find-foundations-'))throw Error('Self-owned disposable PostgreSQL required');
const exec=promisify(execFile),owner='99999999-9999-4999-8999-999999999999',other='88888888-8888-4888-8888-888888888888';
const quote=(value:unknown)=>value===null?'NULL':`'${String(value).replace(/'/g,"''")}'`;
async function sql(statement:string){const {stdout}=await exec('/opt/homebrew/opt/postgresql@17/bin/psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket!,'-p','55443','-U','postgres','-c',statement],{timeout:25000,maxBuffer:8*1024*1024,env:{...process.env,PGDATABASE:'postgres',PGOPTIONS:''}});return stdout.trim();}
const store:MediaStore={async command<T>(user:string|null,action:string,id:string|null=null,input:Record<string,unknown>={}):Promise<T>{
  try{return JSON.parse(await sql(`SELECT find_media_command(${quote(user)},${quote(action)},${quote(id)},${quote(JSON.stringify(input))}::jsonb);`)) as T;}
  catch(error){const code=(error as {stderr?:string}).stderr?.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];throw new ShareError(code==='P0002'?'image_not_found':'image_conflict',code==='P0002'?404:409);}
}};
const objects=new Map<string,Buffer>();let failDeletion=false,normalizations=0;
const storage:PrivateImageStorage={async signUpload(path){return{signedUrl:`https://fixture.invalid/${path}?token=PRIVATE`,token:'PRIVATE'};},async read(path){const data=objects.get(path);if(!data)throw new ShareError('image_storage_unavailable',503);return data;},async put(path,data){const previous=objects.get(path);if(previous)assert.equal(imageDigest(previous),imageDigest(data));objects.set(path,data);},async remove(paths){if(failDeletion)throw Error('offline Storage fixture');paths.forEach(path=>objects.delete(path));}};
const service=new PrivateImageService(store,storage,async(bytes,mime)=>{normalizations++;return normalizeImage(bytes,mime);});
const routes=new Map<string,(req:Request,res:Response)=>Promise<void>>();
const app=Object.fromEntries(['get','post','delete'].map(method=>[method,(path:string,handler:never)=>routes.set(method+' '+path,handler)])) as unknown as Express;
registerPrivateImageHandlers(app,{authenticate:async req=>req.headers.authorization?{userId:String(req.headers.authorization)}:null,service,enabled:()=>true});
async function request(key:string,user:string|null,body?:unknown,params:Record<string,string>={}){
 let status=200,result:unknown;const headers:Record<string,string>={};const response={headersSent:false,setHeader(key:string,value:string){headers[key]=value;},status(value:number){status=value;return this;},json(value:unknown){result=value;this.headersSent=true;},send(value:unknown){result=value;this.headersSent=true;}};
 await routes.get(key)!({body,params,headers:{authorization:user??undefined}} as Request,response as unknown as Response);return{status,result:result as Record<string,unknown>,headers};
}
async function main(){
 await sql(`INSERT INTO auth.users VALUES('${owner}'),('${other}');INSERT INTO users(id) VALUES('${owner}'),('${other}');`);
 const image=await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=16x12','-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{encoding:'buffer',timeout:10000,maxBuffer:1024*1024});
 const bytes=image.stdout,body={captureId:randomUUID(),sha256:imageDigest(bytes),size:bytes.length,mime:'image/png',origin:'gallery'};
 assert.equal((await request('post /finds/media/uploads',null,body)).status,401);
 const init=await request('post /finds/media/uploads',owner,body);assert.equal(init.status,200);
 const id=String(init.result.uploadId),upload=init.result.upload as {path:string};objects.set(upload.path,bytes);
 const foreign=await request('post /finds/media/uploads/:uploadId/complete',other,{}, {uploadId:id});assert.equal(foreign.status,404);
 assert.equal((await request('post /finds/media/uploads',owner,{...body,sha256:'d'.repeat(64)})).status,409);
 const completions=await Promise.all([request('post /finds/media/uploads/:uploadId/complete',owner,{}, {uploadId:id}),request('post /finds/media/uploads/:uploadId/complete',owner,{}, {uploadId:id})]);
 assert.equal(completions.filter(reply=>reply.status===200).length,1);assert.equal(completions.filter(reply=>reply.status===409).length,1);
 const accepted=completions.find(reply=>reply.status===200)!.result,imported=String(accepted.importId);
 assert.equal(normalizations,1);await request('post /finds/media/uploads/:uploadId/complete',owner,{}, {uploadId:id});assert.equal(normalizations,1);
 const original=await request('get /finds/:findId/media/:variant',owner,undefined,{findId:imported,variant:'original'});assert.equal(original.status,200);assert.equal(original.headers['Cache-Control'],'private, no-store');
 assert.equal((await request('get /finds/:findId/media/:variant',other,undefined,{findId:imported,variant:'thumbnail'})).status,404);
 const asset=await store.command<ImageAsset>(owner,'status',id),source=asset.source_id!;
 assert.equal(await sql(`SELECT count(*) FROM share_acceptance_receipts WHERE user_id='${owner}' AND import_id='${imported}';`),'1');
 const duplicate=await request('post /finds/media/uploads',owner,{...body,captureId:randomUUID()});objects.set((duplicate.result.upload as {path:string}).path,bytes);
 const second=await request('post /finds/media/uploads/:uploadId/complete',owner,{}, {uploadId:String(duplicate.result.uploadId)});assert.equal(second.result.importId,imported);assert.equal(second.result.state,'duplicate');
 // Committed source evidence uses the same result/member RPCs as URL extraction.
 const product='77777777-7777-4777-8777-777777777777';
 await sql(`INSERT INTO catalog_products(id) VALUES('${product}');`);
 const productRow=await sql(`INSERT INTO content_source_products(content_source_id,external_id,name,extraction_method,processor_version,catalog_product_id,evidence) VALUES('${source}','fixture','Camera','ai_extract','fixture','${product}','{"summary":"PRIVATE OCR CANARY"}') RETURNING id;`);
 const provenance=JSON.stringify({source_surface:'USER_IMPORT',source_user_import_id:imported,source_content_source_id:source});
 await sql(`SELECT find_cart_put('${owner}','${product}',NULL,${quote(provenance)}::jsonb,true);`);
 const read=JSON.parse(await sql(`SELECT find_detail('${owner}','${imported}');`));assert.equal(read.outcome.foundProducts,1);assert.equal(read.outcome.savedProducts,1);assert.equal(read.sourceUrl,null);assert.equal(read.sourceType,'image');assert.doesNotMatch(JSON.stringify(read),/original.jpg|PRIVATE OCR CANARY|token=/);
 await sql(`SELECT find_result_action('${owner}','${imported}','product','${productRow}',false,'c:${product}');SELECT find_cart_put('${owner}','${product}',NULL,${quote(provenance)}::jsonb,true);`);
 assert.equal(JSON.parse(await sql(`SELECT find_detail('${owner}','${imported}');`)).outcome.savedProducts,0);
 await sql(`SELECT find_result_action('${owner}','${imported}','product','${productRow}',true,'c:${product}');`);
 const place=JSON.parse(await sql(`SELECT place_upsert_hypothesis(${quote(JSON.stringify({content_source_id:source,extracted_name:'Cafe River',city:'Jaipur',country:'India',confidence:0.9,evidence:{summary:'PRIVATE PLACE CANARY'},sources:['OCR'],hypothesis_key:'image-fixture',unresolved_reason:'pending_resolution'}))}::jsonb);`));
 const save=JSON.parse(await sql(`SELECT place_attach_import('${owner}','${place.id}','${source}','${imported}');`));
 // A delete wins before byte I/O completes; reads are unavailable immediately, cleanup retries durably.
 await sql(`UPDATE user_imports SET hidden_at=clock_timestamp() WHERE id='${imported}';`);
 assert.equal((await request('get /finds/:findId/media/:variant',owner,undefined,{findId:imported,variant:'original'})).status,404);
 assert.ok(await service.reconcile()>0);assert.ok(!objects.has(asset.original_path));assert.equal((await service.status(owner,id)).state,'deleting');
 await sql(`UPDATE find_image_assets SET upload_expires_at=clock_timestamp()-interval '1 hour',cleanup_after=clock_timestamp(),verify_until=NULL WHERE user_id='${owner}';`);
 failDeletion=true;assert.equal(await service.reconcile(),0);assert.equal((await service.status(owner,id)).state,'deleting');
 await sql(`UPDATE find_image_assets SET cleanup_until=clock_timestamp()-interval '1 minute',cleanup_after=clock_timestamp() WHERE user_id='${owner}';`);
 failDeletion=false;assert.ok(await service.reconcile()>0);assert.equal((await service.status(owner,id)).state,'deleted');assert.ok(!objects.has(asset.original_path));
 assert.equal(await sql(`SELECT count(*) FROM cart_items WHERE user_id='${owner}' AND catalog_product_id='${product}' AND removed_at IS NULL;`),'1');
 assert.doesNotMatch(await sql(`SELECT evidence::text||name FROM content_source_products WHERE content_source_id='${source}';`),/PRIVATE OCR CANARY/);
 assert.equal(await sql(`SELECT extracted_name FROM content_source_places WHERE id='${place.id}';`),'Cafe River');
 assert.equal(await sql(`SELECT hypothesis_key FROM content_source_places WHERE id='${place.id}';`),`deleted:${place.id}`);
 assert.doesNotMatch(await sql(`SELECT evidence::text FROM content_source_places WHERE id='${place.id}';`),/PRIVATE PLACE CANARY/);
 await sql(`SELECT find_place_membership('${owner}','${save.id}',false);SELECT find_place_membership('${owner}','${save.id}',true);`);
 assert.equal(await sql(`SELECT count(*) FROM user_place_saves WHERE id='${save.id}' AND removed_at IS NULL;`),'1');
 assert.equal(JSON.parse(await sql(`SELECT find_image_attributions('${owner}',ARRAY['${source}']::uuid[]);`))[0].label,'Original image removed');
 // Abandoned input and cancellation recover through the same bounded cleanup path.
 const cancelled=await request('post /finds/media/uploads',owner,{...body,captureId:randomUUID()});const cancelledId=String(cancelled.result.uploadId);
 await service.cancel(owner,cancelledId);assert.equal((await request('post /finds/media/uploads/:uploadId/complete',owner,{}, {uploadId:cancelledId})).status,409);
 const sign=storage.signUpload;
 storage.signUpload=async path=>{const signed=await sign(path);const allocation=await sql(`SELECT id FROM find_image_assets WHERE staging_path=${quote(path)};`);await service.cancel(owner,allocation);return signed;};
 const raced=await request('post /finds/media/uploads',owner,{...body,captureId:randomUUID()});assert.equal(raced.status,409);assert.doesNotMatch(JSON.stringify(raced.result),/PRIVATE|token|signedUrl/);
 storage.signUpload=sign;
 console.log('PASS private image API/service/real codec/SQL integration: verifier concurrency, receipt replay, digest conflict, normalized dedupe, owner isolation, authenticated bytes, automatic saving, durable removals/restoration, deletion retry and evidence purge');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
