import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response} from '../auth/requireAuth';
import {requireAuthUserId} from '../auth/requireAuth';
import {buildCreatorReport,creatorRange,type RawCreatorReport} from './creatorReport';

export const creatorReportingEnabled=()=>process.env.ANALYTICS_CREATOR_REPORTING_ENABLED==='true';
export function registerCreatorReporting(app:Express,admin:SupabaseClient,authenticate:typeof requireAuthUserId=requireAuthUserId) {
  app.get('/analytics/creator',async(req:Request,res:Response)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!creatorReportingEnabled()){res.status(503).json({error:'Creator reporting disabled',disabled:true});return;}
    const userId=await authenticate(req,res);if(!userId)return;
    const days=creatorRange(req.query.days);
    if(days===null||Object.keys(req.query).some(k=>k!=='days')){res.status(400).json({error:'Invalid range'});return;}
    try {
      // Verified actor only. No creator ID supplied by the caller, including admins.
      const {data,error}=await admin.rpc('analytics_creator_report',{p_creator_id:userId,p_days:days});
      if(error){res.status(error.code==='42501'?403:503).json({error:'Creator reporting unavailable'});return;}
      res.json(buildCreatorReport(data as RawCreatorReport));
    }catch{res.status(503).json({error:'Creator reporting unavailable'});}
  });
}
