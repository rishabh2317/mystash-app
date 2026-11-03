import type { SupabaseClient } from '@supabase/supabase-js';
export type ImageAttribution = {findId:string|null;originalAvailable:boolean;label:string};
export async function imageAttributions(db:SupabaseClient,owner:string,sourceIds:string[]):Promise<Map<string,ImageAttribution>>{
  const result=new Map<string,ImageAttribution>(),unique=[...new Set(sourceIds)];
  for(let offset=0;offset<unique.length;offset+=100){
    const {data,error}=await db.rpc('find_image_attributions',{p_user:owner,p_sources:unique.slice(offset,offset+100)}).abortSignal(AbortSignal.timeout(15000));
    if(error||!Array.isArray(data))throw new Error('Image attribution unavailable');
    for(const row of data)result.set(row.sourceId,{findId:row.findId,originalAvailable:row.originalAvailable===true,label:row.label});
  }
  return result;
}
