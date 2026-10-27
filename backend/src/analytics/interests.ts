/** Purpose-limited, deterministic snapshot rules. No model/provider calls or ranking integration. */
import {UUID} from './contracts';
export const INTEREST_CATEGORIES=['sports','fashion','beauty','electronics','home','food','automotive','outdoors','gaming','travel'] as const;
export type InterestKind='product'|'collection'|'creator'|'category';
export type ExplicitSource='saved_product'|'saved_collection'|'followed_creator';
type Reference={kind:Exclude<InterestKind,'category'>;key:string;namespace:'catalog'|'discovered'|null;category:string|null;creator_id:string|null};
export type InterestInput={revision:string;since:string;observed_at:string;policy_version:1;current:(Reference&{sources:ExplicitSource[]})[];
 events:(Reference&{name:'product.opened'|'collection.opened'|'creator.profile_opened'|'merchant.outbound_resolved';occurred_at:string})[]};
export type InterestFeature={kind:InterestKind;key:string;namespace:'catalog'|'discovered'|null;explicit_sources:ExplicitSource[];explicit_score:number;
 inferred_score:number;score:number;evidence_days:number;evidence_entities:number;last_day:string|null;confidence:'explicit'|'supported'|'emerging'};
export type InterestProfile={status:'disabled'|'insufficient'|'stale'|'ready';version?:1;policy_version?:1;built_at?:string;expires_at?:string;source_capped?:boolean;features:InterestFeature[]};
const DAY=86400000;
const WEIGHTS:Record<ExplicitSource,number>={saved_product:6,saved_collection:5,followed_creator:8};
const round=(n:number)=>Math.round(n*1000)/1000;
export function buildInterestFeatures(input:InterestInput):{features:InterestFeature[];capped:boolean}{
 const now=Date.parse(input.observed_at),since=Date.parse(input.since);
 if(input.policy_version!==1||!UUID.test(input.revision)||!Number.isFinite(now)||!Number.isFinite(since)||since>now)throw new Error('Invalid interest source');
 type Acc={kind:InterestKind;key:string;namespace:InterestFeature['namespace'];sources:Set<ExplicitSource>;days:Map<string,number>;entities:Set<string>;derived:number};
 const all=new Map<string,Acc>();
 const ref=(kind:InterestKind,key:string,namespace:InterestFeature['namespace'])=>{
  if(kind==='category'?!INTEREST_CATEGORIES.includes(key as typeof INTEREST_CATEGORIES[number]):!UUID.test(key))throw new Error('Invalid interest reference');
  if(!['product','collection','creator','category'].includes(kind)||(kind==='product'?!['catalog','discovered'].includes(namespace??''):namespace!==null))throw new Error('Invalid interest namespace');
  const id=`${kind}:${namespace??''}:${key}`;let a=all.get(id);if(!a){a={kind,key,namespace,sources:new Set(),days:new Map(),entities:new Set(),derived:0};all.set(id,a);}return a;
 };
 const category=(r:Reference)=>typeof r.category==='string'&&INTEREST_CATEGORIES.includes(r.category as typeof INTEREST_CATEGORIES[number])?r.category:null;
 const currentSeen=new Set<string>();
 for(const r of input.current.slice(0,200)){
  const a=ref(r.kind,r.key,r.namespace),identity=`${r.kind}:${r.namespace??''}:${r.key}`;
  if(currentSeen.has(identity))continue;currentSeen.add(identity);
  for(const s of r.sources){if(!Object.hasOwn(WEIGHTS,s)||(s==='saved_product'&&r.kind!=='product')||(s==='saved_collection'&&r.kind!=='collection')||(s==='followed_creator'&&r.kind!=='creator'))throw new Error('Invalid explicit signal');a.sources.add(s);}
  const cat=r.kind==='product'?category(r):null;
  if(cat){const c=ref('category',cat,null);c.entities.add(identity);c.derived=Math.min(4,c.derived+2);}
  if(r.kind==='collection'&&r.creator_id){const creator=ref('creator',r.creator_id,null);creator.entities.add(identity);creator.derived=Math.min(4,creator.derived+1.5);}
 }
 // One maximum signal per entity per UTC day: repeat taps and open→click funnels do not stack.
 const dayEntity=new Map<string,{ref:Reference;day:string;weight:number}>();
 for(const e of input.events.slice(0,2000)){
  const time=Date.parse(e.occurred_at);
  if(!['product.opened','collection.opened','creator.profile_opened','merchant.outbound_resolved'].includes(e.name))throw new Error('Unsupported interest event');
  if(!Number.isFinite(time)||time<since||time<now-7*DAY||time>now)continue;
  ref(e.kind,e.key,e.namespace);
  if((e.name==='collection.opened'&&e.kind!=='collection')||(e.name==='creator.profile_opened'&&e.kind!=='creator')||(['product.opened','merchant.outbound_resolved'].includes(e.name)&&e.kind!=='product'))throw new Error('Interest event mismatch');
  const day=new Date(time).toISOString().slice(0,10),id=`${e.kind}:${e.namespace??''}:${e.key}:${day}`,weight=e.name==='merchant.outbound_resolved'?3:1;
  const previous=dayEntity.get(id);if(!previous||weight>previous.weight)dayEntity.set(id,{ref:e,day,weight});
 }
 for(const {ref:r,day,weight} of dayEntity.values()){
  const a=ref(r.kind,r.key,r.namespace),identity=`${r.kind}:${r.namespace??''}:${r.key}`;a.days.set(day,weight);a.entities.add(identity);
  const cat=r.kind==='product'?category(r):null;
  if(cat){const c=ref('category',cat,null);c.entities.add(identity);c.days.set(day,Math.min(5,(c.days.get(day)??0)+weight*.35));}
  if(r.kind==='collection'&&r.creator_id){const c=ref('creator',r.creator_id,null);c.entities.add(identity);c.days.set(day,Math.min(3,(c.days.get(day)??0)+weight*.35));}
 }
 const today=Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z');
 const features:InterestFeature[]=[...all.values()].map(a=>{
  const explicit_sources=[...a.sources].sort(),explicit_score=Math.max(0,...explicit_sources.map(s=>WEIGHTS[s]));
  const inferred_score=round(Math.min(12,a.derived+[...a.days].reduce((total,[day,w])=>total+w*Math.pow(.5,(today-Date.parse(day+'T00:00:00Z'))/DAY/3),0)));
  const supported=(a.days.size>=2||(a.kind==='category'||a.kind==='creator')&&a.entities.size>=2)&&inferred_score>=1;
  return {kind:a.kind,key:a.key,namespace:a.namespace,explicit_sources,explicit_score,inferred_score,score:round(Math.min(20,explicit_score+inferred_score)),
   evidence_days:a.days.size,evidence_entities:Math.min(200,a.entities.size),last_day:[...a.days.keys()].sort().at(-1)??null,confidence:explicit_score>0?'explicit' as const:supported?'supported' as const:'emerging' as const};
 }).filter(f=>f.score>0).sort((a,b)=>b.explicit_score-a.explicit_score||b.score-a.score||a.kind.localeCompare(b.kind)||String(a.namespace).localeCompare(String(b.namespace))||a.key.localeCompare(b.key));
 return {features:features.slice(0,50),capped:input.current.length>200||input.events.length>2000||features.length>50};
}
/** Future consumers must still authorize candidate visibility/hides at query time. No caller uses this today. */
export function supportedInterestFeatures(profile:InterestProfile,currentConsent:boolean,now=Date.now()):InterestFeature[]{
 if(!currentConsent||profile.status!=='ready'||profile.version!==1||profile.policy_version!==1||!profile.built_at||!profile.expires_at||
  !Number.isFinite(Date.parse(profile.built_at))||!Number.isFinite(Date.parse(profile.expires_at))||
  Date.parse(profile.built_at)>now+60000||now-Date.parse(profile.built_at)>2*3600000||Date.parse(profile.expires_at)<=now)return [];
 return profile.features.filter(f=>f.score>=1&&['explicit','supported'].includes(f.confidence));
}
