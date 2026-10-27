import type {SupabaseClient} from '@supabase/supabase-js';
import {analyticsEnabled} from './flags';
import {UUID} from './contracts';
import {analyticsRpc,ANALYTICS_RPC_TIMEOUT_MS} from './rpc';
import {buildInterestFeatures,type InterestInput} from './interests';
export const personalizationEnabled=()=>analyticsEnabled()&&process.env.ANALYTICS_PERSONALIZATION_ENABLED==='true';
export const interestWorkerEnabled=()=>personalizationEnabled()&&process.env.ANALYTICS_INTEREST_WORKER_ENABLED==='true';
export async function refreshInterestProfile(admin:SupabaseClient,userId:string,timeoutMs=ANALYTICS_RPC_TIMEOUT_MS):Promise<boolean>{
 if(!personalizationEnabled())return false;
 const {data,error}=await analyticsRpc(admin,'analytics_interest_source',{p_user_id:userId},timeoutMs);
 if(error)throw new Error('Interest source unavailable');if(!data)return false;
 const source=data as InterestInput,profile=buildInterestFeatures(source);
 const stored=await analyticsRpc(admin,'analytics_interest_store',{p_user_id:userId,p_revision:source.revision,p_features:profile.features,p_capped:profile.capped,p_observed_at:source.observed_at},timeoutMs);
 if(stored.error)throw new Error('Interest profile unavailable');return stored.data===true;
}
export async function runInterestProfiles(admin:SupabaseClient,timeoutMs=ANALYTICS_RPC_TIMEOUT_MS){
 if(!interestWorkerEnabled())return;
 const {data,error}=await analyticsRpc(admin,'analytics_interest_claim',{p_limit:100},timeoutMs);
 if(error||!Array.isArray(data)||data.length>100||data.some(id=>typeof id!=='string'||!UUID.test(id)))throw new Error('Interest batch unavailable');
 // At most four accounts in flight; never log account IDs, sources or feature payloads.
 let next=0,failures=0;
 await Promise.all(Array.from({length:Math.min(4,data.length)},async()=>{while(next<data.length){const id=data[next++];try{await refreshInterestProfile(admin,id,timeoutMs);}catch{failures++;}}}));
 if(failures)throw new Error('Interest batch incomplete');
}
