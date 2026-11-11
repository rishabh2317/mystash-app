import type {SupabaseClient} from '@supabase/supabase-js';
import type {CountryOfferProduct,CountryOfferCachePort} from './CountryOfferService';
export function createCountryOfferCache(admin:SupabaseClient):CountryOfferCachePort {
  const rpc=async(product:CountryOfferProduct,country:string,evidence:unknown=null,token?:string)=>{
    const {data,error}=await admin.rpc('shopping_country_offer_cache',{
      p_kind:product.kind,p_product:product.id,p_country:country,p_evidence:evidence,p_token:token??null,
    });
    if(error||!data)throw new Error('Country offer cache unavailable');
    return data as {claimed:boolean;token?:string;metadata:Record<string,unknown>};
  };
  return {claim:(product,country)=>rpc(product,country),complete:async(product,country,evidence,token)=>(await rpc(product,country,evidence,token)).metadata};
}
