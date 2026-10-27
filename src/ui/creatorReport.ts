export const METRIC_LABELS = {
  collection_opens:'Collection opens',collection_impressions:'Collection impressions',product_impressions:'Product impressions',
  merchant_requests:'Merchant requests',profile_opens:'Profile opens',saves_added:'Saves added',saves_removed:'Saves removed',
  followers_added:'Followers gained',followers_removed:'Followers lost',collection_shares:'Collection shares',
  likes_added:'Likes added',likes_removed:'Likes removed',
} as const;
/** Separate segments preserve unknown days as gaps; single observations remain visible as dots. */
export function trendGeometry(values:(number|null)[],width=320,height=112){
  const max=Math.max(1,...values.filter((n):n is number=>n!==null));
  const points=values.map((value,i)=>value===null?null:{x:8+i*(width-16)/Math.max(1,values.length-1),y:height-8-value/max*(height-16)});
  const paths:string[]=[];let path='';
  for(const point of points){
    if(point)path+=`${path?' L':'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    else if(path){paths.push(path);path='';}
  }
  if(path)paths.push(path);
  return {max,points,paths};
}
export function reportCount(value:number|null):string{return value===null?'—':value.toLocaleString();}
export function utcDateLabel(day:string):string{
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
}
