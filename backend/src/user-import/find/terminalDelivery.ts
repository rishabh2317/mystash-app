import type {SupabaseClient} from '@supabase/supabase-js';
import {analyticsEnabled} from '../../analytics/flags';
import {notificationProducersEnabled} from '../../notifications/producers';
export const findNotificationsEnabled=()=>process.env.FIND_NOTIFICATIONS_ENABLED==='true'&&notificationProducersEnabled();
export const findMeasurementEnabled=()=>process.env.FIND_MEASUREMENT_ENABLED==='true'&&analyticsEnabled();
/** Existing consumer owns this bounded handoff. SQL commits outbox and receipt markers together. */
export async function reconcileFindDelivery(db:SupabaseClient){
  const {data,error}=await db.rpc('find_reconcile_delivery',{p_notifications:findNotificationsEnabled(),p_measurement:findMeasurementEnabled(),p_limit:25})
    .abortSignal(AbortSignal.timeout(25000));
  if(error)throw new Error('Find delivery deferred');return data;
}
