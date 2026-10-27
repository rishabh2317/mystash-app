import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response} from '../auth/requireAuth';
import {requireAuthUserId} from '../auth/requireAuth';
import {UUID} from './contracts';
import {MeasurementRateLimit} from './service';
import {personalizationEnabled,refreshInterestProfile} from './interestService';
export function registerInterestRoutes(app:Express,admin:SupabaseClient,authenticate:typeof requireAuthUserId=requireAuthUserId){
 const limiter=new MeasurementRateLimit();
 const self=async(req:Request,res:Response)=>{res.setHeader('Cache-Control','private, no-store');return authenticate(req,res);};
 app.get('/analytics/personalization',async(req:Request,res:Response)=>{
  const id=await self(req,res);if(!id)return;
  if(Object.keys(req.query).length){res.status(400).json({error:'Invalid request'});return;}
  try{const {data,error}=await admin.rpc('analytics_personalization_settings',{p_user_id:id});if(error)throw new Error();res.json({available:personalizationEnabled(),preferences:data});}
  catch{res.status(503).json({error:'Privacy settings unavailable'});}
 });
 app.put('/analytics/personalization',async(req:Request,res:Response)=>{
  const id=await self(req,res);if(!id)return;const b=req.body;
  if(!b||typeof b.enabled!=='boolean'||Object.keys(req.query).length||Object.keys(b).some(k=>!['enabled','policy_version','expected_revision','measurement_revision'].includes(k))||
   (!b.enabled&&Object.keys(b).some(k=>k!=='enabled'))||
   b.enabled&&(b.policy_version!==1||!UUID.test(b.expected_revision??'')||!UUID.test(b.measurement_revision??''))){res.status(400).json({error:'Invalid preference'});return;}
  if(b.enabled&&!personalizationEnabled()){res.status(503).json({disabled:true,error:'Personalization disabled'});return;}
  try{const {data,error}=await admin.rpc('analytics_set_personalization',{p_user_id:id,p_enabled:b.enabled,p_expected_revision:b.enabled?b.expected_revision:null,p_measurement_revision:b.enabled?b.measurement_revision:null,p_policy:1});
   if(error){res.status(error.code==='40001'?409:503).json({error:'Refresh privacy settings and try again'});return;}res.json({preferences:data});
  }catch{res.status(503).json({error:'Could not update privacy settings'});}
 });
 app.delete('/analytics/interests',async(req:Request,res:Response)=>{
  const id=await self(req,res);if(!id)return;
  if(Object.keys(req.query).length||req.body&&Object.keys(req.body).length){res.status(400).json({error:'Invalid request'});return;}
  try{const {error}=await admin.rpc('analytics_reset_interests',{p_user_id:id});if(error)throw new Error();res.json({reset:true});}
  catch{res.status(503).json({error:'Could not reset interests'});}
 });
 app.get('/analytics/interests',async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','private, no-store');if(!personalizationEnabled()){res.status(503).json({disabled:true});return;}
  const id=await authenticate(req,res);if(!id)return;
  if(Object.keys(req.query).length){res.status(400).json({error:'Invalid request'});return;}
  if(!limiter.allow(id,100)){res.setHeader('Retry-After','60');res.status(429).json({error:'Refresh rate limited'});return;}
  try{await refreshInterestProfile(admin,id);const {data,error}=await admin.rpc('analytics_interest_read',{p_user_id:id});if(error)throw new Error();res.json(data);}
  catch{res.status(503).json({error:'Interest profile unavailable'});}
 });
}
