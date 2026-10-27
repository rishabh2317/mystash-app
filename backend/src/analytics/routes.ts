import { setInterval } from 'node:timers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MeasurementDiagnostics } from './diagnostics';
import type { Express,Request,Response } from '../auth/requireAuth';
import { optionalVerifiedUserId, requireAuthUserId } from '../auth/requireAuth';
import { createSupabaseAdmin } from '../supabase';
import { analyticsEnabled } from './flags';
import { requestMeasurement } from './context';
import { ingestMeasurement, MeasurementRateLimit } from './service';
import { validateEvent,UUID } from './contracts';
import { registerCreatorReporting } from './creatorRoutes';
import { registerAdminReporting } from './adminRoutes';
import { registerInterestRoutes } from './interestRoutes';

export function registerAnalyticsRoutes(app:Express,admin:SupabaseClient=createSupabaseAdmin(),authenticate:typeof requireAuthUserId=requireAuthUserId) {
  const limiter=new MeasurementRateLimit(), diagnostics=new MeasurementDiagnostics();
  registerCreatorReporting(app,admin);
  registerAdminReporting(app,admin);
  registerInterestRoutes(app,admin);
  if(analyticsEnabled()){const timer=setInterval(()=>void diagnostics.flush(admin),60000);timer.unref();}
  app.get('/analytics/config',(_req:Request,res:Response)=>res.json({enabled:analyticsEnabled(),policy_version:1}));
  app.get('/analytics/preferences',async(req:Request,res:Response)=>{
    res.setHeader('Cache-Control','private, no-store');
    const userId=await authenticate(req,res);if(!userId)return;
    const {data,error}=await admin.from('analytics_preferences').select('measurement_enabled,activity_enabled,revision,policy_version')
      .eq('user_id',userId).maybeSingle();
    if(error){res.status(503).json({error:'Measurement preferences unavailable'});return;}
    res.json({enabled:analyticsEnabled(),preferences:data??{measurement_enabled:false,activity_enabled:false,revision:null,policy_version:1}});
  });
  app.put('/analytics/preferences',async(req:Request,res:Response)=>{
    const userId=await authenticate(req,res);if(!userId)return;
    res.setHeader('Cache-Control','private, no-store');
    const b=req.body;
    if(!b||typeof b.measurement_enabled!=='boolean'||typeof b.activity_enabled!=='boolean'||
      Object.keys(b).some(k=>!['measurement_enabled','activity_enabled','expected_revision','decrease_only'].includes(k))||b.activity_enabled&&!b.measurement_enabled||
      (b.expected_revision!==undefined&&b.expected_revision!==null&&(typeof b.expected_revision!=='string'||!UUID.test(b.expected_revision)))||
      (b.decrease_only!==undefined&&typeof b.decrease_only!=='boolean')){
      res.status(400).json({error:'Invalid preferences'});return;
    }
    // Withdrawal remains available during an emergency collection shutdown.
    const {data,error}=await admin.rpc('analytics_set_preferences',{p_user_id:userId,p_measurement:b.measurement_enabled,p_activity:b.activity_enabled,p_expected_revision:b.expected_revision??null,p_allow_increase:analyticsEnabled(),p_decrease_only:b.decrease_only===true});
    if(error){res.status(error.code==='40001'?409:503).json({error:'Refresh privacy settings and try again'});return;}
    res.json({enabled:analyticsEnabled(),preferences:data});
  });
  app.post('/analytics/batch',async(req:Request,res:Response)=>{
    if(!analyticsEnabled()){res.status(503).json({disabled:true});return;}
    if(Buffer.byteLength(JSON.stringify(req.body??{}),'utf8')>65536){diagnostics.add('payload_rejected_batches');res.status(413).json({error:'Batch too large'});return;}
    const events=req.body?.events,ctx=requestMeasurement(req);
    if(!ctx||!Array.isArray(events)||events.length<1||events.length>50||Object.keys(req.body).some(k=>k!=='events')){diagnostics.add('payload_rejected_batches');res.status(400).json({error:'Invalid batch'});return;}
    if(!limiter.allow(req.socket.remoteAddress??'unknown',events.length)){diagnostics.add('rate_limited_events',events.length);res.status(429).json({error:'Rate limited'});return;}
    const userId=await optionalVerifiedUserId(req);
    if(req.headers.authorization&&!userId){res.status(401).json({error:'Verified session required'});return;}
    try { events.forEach(e=>validateEvent(e,'client'));
      res.json(await ingestMeasurement(admin,userId,ctx,events));
    } catch(error) {
      const unavailable=(error as Error).message==='measurement_unavailable';
      diagnostics.add(unavailable?'write_failed_batches':'payload_rejected_batches');
      res.status(unavailable?503:400).json({error:unavailable?'Measurement unavailable':'Invalid events'});
    }
  });
}
