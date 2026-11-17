import {randomUUID} from 'node:crypto';
import type {Request} from 'express';
import type {SupabaseClient} from '@supabase/supabase-js';
import {requestMeasurement} from '../analytics/context';
import {ingestMeasurement} from '../analytics/service';
import {UUID,type AnalyticsEvent} from '../analytics/contracts';
export const crawler=(req:Request)=>/bot|crawler|spider|facebookexternalhit|whatsapp|slackbot|twitterbot|preview/i.test(String(req.headers['user-agent']??''));
export async function recordStashAction(db:SupabaseClient,req:Request,user:string|null,stash:string,name:'stash.item_saved'|'merchant.outbound_resolved',kind:'product'|'place',id:string,namespace?:'catalog'|'discovered',properties:Record<string,unknown>={}){
 const ctx=requestMeasurement(req);if(!ctx||crawler(req))return;
 const supplied=String(req.headers['x-mystash-action-id']??req.headers['x-mystash-outbound-id']);
 const eventId=UUID.test(supplied)?supplied:randomUUID();
 const platform=String(req.headers['x-mystash-platform']);
 const e:AnalyticsEvent={event_id:eventId,event_name:name,schema_version:1,occurred_at:new Date().toISOString(),session_id:ctx.sessionId,
 entity_type:kind,entity_id:id,...(kind==='product'?{namespace:namespace??'catalog'}:{}),surface:'public_stash',platform:['web','ios','android'].includes(platform)?platform as AnalyticsEvent['platform']:'server',app_version:'1.0.0',
 properties:{...properties,public_stash_id:stash}};
 try{await ingestMeasurement(db,user,ctx,[e],'server');}catch{/* Measurement never changes save/shopping results. */}
}
