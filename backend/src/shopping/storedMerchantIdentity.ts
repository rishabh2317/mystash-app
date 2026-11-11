import type {ProductIdentityExpectation} from '../product-intelligence/search/productIdentityCompatibility';

/** Public product facts only: never copy a private source caption/image into a shared cache. */
export function storedMerchantIdentity(product:{name?:string;brand:string|null;model?:string|null;category?:string|null;metadata?:Record<string,unknown>|null}):ProductIdentityExpectation {
  const metadata=product.metadata??{};
  const specs=metadata.specifications && typeof metadata.specifications==='object'&&!Array.isArray(metadata.specifications)
    ? Object.entries(metadata.specifications).slice(0,40).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([key,value])=>`${value} ${key}`).join(' ') : '';
  return {name:product.name,brand:product.brand,model:product.model,
    category:product.category??(typeof metadata.category==='string'?metadata.category:null),
    variantContext:[typeof metadata.variantContext==='string'?metadata.variantContext:'',specs].filter(Boolean).join(' ')||null,
    gtin:typeof metadata.gtin==='string'?metadata.gtin:null,mpn:typeof metadata.mpn==='string'?metadata.mpn:null};
}
