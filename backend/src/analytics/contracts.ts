export const EVENT_NAMES = [
  'session.started', 'collection.impression', 'collection.opened', 'product.impression', 'product.opened',
  'place.impression', 'place.outbound_requested', 'creator.profile_opened', 'search.results_served', 'search.result_clicked', 'merchant.outbound_resolved',
] as const;
export type EventName = typeof EVENT_NAMES[number];
export type EntityType = 'app' | 'collection' | 'product' | 'place' | 'place_save' | 'creator' | 'search';
export type AnalyticsEvent = {
  event_id: string; event_name: EventName; schema_version: 1; occurred_at: string; session_id: string;
  entity_type: EntityType; entity_id?: string; surface: string;
  platform: 'ios' | 'android' | 'web' | 'server'; app_version: string;
  namespace?: 'catalog' | 'discovered' | 'auto';
  collection_id?: string; properties: Record<string, unknown>;
};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const surfaces = new Set(['app','watch','collection','product','search','stash','creator','other']);
const ids = ['event_id','session_id','entity_id','collection_id'] as const;
const propertyKeys: Record<EventName, readonly string[]> = {
  'session.started': [], 'collection.impression': [], 'collection.opened': [],
  'product.impression': [], 'product.opened': [], 'place.impression': [],
  'place.outbound_requested': ['destination_kind'], 'creator.profile_opened': [],
  'search.results_served': ['matching_count','fallback_count','latency_ms','query_length_bucket','filter_keys','retrieval_mode'],
  'search.result_clicked': ['request_id','result_type','rank'],
  'merchant.outbound_resolved': ['destination_kind','affiliate','request_id'],
};
const entityFor: Record<EventName, readonly EntityType[]> = {
  'session.started':['app'], 'collection.impression':['collection'],'collection.opened':['collection'],
  'product.impression':['product'],'product.opened':['product'],'place.impression':['place','place_save'],
  'place.outbound_requested':['place','place_save'],'creator.profile_opened':['creator'],
  'search.results_served':['search'],'search.result_clicked':['collection','product','creator'],
  'merchant.outbound_resolved':['product'],
};
export function validateEvent(raw: unknown, source: 'client' | 'server', now = Date.now()): AnalyticsEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_event');
  const e = raw as AnalyticsEvent;
  const allowed = new Set(['event_id','event_name','schema_version','occurred_at','session_id','entity_type','entity_id','surface','platform','app_version','namespace','collection_id','properties']);
  if (Object.keys(raw).some(k=>!allowed.has(k)) || !(EVENT_NAMES as readonly unknown[]).includes(e.event_name) ||
    e.schema_version !== 1 || !['ios','android','web','server'].includes(e.platform) ||
    !/^\d{1,3}\.\d{1,3}\.\d{1,6}$/.test(e.app_version) || !surfaces.has(e.surface) || !entityFor[e.event_name].includes(e.entity_type)) throw new Error('invalid_event');
  for (const key of ids) if ((key==='event_id'||key==='session_id'||e[key]!==undefined) && !UUID.test(e[key]??'')) throw new Error('invalid_identifier');
  if (e.entity_type!=='app' && !e.entity_id) throw new Error('entity_required');
  if(typeof e.occurred_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.occurred_at))throw new Error('invalid_time');
  if(e.namespace!==undefined&&e.entity_type!=='product')throw new Error('invalid_namespace');
  if(e.collection_id!==undefined&&!['product','collection'].includes(e.entity_type))throw new Error('invalid_context');
  if(e.entity_type==='app'&&e.entity_id!==undefined)throw new Error('unnecessary_identifier');
  const time = Date.parse(e.occurred_at);
  if (!Number.isFinite(time) || time<now-86400000 || time>now+300000) throw new Error('event_time_out_of_range');
  if (!e.properties || typeof e.properties!=='object' || Array.isArray(e.properties) ||
    Object.keys(e.properties).some(k=>!propertyKeys[e.event_name].includes(k))) throw new Error('invalid_properties');
  if (source==='client' && ['search.results_served','merchant.outbound_resolved'].includes(e.event_name)) throw new Error('server_event_only');
  if (e.entity_type==='product' && !['catalog','discovered','auto'].includes(e.namespace??'')) throw new Error('product_namespace_required');
  const p=e.properties;
  const integer=(key:string,max:number)=>Number.isSafeInteger(p[key])&&Number(p[key])>=0&&Number(p[key])<=max;
  if (e.event_name==='place.outbound_requested' && p.destination_kind!=='search') throw new Error('invalid_destination');
  if (e.event_name==='search.result_clicked' && (!UUID.test(String(p.request_id))||!integer('rank',1000)||
    (!['collection','creator','product'].includes(String(p.result_type))||p.result_type!==e.entity_type))) throw new Error('invalid_search_click');
  if (e.event_name==='search.results_served' && (!integer('matching_count',1000)||!integer('fallback_count',1000)||
    !integer('latency_ms',120000)||!['1-10','11-30','31+'].includes(String(p.query_length_bucket))||
    !['hybrid','lexical_only','semantic_only'].includes(String(p.retrieval_mode))||!Array.isArray(p.filter_keys)||
    p.filter_keys.length>10||p.filter_keys.some(k=>!['creatorId','brand','category','verifiedOnly','recentlyPublished','popular','priceMin','priceMax'].includes(String(k))))) throw new Error('invalid_search_summary');
  if (e.event_name==='merchant.outbound_resolved' && (!UUID.test(String(p.request_id))||typeof p.affiliate!=='boolean'||
    !['affiliate','preferred','merchant','listing'].includes(String(p.destination_kind)))) throw new Error('invalid_destination');
  return e;
}
