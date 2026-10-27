/** Shared, dependency-free reporting contract. No audience identifiers leave the service. */
export const CREATOR_METRICS = ['collection_opens','collection_impressions','product_impressions',
  'merchant_requests','profile_opens','saves_added','saves_removed','followers_added','followers_removed',
  'collection_shares','likes_added','likes_removed'] as const;
export type CreatorMetric = typeof CREATOR_METRICS[number];
export type CreatorRange = 7 | 30 | 90;
export type MetricValues = Record<CreatorMetric, number | null>;
export type RankedCollection = {id:string;title:string|null;thumbnail_url:string|null;opens:number|null;saves:number|null;requests:number|null};
export type RankedProduct = {id:string;namespace:'catalog'|'discovered';title:string;thumbnail_url:string|null;impressions:number|null;requests:number|null};
export type RawCreatorReport = {
  days:CreatorRange;end_day:string;generated_at:string;refreshed_at:string|null;
  daily:{day:string;metric:CreatorMetric;value:number}[];
  coverage:{day:string;windows:number}[];
  top_collections:RankedCollection[];top_products:RankedProduct[];
};
export type CreatorPeriod = {start:string;end:string;coveredDays:number;values:MetricValues};
export type CreatorReport = {
  days:CreatorRange;generatedAt:string;refreshedAt:string|null;stale:boolean;provisional:boolean;
  current:CreatorPeriod;previous:CreatorPeriod;changes:MetricValues;
  series:{day:string;covered:boolean;values:MetricValues}[];
  topCollections:RankedCollection[];topProducts:RankedProduct[];
};
const DAY=86400000;
const values=(fn:(key:CreatorMetric)=>number|null):MetricValues=>Object.fromEntries(CREATOR_METRICS.map(k=>[k,fn(k)])) as MetricValues;
export function creatorRange(input:unknown):CreatorRange|null {
  return input===undefined||input==='7'?7:input==='30'?30:input==='90'?90:null;
}
/** UTC dates are half-open calendar intervals, unaffected by device/server daylight saving. */
export function buildCreatorReport(raw:RawCreatorReport):CreatorReport {
  if(![7,30,90].includes(raw.days)||!/^\d{4}-\d{2}-\d{2}$/.test(raw.end_day))throw new Error('Invalid report');
  const end=Date.parse(`${raw.end_day}T00:00:00Z`);
  if(!Number.isFinite(end)||new Date(end).toISOString().slice(0,10)!==raw.end_day)throw new Error('Invalid report');
  const generated=Date.parse(raw.generated_at),refreshed=raw.refreshed_at?Date.parse(raw.refreshed_at):NaN;
  if(!Number.isFinite(generated))throw new Error('Invalid report');
  const stale=!Number.isFinite(refreshed)||generated-refreshed>15*60000||refreshed>generated+60000;
  const coverage=new Map(raw.coverage.map(d=>[d.day,d.windows===288]));
  const amounts=new Map<string,number>();
  for(const row of raw.daily){
    if(!CREATOR_METRICS.includes(row.metric)||!Number.isSafeInteger(row.value)||row.value<0)throw new Error('Invalid report');
    amounts.set(`${row.day}:${row.metric}`,row.value);
  }
  const all=Array.from({length:raw.days*2},(_,i)=>{
    const day=new Date(end-(raw.days*2-i)*DAY).toISOString().slice(0,10),covered=coverage.get(day)===true;
    return {day,covered,values:values(k=>amounts.get(`${day}:${k}`)??(covered?0:null))};
  });
  const period=(rows:typeof all):CreatorPeriod=>({start:rows[0].day,
    end:new Date(Date.parse(`${rows[rows.length-1].day}T00:00:00Z`)+DAY).toISOString().slice(0,10),
    coveredDays:rows.filter(d=>d.covered).length,
    values:values(k=>{
      const recorded=rows.map(d=>d.values[k]).filter((n):n is number=>n!==null);
      return rows.every(d=>d.covered)||recorded.some(n=>n>0)?recorded.reduce((a,b)=>a+b,0):null;
    })});
  const previous=period(all.slice(0,raw.days)),series=all.slice(raw.days),current=period(series);
  const comparable=!stale&&previous.coveredDays===raw.days&&current.coveredDays===raw.days;
  const rankedValue=(n:number|null)=>n!==null&&(n>0||current.coveredDays===raw.days)?n:null;
  return {days:raw.days,generatedAt:raw.generated_at,refreshedAt:raw.refreshed_at,stale,
    provisional:generated<end+DAY,current,previous,series,
    changes:values(k=>{
      const a=current.values[k],b=previous.values[k];
      return comparable&&a!==null&&b!==null&&b>0?Math.round((a-b)/b*1000)/10:null;
    }),topCollections:raw.top_collections.map(c=>({...c,opens:rankedValue(c.opens),saves:rankedValue(c.saves),requests:rankedValue(c.requests)})),
    topProducts:raw.top_products.map(p=>({...p,impressions:rankedValue(p.impressions),requests:rankedValue(p.requests)}))};
}
