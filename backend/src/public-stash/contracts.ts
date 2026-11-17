import { UUID } from '../analytics/contracts';
export type StashItem = { id: string; title: string; namespace?: 'catalog'|'discovered'; image?: string|null; brand?: string|null; category?: string|null; city?: string|null; country?: string|null };
export type StashPage = { schemaVersion:1; publicId:string; curator:{username:string;avatarUrl:string|null};counts:{products:number;places:number};items:StashItem[];nextCursor:string|null;tab:'products'|'places' };
export type Publication = {membershipId:string;itemId:string|null;namespace?:'catalog'|'discovered';published:boolean;version:number};
export type StashSettings = {publicId:string;visibility:'private'|'public';version:number;products:Publication[];places:Publication[]};
export type StashPlace = {viewerSaved?:boolean;id:string;name:string;category:string|null;city:string|null;region:string|null;country:string|null;locality:string|null;formattedAddress:string|null;latitude:number|null;longitude:number|null;mapsUrl:string|null;provider:string};
export class StashError extends Error { constructor(readonly status:number,message:string){super(message);} }
export function uuid(value:unknown):string {if(typeof value!=='string'||!UUID.test(value))throw new StashError(404,'Stash unavailable');return value.toLowerCase();}
export function version(value:unknown):number {if(!Number.isSafeInteger(value)||Number(value)<0)throw new StashError(400,'Invalid version');return Number(value);}
export function itemInput(body:unknown):{kind:'product'|'place';namespace:'catalog'|'discovered'|'place';itemId:string} {
 const b=body as Record<string,unknown>|null;
 if(!b||!['product','place'].includes(String(b.kind))||!['catalog','discovered','place'].includes(String(b.namespace))||(b.kind==='place')!==(b.namespace==='place'))throw new StashError(400,'Invalid item');
 return {kind:b.kind as 'product'|'place',namespace:b.namespace as 'catalog'|'discovered'|'place',itemId:uuid(b.itemId)};
}
export function parsePage(query:Record<string,unknown>,publicId:string){
 const tab=query.tab??'products',limit=query.limit===undefined?20:Number(query.limit);
 if(!['products','places'].includes(String(tab))||!Number.isInteger(limit)||limit<1||limit>50||Array.isArray(query.limit))throw new StashError(400,'Invalid page');
 let time:string|null=null,after:string|null=null;
 if(query.cursor!==undefined){try{if(typeof query.cursor!=='string'||query.cursor.length>600)throw Error();const c=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));if(c.stash!==publicId||c.tab!==tab||!UUID.test(c.id)||typeof c.time!=='string'||!Number.isFinite(Date.parse(c.time)))throw Error();time=c.time;after=c.id;}catch{throw new StashError(400,'Invalid cursor');}}
 return {tab:tab as 'products'|'places',limit,time,after};
}
