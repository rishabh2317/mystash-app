import { createHmac, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateEvent, type AnalyticsEvent } from './contracts';
import { analyticsEnabled } from './flags';
import type { MeasurementContext } from './context';

/** Ephemeral, bounded buckets. Raw addresses never enter the map or database. */
export class MeasurementRateLimit {
  private buckets=new Map<string,{at:number;count:number}>();
  private salt=randomBytes(32);
  allow(address:string,count:number,now=Date.now()):boolean {
    for(const [key,b] of this.buckets) if(now-b.at>=60000)this.buckets.delete(key);
    const key=createHmac('sha256',this.salt).update(address).digest('hex');
    const old=this.buckets.get(key);
    if(!old && this.buckets.size>=5000)return false;
    if((old?.count??0)+count>600)return false;
    this.buckets.set(key,{at:old?.at??now,count:(old?.count??0)+count});return true;
  }
}
export async function ingestMeasurement(admin: SupabaseClient, userId:string|null, ctx:MeasurementContext,
  events:AnalyticsEvent[],source:'client'|'server'='client',searchResults?:unknown[]) {
  if(!analyticsEnabled())return {accepted:[],disabled:true};
  if(!userId&&!ctx.anonymousConsent)return {accepted:[],consent_rejected:true};
  const validated=events.map(e=>validateEvent(e,source));
  if(validated.some(e=>e.session_id!==ctx.sessionId))throw new Error('session_mismatch');
  const {data,error}=await admin.rpc('analytics_ingest',{p_user_id:userId,p_revision:ctx.revision,
    p_events:validated,p_source:source,p_search_results:searchResults??null});
  if(error)throw new Error('measurement_unavailable');return data;
}
