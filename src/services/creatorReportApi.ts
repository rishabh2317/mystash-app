import type {CreatorRange,CreatorReport} from '@/backend/src/analytics/creatorReport';
import type {CreatorDateRange} from '@/src/ui/creatorDateRange';
import {shiftUtcDay,validateCreatorDateRange} from '@/src/ui/creatorDateRange';
import {EngagementApiError} from './engagementApi';
import {supabase} from './supabase';

export function creatorReportQuery(range:CreatorRange|CreatorDateRange):string{
  if(typeof range==='number')return `days=${range}`;
  const error=validateCreatorDateRange(range);
  if(error)throw new EngagementApiError(error,400);
  return `start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(shiftUtcDay(range.end,1))}`;
}

export async function getCreatorReport(range:CreatorRange|CreatorDateRange,signal:AbortSignal):Promise<CreatorReport>{
  const base=process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/,'');
  if(!base)throw new EngagementApiError('Mystash service is not configured.',500);
  const {data}=await supabase.auth.getSession();
  if(!data.session?.access_token)throw new EngagementApiError('Sign in to view analytics.',401);
  const query=creatorReportQuery(range);
  const res=await fetch(`${base}/analytics/creator?${query}`,{signal,headers:{
    Authorization:`Bearer ${data.session.access_token}`,Accept:'application/json',
  }});
  if(!res.ok){
    const body=await res.json().catch(()=>({}));
    throw new EngagementApiError(body.disabled?'Creator reporting is not enabled yet.':'Analytics unavailable right now.',res.status);
  }
  return res.json();
}
