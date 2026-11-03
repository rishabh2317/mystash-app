/** Local mobile/API/SQL integration. Auth, Storage, native persistence and extraction facts are fixtures.
 * Actual codecs, acceptance, queries, membership recovery and notification/measurement RPCs execute.
 * Run only through backend/scripts/findReadinessSqlScratch.py. Never reads dotenv or contacts providers.
 */
const assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomUUID}=require('node:crypto');
const {Buffer}=require('node:buffer');
const {ShareAcceptanceService,shareAcceptanceStore}=require('../backend/src/user-import/share/service.ts');
const {ShareError}=require('../backend/src/user-import/share/contracts.ts');
const {PrivateImageService}=require('../backend/src/user-import/media/service.ts');
const {registerPrivateImageHandlers}=require('../backend/src/user-import/media/routes.ts');
const {imageDigest}=require('../backend/src/user-import/media/contracts.ts');
const {FindQueryService}=require('../backend/src/user-import/find/queryService.ts');
const {readFindMemberships}=require('../backend/src/user-import/find/membershipQuery.ts');
const {reconcileStashSync}=require('../backend/src/user-import/find/stashSync.ts');
const {buildMaterializeRender}=require('../backend/src/notifications/domain/eventTypes.ts');
const {createCaptureDelivery}=require('../src/services/captureDelivery.ts');
const {createCaptureTransport}=require('../src/services/captureTransport.ts');
const socket=process.env.FIND_TEST_PG_SOCKET;
assert.match(socket??'',/^\/private\/tmp\/mystash-find-foundations-[^/]+$/);
const exec=promisify(execFile),owner=randomUUID(),other=randomUUID(),imports=[];
function literal(value){
 if(value==null)return 'NULL';if(typeof value==='number'||typeof value==='boolean')return String(value);
 if(Array.isArray(value))return `ARRAY[${value.map(literal).join(',')}]::uuid[]`;
 return "'"+String(typeof value==='object'?JSON.stringify(value):value).replace(/'/g,"''")+"'";
}
async function sql(statement){const {stdout}=await exec('/opt/homebrew/opt/postgresql@17/bin/psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket,'-p','55443','-U','postgres','-c',statement],{timeout:25000,maxBuffer:8*1024*1024,env:{...process.env,PGDATABASE:'postgres',PGOPTIONS:''}});return stdout.trim();}
const allowed=new Set(['share_accept','find_query','find_detail','find_result_action','find_outcome_memberships']);
const db={rpc(name,args){assert.ok(allowed.has(name));const operation=async()=>{
 try{const params=Object.entries(args).map(([key,value])=>{assert.match(key,/^p_[a-z_]+$/);return `${key}=>${literal(value)}`;}).join(',');
  const call=`public.${name}(${params})`,query=name==='find_outcome_memberships'?`SELECT coalesce(jsonb_agg(m),'[]') FROM ${call} m;`:`SELECT ${call};`;
  return{data:JSON.parse(await sql(query)),error:null};
 }catch(error){return{data:null,error:{message:error.stderr??error.message,code:error.stderr?.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]??'storage'}};}
 };return{then:(resolve,reject)=>operation().then(resolve,reject),abortSignal:operation};}};
const queries=new FindQueryService(db),shares=new ShareAcceptanceService(shareAcceptanceStore(db),async()=>true,()=>false);
const objects=new Map(),storage={signUpload:async path=>({signedUrl:`https://storage.example.test/storage/v1/object/upload/sign/find-private-images/${path}?token=FIXTURE`,token:'FIXTURE'}),read:async path=>{const b=objects.get(path);if(!b)throw new ShareError('image_storage_unavailable',503);return b;},put:async(path,b)=>{objects.set(path,b);},remove:async paths=>paths.forEach(path=>objects.delete(path))};
const store={command:async(user,action,id=null,input={})=>{try{return JSON.parse(await sql(`SELECT find_media_command(${literal(user)},${literal(action)},${literal(id)},${literal(input)}::jsonb);`));}catch(error){const missing=/P0002/.test(error.stderr??'');throw new ShareError(missing?'image_not_found':'image_conflict',missing?404:409);}}};
const media=new PrivateImageService(store,storage),routes=new Map();let enabled=true;
registerPrivateImageHandlers(Object.fromEntries(['post','get','delete'].map(method=>[method,(path,handler)=>routes.set(method+' '+path,handler)])),{authenticate:async req=>[owner,other].includes(req.headers.authorization)?{userId:req.headers.authorization}:null,service:media,enabled:()=>enabled});
async function request(key,user,body,params={}){let status=200,result;const headers={};const response={headersSent:false,setHeader(k,v){headers[k]=v;},status(v){status=v;return this;},json(v){result=v;this.headersSent=true;},send(v){result=v;this.headersSent=true;}};await routes.get(key)({body,params,headers:{authorization:user}},response);return{status,result,headers};}
async function sync(id,failProducts=false){
 const source=await sql(`SELECT content_source_id FROM user_imports WHERE id=${literal(id)};`);
 await sql(`UPDATE user_imports SET stash_sync_after=clock_timestamp()+interval '1 day' WHERE id<>${literal(id)};UPDATE user_imports SET stash_sync_after=clock_timestamp() WHERE id=${literal(id)};`);
 return reconcileStashSync({
  claim:async lease=>JSON.parse(await sql(`SELECT coalesce(jsonb_agg(c),'[]') FROM find_claim_stash_sync(${literal(lease)},25) c;`)),
  products:async()=>{if(failProducts)throw Error('fixture membership interruption');const rows=JSON.parse(await sql(`SELECT coalesce(jsonb_agg(p),'[]') FROM content_source_products p WHERE content_source_id=${literal(source)};`));for(const p of rows)await sql(`SELECT find_cart_put(${literal(owner)},${literal(p.catalog_product_id)},NULL,${literal({source_surface:'USER_IMPORT',source_user_import_id:id,source_content_source_id:source})}::jsonb,true);`);},
  places:async()=>{const rows=JSON.parse(await sql(`SELECT coalesce(jsonb_agg(h.id),'[]') FROM content_source_places h WHERE content_source_id=${literal(source)} AND retired_at IS NULL;`));for(const h of rows)await sql(`SELECT place_attach_import(${literal(owner)},${literal(h)},${literal(source)},${literal(id)});`);},
  memberships:async()=>{const row=(await readFindMemberships(db,owner,[id])).get(id);assert.ok(row);return row;},
  finish:async(row,lease,success)=>(await sql(`SELECT find_finish_stash_sync(${literal(row.id)},${literal(lease)},${row.stash_sync_revision},${literal(success)});`))==='t',
 });
}
async function settle(id,{products=1,places=1,partial=false}={}){
 const source=await sql(`SELECT content_source_id FROM user_imports WHERE id=${literal(id)};`),attempt=randomUUID();
 await sql(`INSERT INTO content_source_import_progress(content_source_id,attempt_id,extraction_version,started_at,product_status,place_status) VALUES(${literal(source)},${literal(attempt)},'readiness',clock_timestamp(),'running','running');UPDATE content_sources SET processing_status='PROCESSING' WHERE id=${literal(source)};`);
 // Provider/worker facts are deliberately injected: no claim of live extraction or a real queue worker.
 for(let n=0;n<products;n++){const product=randomUUID();await sql(`INSERT INTO catalog_products(id) VALUES(${literal(product)});INSERT INTO content_source_products(content_source_id,external_id,name,extraction_method,processor_version,catalog_product_id) VALUES(${literal(source)},${literal(String(n))},'Fixture product','ai_extract','readiness',${literal(product)});`);}
 for(let n=0;n<places;n++)await sql(`SELECT place_upsert_hypothesis(${literal({content_source_id:source,extracted_name:'Fixture cafe '+n,city:'Jaipur',country:'India',confidence:0.9,evidence:{summary:'PRIVATE CANARY'},sources:['OCR'],hypothesis_key:'readiness-'+n,unresolved_reason:'pending_resolution'})}::jsonb);`);
 await sql(`UPDATE content_source_import_progress SET product_status='complete',place_status=${literal(partial?'failed':'complete')} WHERE content_source_id=${literal(source)};UPDATE content_sources SET processing_status='READY',last_processed_at=clock_timestamp() WHERE id=${literal(source)};`);
 await sql('SELECT find_reconcile_delivery(true,true,100);');
 if(products+places>0)assert.equal(await sql(`SELECT count(*) FROM notification_outbox WHERE payload->>'findId'=${literal(id)};`),'0');
 if(products){assert.equal((await sync(id,true)).deferred,1);assert.equal((await queries.detail(owner,id)).outcome.stashSync,'failed');}
 assert.equal((await sync(id)).complete,1);
 const detail=await queries.detail(owner,id);assert.equal(detail.outcome.foundProducts,products);assert.equal(detail.outcome.savedProducts,products);assert.equal(detail.outcome.foundPlaces,places);assert.equal(detail.outcome.savedPlaces,places);assert.equal(detail.outcome.result,partial?'partial':products+places?'found':'empty');
 await sql('SELECT find_reconcile_delivery(true,true,100);SELECT find_reconcile_delivery(true,true,100);');
 assert.equal(await sql(`SELECT count(*) FROM notification_outbox WHERE payload->>'findId'=${literal(id)};`),'1');
 if(products&&places){const p=detail.products[0],h=detail.places[0];await queries.resultAction(owner,id,'product',p.id,false,p.identityKey);await queries.resultAction(owner,id,'place',h.id,false);
  await sql(`UPDATE user_imports SET stash_sync_state='pending',stash_sync_after=clock_timestamp() WHERE id=${literal(id)};`);await sync(id);
  const removed=await queries.detail(owner,id);assert.equal(removed.outcome.savedProducts,products-1);assert.equal(removed.outcome.savedPlaces,places-1);assert.equal(removed.outcome.foundProducts,products);
  await queries.resultAction(owner,id,'product',p.id,true,p.identityKey);await queries.resultAction(owner,id,'place',h.id,true);assert.equal((await queries.detail(owner,id)).outcome.savedPlaces,places);
 }
 await assert.rejects(queries.detail(other,id),error=>error.status===404);return detail;
}
async function imageCapture(origin,color){
 const {stdout:bytes}=await exec('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=32x24`,'-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{encoding:'buffer',timeout:10000,maxBuffer:1024*1024});
 const row={version:1,id:randomUUID(),owner,origin,mime:'image/png',sha256:imageDigest(bytes),size:bytes.length,state:'pending',createdAt:1,attempts:0,notBefore:0};
 let local={...row},pixels=bytes.toString('base64'),account=owner,online=false,lostReply=true,uploads=0;
 const transport=createCaptureTransport({base:()=> 'https://api.example.test',storage:()=> 'https://storage.example.test',session:async()=>({userId:account,accessToken:account}),fetch:async(url,init)=>{
  if(!online)throw Error('fixture offline');const target=new URL(String(url));
  if(target.hostname==='storage.example.test'){assert.equal(init.headers.Authorization,undefined);uploads++;objects.set(decodeURIComponent(target.pathname).split('/find-private-images/')[1],Buffer.from(init.body));return Response.json({});}
  const body=JSON.parse(init.body),user=init.headers.Authorization.slice(7);
  if(target.pathname==='/finds/batch'){const found=await queries.batch(user,body.ids);return Response.json(found);}
  const complete=target.pathname.endsWith('/complete'),reply=await request(complete?'post /finds/media/uploads/:uploadId/complete':'post /finds/media/uploads',user,body,complete?{uploadId:target.pathname.split('/').at(-2)}:{});
  if(complete&&reply.status===200&&lostReply){lostReply=false;throw Error('fixture acknowledgement lost');}
  return Response.json(reply.result,{status:reply.status});
 }});
 const outbox={list:async user=>local&&local.owner===user?[{...local}]:[],bytes:async()=>pixels,update:async(_id,user,patch)=>{assert.equal(user,account);local={...local,...patch};if(patch.state==='accepted')pixels=null;},remove:async(_id,user)=>{assert.equal(user,account);local=null;pixels=null;}};
 let drain=createCaptureDelivery(outbox,transport,()=>{});drain.configure(owner);await drain.pump();assert.ok(pixels);assert.equal(local.state,'pending');
 online=true;account=other;drain.configure(owner);await drain.pump(true);assert.ok(pixels);assert.equal(local.state,'pending');assert.equal(uploads,0);
 assert.equal(await sql(`SELECT count(*) FROM find_image_assets WHERE capture_id=${literal(row.id)};`),'0');
 account=owner;drain=createCaptureDelivery(outbox,transport,()=>{});drain.configure(owner);await drain.pump(true);assert.ok(pixels);assert.equal(local.state,'pending');
 drain=createCaptureDelivery(outbox,transport,()=>{});drain.configure(owner);await drain.pump(true);assert.equal(local,null);assert.equal(pixels,null);assert.equal(uploads,1);
 const id=await sql(`SELECT import_id FROM find_image_assets WHERE user_id=${literal(owner)} AND capture_id=${literal(row.id)};`);imports.push(id);
 enabled=false;assert.equal((await request('get /finds/:findId/media/:variant',owner,undefined,{findId:id,variant:'thumbnail'})).status,200);assert.equal((await request('get /finds/:findId/media/:variant',other,undefined,{findId:id,variant:'thumbnail'})).status,404);
 assert.equal((await request('post /finds/media/uploads',owner,{captureId:randomUUID(),sha256:row.sha256,size:row.size,mime:row.mime,origin})).status,503);enabled=true;
 return id;
}
async function main(){
 await sql(`INSERT INTO auth.users VALUES(${literal(owner)}),(${literal(other)});INSERT INTO users(id) VALUES(${literal(owner)}),(${literal(other)});SELECT analytics_set_preferences(${literal(owner)},true,true);`);
 for(const [index,text] of ['https://www.instagram.com/reel/ReadinessTest/','https://www.youtube.com/watch?v=abc123xyz78','https://shop.example.test/products/readiness'].entries()){
  const body={text,clientCaptureId:randomUUID()},accepted=await shares.accept(owner,body),replay=await shares.accept(owner,body);assert.equal(replay.importId,accepted.importId);assert.equal(replay.replayed,true);imports.push(accepted.importId);
  await settle(accepted.importId,{products:index===2?0:1,places:index===2?0:1,partial:index===1});
 }
 await settle(await imageCapture('gallery','blue'),{products:5,places:2});await settle(await imageCapture('camera','red'));
 const page=await queries.list(owner,{limit:2});assert.equal(page.counts.all,5);assert.equal(page.items.length,2);assert.ok(page.nextCursor);const next=await queries.list(owner,{limit:2,cursor:page.nextCursor});assert.ok(next.items.every(row=>!page.items.some(first=>first.id===row.id)));
 const claimed=JSON.parse(await sql("SELECT coalesce(jsonb_agg(o),'[]') FROM notification_claim_outbox(100,60,10) o;"));
 for(const o of claimed.filter(o=>imports.includes(o.payload.findId))){const render=buildMaterializeRender({eventType:o.event_type,recipientUserId:o.recipient_user_id,payload:o.payload});assert.doesNotMatch(JSON.stringify(render),/PRIVATE|fixture.invalid|example.test|token=/);await sql(`SELECT * FROM notification_materialize(${o.outbox_id},${literal(o.lease_token)},${literal(render)}::jsonb,NULL);`);}
 assert.equal(await sql(`SELECT count(*) FROM notifications WHERE user_id=${literal(owner)} AND type='find.completed';`),'5');
 assert.equal(await sql(`SELECT count(*) FROM analytics_events WHERE actor_id=${literal(owner)} AND event_name='find.ingestion_accepted';`),'5');
 assert.equal(await sql(`SELECT count(*) FROM analytics_events WHERE actor_id=${literal(owner)} AND event_name='find.processing_completed';`),'5');
 assert.equal(await sql(`SELECT count(*) FROM analytics_events WHERE actor_id=${literal(owner)} AND session_id IS NOT NULL;`),'0');
 await sql(`SELECT analytics_set_preferences(${literal(owner)},false,false);`);assert.equal(await sql(`SELECT count(*) FROM analytics_events WHERE actor_id=${literal(owner)};`),'0');
 console.log('PASS 5 integrated contracts: Reel, YouTube partial, web zero, gallery 5 products/2 places, camera; actual codecs/SQL/API/mobile delivery, offline/restart/account switch/lost reply, saving repair/removal/restoration, pagination, one completion each, consent withdrawal. Auth/Storage/native persistence/extraction facts are fixtures; no live worker/provider/device claims.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
