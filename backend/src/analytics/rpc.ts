import {setTimeout,clearTimeout} from 'node:timers';
import type {SupabaseClient} from '@supabase/supabase-js';
export const ANALYTICS_RPC_TIMEOUT_MS=25000;
/** Abort the actual HTTP request, and bound scheduling even if a transport ignores abort.
 * Server statement/lock deadlines are independently configured on the scoped RPCs. */
export async function analyticsRpc(admin:SupabaseClient,name:string,args?:Record<string,unknown>,timeoutMs=ANALYTICS_RPC_TIMEOUT_MS){
 const controller=new AbortController();const operation=admin.rpc(name,args);
 const cancellable=typeof operation.abortSignal==='function'?operation.abortSignal(controller.signal):operation;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve(cancellable),new Promise<never>((_resolve,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(new Error('Analytics RPC deadline exceeded'));},timeoutMs);
 })]);}finally{if(timer)clearTimeout(timer);}
}
