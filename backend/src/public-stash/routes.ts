import {logger} from '../logger';
import {attributionLink} from '../place/photos/contract';
import {getBullmqCommandRedis} from '../workers/redisConnection';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response} from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {requireAuthUserId,optionalVerifiedUserId} from '../auth/requireAuth';
import {createSupabaseAdmin} from '../supabase';
import {createProductPageService} from '../product-page/factory';
import {resolveShoppingRequestCountry} from '../shopping/requestCountry';
import {createProductRedirectHandler} from '../shopping/productRedirect';
import {GooglePlacePhotoProvider} from '../place/photos/GooglePlacePhotoProvider';
import {getEnv} from '../env';
import {analyticsEnabled} from '../analytics/flags';
import {PublicStashService} from './service';
import {StashError,uuid,version,itemInput,type StashSettings} from './contracts';
import {crawler,recordStashAction} from './measurement';
export const publicStashEnabled=()=>process.env.PUBLIC_STASH_ENABLED==='true';
const buckets=new Map<string,{since:number;count:number}>();
async function rateKey(raw:string,max:number){
 const key=createHash('sha256').update(raw).digest('hex'),now=Date.now();
 if(process.env.REDIS_URL){try{const redis=getBullmqCommandRedis();if(redis.status==='ready'){
  const count=Number(await redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end;return n",1,`public-stash:rate:${key}`));return count<=max;
 }}catch{/* Keep the bounded local guard available if shared Redis is unavailable. */}}
 for(const [k,b] of buckets)if(now-b.since>60000)buckets.delete(k);
 const b=buckets.get(key)??{since:now,count:0};if((!buckets.has(key)&&buckets.size>=5000)||b.count>=max)return false;b.count++;buckets.set(key,b);return true;
}
export async function publicStashRateAllowed(req:Request,max=120){
 if(!await rateKey(`ip:${req.ip??req.socket.remoteAddress}`,max))return false;
 return !req.params.publicId || await rateKey(`stash:${req.params.publicId}`,300);
}

function fail(res:Response,error:unknown){const status=error instanceof StashError?error.status:503;res.status(status).json({error:status===409?'Refresh publication state and try again.':status===400?'Invalid Public Stash request.':'Stash unavailable'});}
export function registerPublicStashRoutes(app:Express,deps:{db?:SupabaseClient;authenticate?:typeof requireAuthUserId}={}){
 const db=deps.db??createSupabaseAdmin(),svc=new PublicStashService(db),products=createProductPageService(db);
 let redirect:ReturnType<typeof createProductRedirectHandler>|null=null;
 const photos=new GooglePlacePhotoProvider({apiKey:getEnv('GOOGLE_PLACES_API_KEY')});
 const wrap=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(!publicStashEnabled()){res.status(404).json({error:'Stash unavailable'});return;}
  if(!await publicStashRateAllowed(req)){res.status(429).json({error:'Please try again shortly'});return;}
  const started=Date.now();try{await fn(req,res);}catch(e){fail(res,e);}finally{logger.info({route:req.route?.path,status:res.statusCode,durationMs:Date.now()-started},'public_stash.request');}
 };
 const owner=async(req:Request,res:Response,max=120)=>{const actor=await (deps.authenticate??requireAuthUserId)(req,res,{requireVerifiedEmail:true});if(actor&&!await rateKey(`actor:${actor}`,max)){res.status(429).json({error:'Please try again shortly'});return null;}return actor;};
 async function preview(req:Request,res:Response){if(req.query.preview!=='1')return null;return await owner(req,res);}
 app.get('/public-stashes/me',wrap(async(req,res)=>{const user=await owner(req,res);if(user)res.json(await svc.settings(user));}));
 app.put('/public-stashes/me/visibility',wrap(async(req,res)=>{
  const user=await owner(req,res,30);if(!user)return;
  if(!['private','public'].includes(req.body?.visibility)||Object.keys(req.body).some(k=>!['visibility','expectedVersion'].includes(k)))throw new StashError(400,'Invalid request');
  res.json(await svc.rpc<StashSettings>('public_stash_visibility',{p_user:user,p_visibility:req.body.visibility,p_version:version(req.body.expectedVersion)}));
 }));
 for(const [path,kind] of [['products','product'],['places','place']] as const)app.put(`/public-stashes/me/${path}/:membershipId/publication`,wrap(async(req,res)=>{
  const user=await owner(req,res,30);if(!user)return;
  if(typeof req.body?.published!=='boolean'||(req.body.enablePublic!==undefined&&typeof req.body.enablePublic!=='boolean')||Object.keys(req.body).some(k=>!['published','expectedVersion','enablePublic'].includes(k)))throw new StashError(400,'Invalid request');
  res.json(await svc.rpc('public_stash_publish',{p_user:user,p_kind:kind,p_membership:uuid(req.params.membershipId),p_published:req.body.published,p_version:version(req.body.expectedVersion),p_enable:req.body.enablePublic===true}));
 }));
 app.get('/public-stashes/me/insights',wrap(async(req,res)=>{const user=await owner(req,res);if(!user)return;const days=Number(req.query.days??7);if(![7,30].includes(days))throw new StashError(400,'Invalid range');res.json({...await svc.rpc<object>('public_stash_insights',{p_user:user,p_days:days}),enabled:analyticsEnabled()});}));
 app.get('/public-stashes/:publicId',wrap(async(req,res)=>{const viewer=await preview(req,res);if(req.query.preview==='1'&&!viewer)return;res.json(await svc.page(uuid(req.params.publicId),req.query,viewer));}));
 app.get('/public-stashes/:publicId/products/:namespace/:productId/page',wrap(async(req,res)=>{
  const publicId=uuid(req.params.publicId),id=uuid(req.params.productId),viewer=await preview(req,res);if(req.query.preview==='1'&&!viewer)return;
  await svc.item(publicId,'product',req.params.namespace,id,viewer);
  const commerceCountry=await resolveShoppingRequestCountry(db,req);
  const page=await products.getPage(id,{country:commerceCountry,publicRead:true});
  const actor=await optionalVerifiedUserId(req);let viewerSaved=false;
  if(actor){const saved=await db.from('cart_items').select('id').eq('user_id',actor).is('removed_at',null).or(`catalog_product_id.eq.${page.productId},discovered_product_id.eq.${page.productId}`).limit(1);viewerSaved=!saved.error&&!!saved.data?.length;}
  res.json({...page,viewerSaved,commerceCountry});
 }));
 app.get('/public-stashes/:publicId/places/:placeId',wrap(async(req,res)=>{
  const viewer=await preview(req,res);if(req.query.preview==='1'&&!viewer)return;
  const place=await svc.item(uuid(req.params.publicId),'place','place',uuid(req.params.placeId),viewer);
  const actor=await optionalVerifiedUserId(req);let viewerSaved=false;if(actor){const saved=await db.from('user_place_saves').select('id').eq('user_id',actor).eq('place_id',place.id).is('removed_at',null).limit(1);viewerSaved=!saved.error&&!!saved.data?.length;}
  res.json({viewerSaved,id:place.id,name:place.name,category:place.category,city:place.city,region:place.region,country:place.country,locality:place.locality,formattedAddress:place.formattedAddress,latitude:place.latitude,longitude:place.longitude,mapsUrl:attributionLink(place.mapsUrl),provider:place.provider});
 }));
 app.get('/public-stashes/:publicId/places/:placeId/photo',wrap(async(req,res)=>{
  const viewer=await preview(req,res);if(req.query.preview==='1'&&!viewer)return;
  const width=Number(req.query.width??640);if(![128,256,640].includes(width))throw new StashError(400,'Invalid size');
  const place=await svc.item(uuid(req.params.publicId),'place','place',uuid(req.params.placeId),viewer);
  if(crawler(req)){res.json({image:null});return;}
  if(place.provider!=='google'){res.json({image:null});return;}
  try{res.json({image:await photos.photo(place.providerPlaceId,width)});}catch{res.json({image:null,retryAfterMs:1000});}finally{logger.info(photos.metrics(),'public_stash.photo_counters');}
 }));
 app.post('/public-stashes/:publicId/items/save',wrap(async(req,res)=>{
  const user=await owner(req,res,60);if(!user)return;const item=itemInput(req.body),stash=uuid(req.params.publicId);
  if(Object.keys(req.body).some(k=>!['kind','namespace','itemId'].includes(k)))throw new StashError(400,'Invalid save');
  const result=await svc.rpc<{saved:boolean;created:boolean}>('public_stash_save',{p_user:user,p_public:stash,p_kind:item.kind,p_namespace:item.namespace,p_item:item.itemId});
  if(result.created)await recordStashAction(db,req,user,stash,'stash.item_saved',item.kind,item.itemId,item.namespace==='place'?undefined:item.namespace);
  res.json(result);
 }));
 app.get('/public-stashes/:publicId/products/:namespace/:productId/outbound',wrap(async(req,res)=>{
  const stash=uuid(req.params.publicId),id=uuid(req.params.productId);await svc.item(stash,'product',req.params.namespace,id);
  if(req.query.discovery==='1'){
   const page=await products.getPage(id,{country:await resolveShoppingRequestCountry(db,req),publicRead:true});if(!page.discovery)throw new StashError(404,'Unavailable');
   const user=await optionalVerifiedUserId(req);
   await recordStashAction(db,req,user,stash,'merchant.outbound_resolved','product',id,req.params.namespace==='catalog'?'catalog':'discovered',{destination_kind:page.discovery.kind,affiliate:false,request_id:/^[0-9a-f-]{36}$/i.test(String(req.headers['x-mystash-outbound-id']??req.query.eventId))?String(req.headers['x-mystash-outbound-id']??req.query.eventId):randomUUID()});
   if(req.query.format==='json')res.json({url:page.discovery.url,merchantName:null,country:page.discovery.country});else res.redirect(302,page.discovery.url);return;
  }
  delete req.query.collectionId;delete req.query.tagId;delete req.query.creatorId;delete req.query.videoId;
  req.params.id=id;req.query.publicStashId=stash;redirect??=createProductRedirectHandler(db);await redirect(req,res);
 }));
}
