import type { Express, Request, Response } from 'express';
import { supabaseUserImportAuthenticator, type UserImportAuthenticator } from '../routes';
import { sendAuthError } from '../../auth/requireAuth';
import { createSupabaseAdmin } from '../../supabase';
import { getEnv } from '../../env';
import { getBullmqCommandRedis } from '../../workers/redisConnection';
import { ShareError } from '../share/contracts';
import { createPrivateImageService } from './factory';
import type { PrivateImageService } from './service';
export function registerPrivateImageHandlers(app: Pick<Express,'post'|'get'|'delete'>,deps:{authenticate:UserImportAuthenticator;service:PrivateImageService;enabled:()=>boolean;admit?:(user:string)=>Promise<boolean>}) {
  const route=(mutation:boolean,action:(user:string,req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    try {
      const user=await deps.authenticate(req);if(!user){res.status(401).json({error:'authentication_required'});return;}
      if(mutation&&!deps.enabled())throw new ShareError('image_ingestion_unavailable',503);
      if(mutation&&deps.admit&&!(await deps.admit(user.userId)))throw new ShareError('image_rate_limit',429);
      const result=await action(user.userId,req,res);if(!res.headersSent)res.json(result);
    }catch(error){if(sendAuthError(res,error))return;const safe=error instanceof ShareError?error:new ShareError('image_unavailable',503);if([429,503].includes(safe.status))res.setHeader('Retry-After','60');res.status(safe.status).json({error:safe.code});}
  };
  const empty=(req:Request)=>{if(req.body!==undefined&&(req.body===null||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw new ShareError('invalid_image_action');};
  app.post('/finds/media/uploads',route(true,(user,req)=>deps.service.initialize(user,req.body)));
  app.get('/finds/media/uploads/:uploadId',route(false,(user,req)=>deps.service.status(user,String(req.params.uploadId))));
  app.post('/finds/media/uploads/:uploadId/complete',route(true,(user,req)=>{empty(req);return deps.service.complete(user,String(req.params.uploadId));}));
  app.delete('/finds/media/uploads/:uploadId',route(false,(user,req)=>{empty(req);return deps.service.cancel(user,String(req.params.uploadId));}));
  app.get('/finds/:findId/media/:variant',route(false,async(user,req,res)=>{
    const bytes=await deps.service.media(user,String(req.params.findId),String(req.params.variant));
    res.setHeader('Content-Type','image/jpeg');res.setHeader('Content-Disposition','inline');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.send(bytes);
  }));
}
export function registerPrivateImageRoutes(app:Express){
  const db=createSupabaseAdmin((input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(25000),...(init?.signal?[init.signal]:[])])}));
  registerPrivateImageHandlers(app,{authenticate:supabaseUserImportAuthenticator(),service:createPrivateImageService(db),enabled:()=>getEnv('FIND_IMAGE_INGESTION_ENABLED')==='true',
    admit:async owner=>{try{return Number(await getBullmqCommandRedis().eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,`find:image:${owner}`))<=20;}catch{throw new ShareError('image_capacity_unavailable',503);}}
  });
}
