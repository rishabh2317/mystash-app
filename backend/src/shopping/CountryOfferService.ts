import {storedMerchantIdentity} from './storedMerchantIdentity';
import {performance} from 'node:perf_hooks';
import {logger} from '../logger';
import {resolveCountryCode} from '../merchant-pricing/country';
import {pdpSearchHintsAls} from '../product-intelligence/search/pdpSearchHints';
import {qualifyMerchantEvidenceSet,type MerchantEvidenceInput} from '../product-intelligence/verification/merchantEvidence';
import {listStoredShoppingDestinations,isUnavailableAvailability,type StoredShoppingSource} from './storedDestinations';
import {countrySuitability} from './countrySuitability';

export type CountryOfferProduct = {id:string;name:string;brand:string|null;model?:string|null;category:string|null;metadata:Record<string,unknown>;source:StoredShoppingSource;kind:'catalog'|'discovered'};
export type CountryOfferCachePort={
  claim(product:CountryOfferProduct,country:string):Promise<{claimed:boolean;token?:string;metadata:Record<string,unknown>}>;
  complete(product:CountryOfferProduct,country:string,evidence:MerchantEvidenceInput[],token?:string):Promise<Record<string,unknown>>;
};
export function countryOfferRefreshPending(metadata:Record<string,unknown>,country:string):boolean {
  const cache=metadata.shopping_country_offers as Record<string,{leaseUntil?:number}>|undefined;
  return typeof cache?.[country]?.leaseUntil==='number' && cache[country].leaseUntil!>Date.now();
}
export class CountryOfferService {
  private readonly pending=new Map<string,Promise<Record<string,unknown>>>();
  constructor(private readonly cache:CountryOfferCachePort,private readonly discover:(query:string,country:string)=>Promise<MerchantEvidenceInput[]>,private readonly waitBudgetMs=1000){ }
  isPending(kind:string,id:string,country:string):boolean {return this.pending.has(`${kind}:${id}:${country}`);}
  private async budget(work:Promise<Record<string,unknown>>,fallback:Record<string,unknown>) {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([work,new Promise<Record<string,unknown>>(resolve=>{timer=setTimeout(()=>resolve(fallback),this.waitBudgetMs);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
  async resolve(product:CountryOfferProduct,inputCountry?:string|null):Promise<Record<string,unknown>> {
    const country=resolveCountryCode({explicit:inputCountry});
    const offers=listStoredShoppingDestinations(product.source);
    if(offers.some(o=>!isUnavailableAvailability(o.availability)&&countrySuitability(o.url,country,o.countryAvailability,o.regionalUrls)===0))return product.metadata;
    const key=`${product.kind}:${product.id}:${country}`;
    const existing=this.pending.get(key);if(existing)return this.budget(existing,product.metadata);
    const work=this.refresh(product,country).finally(()=>this.pending.delete(key));this.pending.set(key,work);return this.budget(work,product.metadata);
  }
  private async refresh(product:CountryOfferProduct,country:string):Promise<Record<string,unknown>> {
    const started=performance.now();let discoveryCalls=0;
    try{
      // Shared durable negative cache + lease prevents repeated misses and multi-worker stampedes.
      const claim=await this.cache.claim(product,country);if(!claim.claimed)return claim.metadata;
      const expected=storedMerchantIdentity(product);
      discoveryCalls++;
      const found=await pdpSearchHintsAls.run(expected,()=>this.discover([product.brand,product.name,product.model].filter(Boolean).join(' '),country));
      const qualified=qualifyMerchantEvidenceSet(expected,found,{requirePage:product.metadata.merchant_requires_page_evidence===true}).filter(e=>e.usable);
      return await this.cache.complete(product,country,qualified.slice(0,30),claim.token);
    }catch{
      // No new offers are exposed until durably saved, so every offerId remains redirectable.
      return product.metadata;
    }finally{
      logger.info({event:'shopping.country_refresh',country,discoveryPasses:discoveryCalls,aiCalls:0,tavilyCalls:0,durationMs:Math.round(performance.now()-started)},'shopping.country_refresh');
    }
  }
}
