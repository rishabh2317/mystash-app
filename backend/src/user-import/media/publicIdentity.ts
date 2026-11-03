import type { DiscoveredProductDraft } from '../../product-intelligence/domain/types';
import { ProductNormalizer } from '../../product-intelligence/normalizer/ProductNormalizer';
import { discoveredProductIdentityKey } from '../../product-intelligence/discovered/identity';
import { isQualifyingMerchantSeedUrl } from '../../product-intelligence/search/directUrlIdentity';
/** Shared identities receive independently acquired merchant facts, never image hints/evidence. */
export function publicMerchantIdentity(input: DiscoveredProductDraft): DiscoveredProductDraft | null {
  const provenance=input.metadata?.field_provenance as Record<string,{source?:string;value?:unknown}> | undefined;
  const fact=(key:string)=>provenance?.[key]?.source==='merchant'?provenance[key].value:null;
  const text=(key:string)=>{const value=fact(key);return typeof value==='string'&&value.length<=300?value.trim():null;};
  const name=text('title'),brand=text('brand'),model=text('model'),category=text('category');
  const offer=fact('offer') as {merchantUrl?:unknown;merchant?:unknown;price?:unknown;currency?:unknown}|null;
  // With image URL hints removed before resolution, this fallback is the resolver's
  // independently verified PDP URL. A missing price must not block valid identity.
  const url=typeof offer?.merchantUrl==='string'?offer.merchantUrl:input.merchantUrl;
  const publicUrl=(value:string)=>{try{const parsed=new URL(value);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!/[?&](token|signature)=|find-private-images|\/finds\//i.test(value);}catch{return false;}};
  if(!name||!url||!publicUrl(url)||!isQualifyingMerchantSeedUrl(url))return null;
  const safeImage=text('heroImage');
  const imageUrl=safeImage&&publicUrl(safeImage)?safeImage:null;
  const normalized=new ProductNormalizer().normalize({draftId:'merchant',externalId:'merchant',name,brand,model,category,confidence:1,merchantUrl:url});
  return {name,brand,model,category,imageUrl,merchantUrl:url,merchant:typeof offer?.merchant==='string'?offer.merchant:null,
    price:typeof offer?.price==='string'?offer.price:null,currency:typeof offer?.currency==='string'?offer.currency:null,
    identityKey:discoveredProductIdentityKey(normalized,url),metadata:{source:'validated_merchant_identity'},matchConfidence:input.matchConfidence,completeness:null};
}
