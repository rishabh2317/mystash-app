import type {AdminReport} from '@/backend/src/analytics/adminReport';
import type {CreatorRange} from '@/backend/src/analytics/creatorReport';
import {EngagementApiError} from './engagementApi';
import {supabase} from './supabase';
export async function getAdminReport(days:CreatorRange,signal:AbortSignal,expectedUserId:string):Promise<AdminReport>{
 const base=process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/,'');
 if(!base)throw new EngagementApiError('Mystash service is not configured.',500);
 const {data}=await supabase.auth.getSession();
 if(!data.session?.access_token||data.session.user.id!==expectedUserId)throw new EngagementApiError('Sign in again to view admin analytics.',401);
 const res=await fetch(`${base}/analytics/admin?days=${days}`,{signal,headers:{Authorization:`Bearer ${data.session.access_token}`,Accept:'application/json'}});
 if(!res.ok){const body=await res.json().catch(()=>({}));throw new EngagementApiError(
  body.disabled?'Admin reporting is not enabled yet.':res.status===403?'Admin access is required.':res.status===429?'Too many refreshes. Please wait a minute.':'Admin reporting unavailable right now.',res.status);
 }
 return res.json();
}
