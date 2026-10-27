import type {CreatorRange,CreatorReport} from '@/backend/src/analytics/creatorReport';
import {EngagementApiError} from './engagementApi';
import {supabase} from './supabase';

export async function getCreatorReport(days:CreatorRange,signal:AbortSignal):Promise<CreatorReport>{
  const base=process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/,'');
  if(!base)throw new EngagementApiError('Mystash service is not configured.',500);
  const {data}=await supabase.auth.getSession();
  if(!data.session?.access_token)throw new EngagementApiError('Sign in to view analytics.',401);
  const res=await fetch(`${base}/analytics/creator?days=${days}`,{signal,headers:{
    Authorization:`Bearer ${data.session.access_token}`,Accept:'application/json',
  }});
  if(!res.ok){
    const body=await res.json().catch(()=>({}));
    throw new EngagementApiError(body.disabled?'Creator reporting is not enabled yet.':'Analytics unavailable right now.',res.status);
  }
  return res.json();
}
