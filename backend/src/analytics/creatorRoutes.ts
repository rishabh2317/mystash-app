import type {SupabaseClient} from '@supabase/supabase-js';
import type {Express,Request,Response} from '../auth/requireAuth';
import {requireAuthUserId} from '../auth/requireAuth';
import {buildCreatorReport,creatorRange,type RawCreatorReport} from './creatorReport';

const utcDay=(value:string):number|null=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:null;
};

export const creatorReportingEnabled=()=>process.env.ANALYTICS_CREATOR_REPORTING_ENABLED==='true';
export function registerCreatorReporting(app:Express,admin:SupabaseClient,authenticate:typeof requireAuthUserId=requireAuthUserId) {
  app.get('/analytics/creator',async(req:Request,res:Response)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!creatorReportingEnabled()){res.status(503).json({error:'Creator reporting disabled',disabled:true});return;}
    const userId=await authenticate(req,res);if(!userId)return;
    const keys=Object.keys(req.query),custom=keys.includes('start')||keys.includes('end');
    const start=req.query.start,end=req.query.end;
    const today=new Date().toISOString().slice(0,10);
    const customDays=typeof start==='string'&&typeof end==='string'&&utcDay(start)!==null&&utcDay(end)!==null
      ? (utcDay(end)!-utcDay(start)!)/86400000:null;
    const validCustom=custom&&keys.every(k=>k==='start'||k==='end')&&customDays!==null
      &&customDays>=1&&customDays<=90&&typeof end==='string'&&end<=today;
    const days=custom?null:creatorRange(req.query.days);
    if(custom?!validCustom:days===null||keys.some(k=>k!=='days')){res.status(400).json({error:'Invalid range'});return;}
    try {
      // Verified actor only. No creator ID supplied by the caller, including admins.
      const {data,error}=custom
        ? await admin.rpc('analytics_creator_report_range',{p_creator_id:userId,p_start:start,p_end:end})
        : await admin.rpc('analytics_creator_report',{p_creator_id:userId,p_days:days});
      if(error){res.status(error.code==='42501'?403:503).json({error:'Creator reporting unavailable'});return;}
      res.json(buildCreatorReport(data as RawCreatorReport));
    }catch{res.status(503).json({error:'Creator reporting unavailable'});}
  });
}
