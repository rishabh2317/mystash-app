import type {SupabaseClient} from '@supabase/supabase-js';
import {publicImageUrl} from './publicMedia';
import {StashError,parsePage,type StashPage,type StashSettings,type StashPlace} from './contracts';
export class PublicStashService {
 constructor(readonly db:SupabaseClient){}
 async rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{const {data,error}=await this.db.rpc(name,args).abortSignal(AbortSignal.timeout(15000));if(error)throw new StashError(error.code==='P0002'?404:error.code==='40001'?409:error.code==='23514'||error.code==='22023'?400:503,error.code==='40001'?'Refresh publication state':'Stash unavailable');return data as T;}
 settings(user:string){return this.rpc<StashSettings>('public_stash_settings',{p_user:user});}
 async page(publicId:string,query:Record<string,unknown>,preview:string|null=null):Promise<StashPage>{
  const p=parsePage(query,publicId);
  const data=await this.rpc<Omit<StashPage,'schemaVersion'|'nextCursor'|'tab'|'items'> & {items:(StashPage['items'][number]&{cursor_time:string;cursor_id:string})[]}>('public_stash_read',{p_public:publicId,p_tab:p.tab,p_limit:p.limit+1,p_time:p.time,p_after:p.after,p_preview:preview});
  const rows=data.items.slice(0,p.limit),last=rows[rows.length-1];
  return {schemaVersion:1,publicId,curator:{username:data.curator.username,avatarUrl:publicImageUrl(data.curator.avatarUrl)},counts:data.counts,tab:p.tab,
   items:rows.map(row=>({id:row.id,title:row.title,...(row.namespace?{namespace:row.namespace,image:publicImageUrl(row.image),brand:row.brand??null}:{category:row.category??null,city:row.city??null,country:row.country??null})})),
   nextCursor:data.items.length>p.limit&&last?Buffer.from(JSON.stringify({stash:publicId,tab:p.tab,id:last.cursor_id,time:last.cursor_time})).toString('base64url'):null};
 }
 item(publicId:string,kind:'product'|'place',namespace:string,id:string,preview:string|null=null){return this.rpc<StashPlace & {providerPlaceId:string}>('public_stash_item',{p_public:publicId,p_kind:kind,p_namespace:namespace,p_item:id,p_preview:preview});}
}
