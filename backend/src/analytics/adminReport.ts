/** Aggregate-only admin contract. Safe to import from the shared native client. */
import type {CreatorRange} from './creatorReport';
export const ADMIN_METRICS=['app_sessions','collection_opens','collection_impressions','product_opens','product_impressions',
 'place_impressions','place_outbound_requests','profile_opens','search_responses','search_zero_matches','search_with_fallback',
 'search_matching_results','search_fallback_results','search_latency_ms','search_clicks','search_click_rank_sum',
 'merchant_requests','affiliate_requests','saves_added','saves_removed','follows_added','follows_removed','likes_added','likes_removed','collection_shares'] as const;
export type AdminMetric=typeof ADMIN_METRICS[number];
export type AdminValues=Record<AdminMetric,number|null>;
export const SNAPSHOT_KEYS=['profiles_current','active_creators_current','profiles_created_in_range','public_collections_current',
 'publications_in_range','publishing_creators_in_range','catalog_products_current','discovered_products_current','place_records_current',
 'bag_memberships_current','place_saves_current','imports_in_range','imports_timed_out_in_range','open_sources_older_15m'] as const;
export const EXTRACTION_KEYS=['ready_with_products','ready_without_products','product_candidates','bound_product_candidates','place_candidates','resolved_places'] as const;
export const HEALTH_UNITS={accepted:'events',duplicates:'events',invalid_or_ineligible:'events',payload_rejected_batches:'batches',rate_limited_events:'events',write_failed_batches:'batches'} as const;
const CATEGORIES=['sports','fashion','beauty','electronics','home','food','automotive','outdoors','gaming','travel','other'];
const FILTERS=['creatorId','brand','category','verifiedOnly','recentlyPublished','popular','priceMin','priceMax'];
const DIMENSIONS=new Set(['all',...['ios','android','web','server'].map(p=>`platform:${p}`),...CATEGORIES.map(c=>`category:${c}`),...FILTERS.map(f=>`filter:${f}`)]);
export type RawAdminReport={
 days:CreatorRange;end_day:string;generated_at:string;refreshed_at:string|null;
 daily:{day:string;metric:AdminMetric;dimension:string;value:number}[];coverage:{day:string;windows:number}[];
 breakdowns:{metric:AdminMetric;dimension:string;value:number}[];
 health:{day:string;metric:keyof typeof HEALTH_UNITS;value:number}[];
 activity:{active_24h:number;active_7d:number;windows_24h:number;windows_7d:number};
 snapshot:Record<typeof SNAPSHOT_KEYS[number],number>;extraction:Record<typeof EXTRACTION_KEYS[number],number>;
 source_statuses:{status:string;value:number}[];ingest_statuses:{status:string;value:number}[];
 reconciliation:{checked_at:string;collection_mismatches:number;user_mismatches:number}|null;
};
export type AdminReport={
 days:CreatorRange;generatedAt:string;refreshedAt:string|null;stale:boolean;provisional:boolean;
 current:{start:string;end:string;coveredDays:number;values:AdminValues};previous:{start:string;end:string;coveredDays:number;values:AdminValues};changes:AdminValues;
 series:{day:string;covered:boolean;values:AdminValues}[];
 search:{zeroMatchPercent:number|null;fallbackPercent:number|null;meanLatencyMs:number|null;meanClickRank:number|null};
 categories:{category:string;values:AdminValues}[];platforms:{platform:string;values:AdminValues}[];filters:{filter:string;responses:number}[];
 health:{metric:keyof typeof HEALTH_UNITS;unit:'events'|'batches';value:number|null}[];
 activity:{active24h:number|null;active7d:number|null;covered24h:boolean;covered7d:boolean};
 snapshot:RawAdminReport['snapshot'];extraction:RawAdminReport['extraction'];sourceStatuses:RawAdminReport['source_statuses'];ingestStatuses:RawAdminReport['ingest_statuses'];
 terminalSourceFailurePercent:number|null;productBindingPercent:number|null;placeResolutionPercent:number|null;
 reconciliation:RawAdminReport['reconciliation'];unavailable:{metric:string;reason:string}[];
};
const DAY=86400000;
const vals=(fn:(key:AdminMetric)=>number|null):AdminValues=>Object.fromEntries(ADMIN_METRICS.map(k=>[k,fn(k)])) as AdminValues;
function count(n:number){if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid aggregate');return n;}
function sum(ns:number[]){return count(ns.reduce((a,b)=>a+count(b),0));}
const rate=(n:number,d:number,multiplier=100)=>d>0?Math.round(n/d*multiplier*10)/10:null;
export function buildAdminReport(raw:RawAdminReport):AdminReport{
 if(![7,30,90].includes(raw.days)||!/^\d{4}-\d{2}-\d{2}$/.test(raw.end_day))throw new Error('Invalid report');
 const end=Date.parse(`${raw.end_day}T00:00:00Z`),generated=Date.parse(raw.generated_at),refreshed=Date.parse(raw.refreshed_at??'');
 if(!Number.isFinite(end)||new Date(end).toISOString().slice(0,10)!==raw.end_day||!Number.isFinite(generated))throw new Error('Invalid report');
 const stale=!Number.isFinite(refreshed)||generated-refreshed>900000||refreshed>generated+60000;
 const coverage=new Map(raw.coverage.map(d=>[d.day,d.windows===288]));
 const data=new Map<string,number>();
 for(const d of raw.daily){if(!ADMIN_METRICS.includes(d.metric)||d.dimension!=='all')throw new Error('Invalid aggregate');data.set(`${d.day}:all:${d.metric}`,count(d.value));}
 const breakdowns=new Map<string,number>();
 for(const d of raw.breakdowns){if(!ADMIN_METRICS.includes(d.metric)||!DIMENSIONS.has(d.dimension)||d.dimension==='all')throw new Error('Invalid aggregate');breakdowns.set(`${d.dimension}:${d.metric}`,count(d.value));}
 const days=Array.from({length:raw.days*2},(_,i)=>new Date(end-(raw.days*2-i)*DAY).toISOString().slice(0,10));
 const seriesFor=(day:string)=>({day,covered:coverage.get(day)===true,values:vals(k=>data.get(`${day}:all:${k}`)??(coverage.get(day)?0:null))});
 const period=(range:string[])=>({start:range[0],end:new Date(Date.parse(`${range.at(-1)}T00:00:00Z`)+DAY).toISOString().slice(0,10),coveredDays:range.filter(d=>coverage.get(d)).length,
  values:vals(k=>{const recorded=range.flatMap(d=>data.has(`${d}:all:${k}`)?[data.get(`${d}:all:${k}`)!]:[]);return range.every(d=>coverage.get(d))||recorded.some(n=>n>0)?sum(recorded):null;})});
 const currentDays=days.slice(raw.days),current=period(currentDays),previous=period(days.slice(0,raw.days));
 const comparable=!stale&&current.coveredDays===raw.days&&previous.coveredDays===raw.days;
 const observed=(dimension:string,key:AdminMetric)=>dimension==='all'?sum(currentDays.map(day=>data.get(`${day}:all:${key}`)??0)):(breakdowns.get(`${dimension}:${key}`)??0);
 const dimensionValues=(d:string)=>vals(k=>{const n=observed(d,k);return n>0||current.coveredDays===raw.days?n:null;});
 const snapshot=Object.fromEntries(SNAPSHOT_KEYS.map(k=>[k,count(raw.snapshot[k])])) as RawAdminReport['snapshot'];
 const extraction=Object.fromEntries(EXTRACTION_KEYS.map(k=>[k,count(raw.extraction[k])])) as RawAdminReport['extraction'];
 const sourceStatuses=raw.source_statuses.map(r=>{if(!['RECEIVED','QUEUED','PROCESSING','READY','FAILED','OTHER'].includes(r.status))throw new Error('Invalid status');return {status:r.status,value:count(r.value)};});
 const ingestStatuses=raw.ingest_statuses.map(r=>{if(!['draft','pending','processing','extracting','ready_for_review','published','failed','rejected','completed','dead_letter','other'].includes(r.status))throw new Error('Invalid status');return {status:r.status,value:count(r.value)};});
 const ready=sum(sourceStatuses.filter(s=>s.status==='READY').map(s=>s.value)),failed=sum(sourceStatuses.filter(s=>s.status==='FAILED').map(s=>s.value));
 const subset=(n:number,d:number)=>{if(n>d)throw new Error('Invalid aggregate denominator');};
 subset(observed('all','search_zero_matches'),observed('all','search_responses'));
 subset(observed('all','search_with_fallback'),observed('all','search_responses'));
 subset(observed('all','affiliate_requests'),observed('all','merchant_requests'));
 subset(extraction.bound_product_candidates,extraction.product_candidates);
 subset(extraction.resolved_places,extraction.place_candidates);
 subset(extraction.ready_with_products+extraction.ready_without_products,ready);
 const health=Object.entries(HEALTH_UNITS).map(([name,unit])=>{
  const metric=name as keyof typeof HEALTH_UNITS,n=sum(raw.health.filter(h=>h.metric===metric&&currentDays.includes(h.day)).map(h=>h.value));
  return {metric,unit,value:n>0||current.coveredDays===raw.days?n:null};
 });
 const active24h=count(raw.activity.active_24h),active7d=count(raw.activity.active_7d);
 subset(active24h,active7d);
 const covered24h=!stale&&raw.activity.windows_24h===288,covered7d=!stale&&raw.activity.windows_7d===2016;
 const reconciliation=raw.reconciliation?{checked_at:raw.reconciliation.checked_at,collection_mismatches:count(raw.reconciliation.collection_mismatches),user_mismatches:count(raw.reconciliation.user_mismatches)}:null;
 return {days:raw.days,generatedAt:raw.generated_at,refreshedAt:raw.refreshed_at,stale,provisional:generated<end+DAY,current,previous,
  series:currentDays.map(seriesFor),changes:vals(k=>{const a=current.values[k],b=previous.values[k];return comparable&&a!==null&&b!==null&&b>0?Math.round((a-b)/b*1000)/10:null;}),
  search:{zeroMatchPercent:rate(observed('all','search_zero_matches'),observed('all','search_responses')),
   fallbackPercent:rate(observed('all','search_with_fallback'),observed('all','search_responses')),
   meanLatencyMs:rate(observed('all','search_latency_ms'),observed('all','search_responses'),1),
   meanClickRank:rate(observed('all','search_click_rank_sum'),observed('all','search_clicks'),1)},
  categories:CATEGORIES.map(category=>({category,values:dimensionValues(`category:${category}`)})).filter(c=>Object.values(c.values).some(n=>n!==null&&n>0)).sort((a,b)=>(b.values.merchant_requests??0)-(a.values.merchant_requests??0)||(b.values.product_opens??0)-(a.values.product_opens??0)||a.category.localeCompare(b.category)),
  platforms:['ios','android','web','server'].map(platform=>({platform,values:dimensionValues(`platform:${platform}`)})),
  filters:FILTERS.map(filter=>({filter,responses:observed(`filter:${filter}`,'search_responses')})).filter(f=>f.responses>0),health,
  activity:{active24h:active24h>0||covered24h?active24h:null,active7d:active7d>0||covered7d?active7d:null,covered24h,covered7d},
  snapshot,extraction,sourceStatuses,ingestStatuses,terminalSourceFailurePercent:rate(failed,ready+failed),
  productBindingPercent:rate(extraction.bound_product_candidates,extraction.product_candidates),placeResolutionPercent:rate(extraction.resolved_places,extraction.place_candidates),reconciliation,
  unavailable:[{metric:'Population DAU / WAU / MAU',reason:'Only separately opted-in account activity is observable; anonymous sessions cannot identify people. No 30-day identity history is retained.'},
   {metric:'Returning-user retention and activation funnels',reason:'No permitted longitudinal cohort or onboarding step instrumentation exists.'},
   {metric:'Purchases / revenue / conversion / matched CTR',reason:'No verified conversion source or matched exposure cohort exists.'},
   {metric:'Extraction accuracy and provider cost',reason:'Candidate binding is not correctness; no labelled ground truth or verified billing feed exists.'}],
 };
}
