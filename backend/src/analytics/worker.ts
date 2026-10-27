import {setInterval,clearInterval} from 'node:timers';
import type {SupabaseClient} from '@supabase/supabase-js';
import {logger} from '../logger';
import {analyticsEnabled} from './flags';
import {interestWorkerEnabled,runInterestProfiles} from './interestService';
import {analyticsRpc,ANALYTICS_RPC_TIMEOUT_MS} from './rpc';
const maintenanceEnabled=()=>process.env.ANALYTICS_MAINTENANCE_ENABLED==='true';
export const creatorRollupsEnabled=()=>process.env.ANALYTICS_ROLLUPS_ENABLED==='true';
export const adminRollupsEnabled=()=>process.env.ANALYTICS_ADMIN_ROLLUPS_ENABLED==='true';
export async function runAdminRollup(admin:SupabaseClient,timeoutMs=ANALYTICS_RPC_TIMEOUT_MS){
 if(!adminRollupsEnabled())return;
 const {error}=await analyticsRpc(admin,'analytics_rollup_admin',{p_measurement_enabled:analyticsEnabled()},timeoutMs);
 if(error)throw new Error('Admin rollup unavailable');
}
export async function runCreatorRollup(admin:SupabaseClient,timeoutMs=ANALYTICS_RPC_TIMEOUT_MS){
 if(!creatorRollupsEnabled())return;
 const {error}=await analyticsRpc(admin,'analytics_rollup_creators',{p_measurement_enabled:analyticsEnabled()},timeoutMs);
 if(error)throw new Error('Creator rollup unavailable');
}
export function startAnalyticsMaintenance(admin:SupabaseClient,options:{rpcTimeoutMs?:number;tickMs?:number;maintenanceTickMs?:number;maintenanceIntervalMs?:number}={}){
 const timeout=options.rpcTimeoutMs??ANALYTICS_RPC_TIMEOUT_MS;
 let aggregateBusy=false,maintenanceBusy=false,lastMaintenance=0,closed=false;
 const aggregate=async()=>{if(closed||aggregateBusy)return;aggregateBusy=true;
  try{
   try{await runCreatorRollup(admin,timeout);}catch{logger.warn('analytics.creator_rollup_failed');}
   try{await runAdminRollup(admin,timeout);}catch{logger.warn('analytics.admin_rollup_failed');}
   try{await runInterestProfiles(admin,timeout);}catch{logger.warn('analytics.interest_refresh_failed');}
  }finally{aggregateBusy=false;}
 };
 const maintain=async()=>{if(closed||!maintenanceEnabled()||maintenanceBusy||Date.now()-lastMaintenance<(options.maintenanceIntervalMs??3600000))return;
  maintenanceBusy=true;try{const {error}=await analyticsRpc(admin,'analytics_maintenance',undefined,timeout);
   if(error)logger.warn({code:error.code},'analytics.maintenance_failed');else lastMaintenance=Date.now();
  }catch{logger.warn('analytics.maintenance_failed');}finally{maintenanceBusy=false;}
 };
 if(!maintenanceEnabled()&&!creatorRollupsEnabled()&&!adminRollupsEnabled()&&!interestWorkerEnabled())return {close(){}};
 // Privacy expiry has its own loop and must never wait for aggregation/profile work.
 void aggregate();void maintain();
 const timer=setInterval(()=>void aggregate(),options.tickMs??300000);
 const maintenanceTimer=setInterval(()=>void maintain(),options.maintenanceTickMs??60000);
 timer.unref();maintenanceTimer.unref();
 return {close(){closed=true;clearInterval(timer);clearInterval(maintenanceTimer);}};
}
