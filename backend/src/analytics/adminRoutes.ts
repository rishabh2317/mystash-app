import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response} from '../auth/requireAuth';
import {requireAuthUserId} from '../auth/requireAuth';
import {creatorRange} from './creatorReport';
import {buildAdminReport,type RawAdminReport} from './adminReport';
import {MeasurementRateLimit} from './service';
export const adminReportingEnabled=()=>process.env.ANALYTICS_ADMIN_REPORTING_ENABLED==='true';
export function registerAdminReporting(app:Express,admin:SupabaseClient,authenticate:typeof requireAuthUserId=requireAuthUserId){
 const limiter=new MeasurementRateLimit();
 app.get('/analytics/admin',async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(!adminReportingEnabled()){res.status(503).json({disabled:true,error:'Admin reporting disabled'});return;}
  const userId=await authenticate(req,res);if(!userId)return;
  const days=creatorRange(req.query.days);
  if(days===null||Object.keys(req.query).some(k=>k!=='days')){res.status(400).json({error:'Invalid range'});return;}
  try{
   const permission=await admin.rpc('analytics_admin_authorized',{p_user_id:userId});
   if(permission.error){res.status(503).json({error:'Admin reporting unavailable'});return;}
   if(permission.data!==true){res.status(403).json({error:'Admin access required'});return;}
   // Twelve reports/minute per verified admin per process; keys are ephemeral HMACs.
   if(!limiter.allow(userId,50)){res.setHeader('Retry-After','60');res.status(429).json({error:'Report rate limit reached'});return;}
   const {data,error}=await admin.rpc('analytics_admin_report',{p_admin_id:userId,p_days:days});
   if(error){res.status(error.code==='42501'?403:503).json({error:'Admin reporting unavailable'});return;}
   res.json(buildAdminReport(data as RawAdminReport));
  }catch{res.status(503).json({error:'Admin reporting unavailable'});}
 });
}
