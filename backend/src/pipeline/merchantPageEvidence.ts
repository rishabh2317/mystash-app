import {countryCodeForEvidence} from '../merchant-pricing/country';
/** Facts read from the fetched merchant page, never from extraction/search hints. */
export type MerchantPageEvidence = {
  hasProductJsonLd: boolean;
  countryAvailability?:import('../shopping/countrySuitability').CountryAvailability;
  sku?: string;
  model?: string;
  brand?: string;
  name?: string;
  gtin?: string;
  mpn?: string;
  hasAddToCart: boolean;
};

/** Keep Product schema evidence even when Offer/price is absent. Ambiguous
 * multi-product documents are not evidence for a particular merchant URL. */
export function readMerchantPageEvidence(html: string, pageUrl: string): MerchantPageEvidence {
  const empty: MerchantPageEvidence = { hasProductJsonLd: false, hasAddToCart: false };
  if (/captcha|robot check|verify (?:that )?you(?:'re| are) human|access denied/i.test(html.slice(0, 20000))) return empty;
  const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : undefined;
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 12 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    const row = value as Record<string, unknown>;
    if ([row['@type']].flat().some(type => type === 'Product' || type === 'IndividualProduct')) nodes.push(row);
    if (row['@graph']) visit(row['@graph'], depth + 1);
    if (row.mainEntity) visit(row.mainEntity, depth + 1);
  };
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1]!)); } catch { /* Malformed markup adds no evidence. */ }
  }
  const sameUrl = (raw: unknown) => {
    try { const a = new URL(String(raw), pageUrl), b = new URL(pageUrl); return a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, ''); }
    catch { return false; }
  };
  const matching = nodes.filter(row => row.url && sameUrl(row.url));
  const product = matching.length === 1 ? matching[0] : nodes.length === 1 && (!nodes[0]!.url || sameUrl(nodes[0]!.url)) ? nodes[0] : undefined;
  const brand = product?.brand;
  const countries=new Set<string>();
  const readCountries=(value:unknown,depth=0):void=>{
    if(depth>8||!value)return;
    if(Array.isArray(value)){value.forEach(v=>readCountries(v,depth+1));return;}
    if(typeof value!=='object')return;
    const row=value as Record<string,unknown>;
    const raw=row.addressCountry;
    const code=countryCodeForEvidence(typeof raw==='string'?raw:raw&&typeof raw==='object'?String((raw as Record<string,unknown>).name??''):null);
    if(code)countries.add(code);
    for(const region of [row.eligibleRegion].flat()) {
      const eligible=countryCodeForEvidence(typeof region==='string'?region:region&&typeof region==='object'?String((region as Record<string,unknown>).name??''):null);
      if(eligible)countries.add(eligible);
    }
    for(const key of ['offers','shippingDetails','shippingDestination','eligibleRegion'])readCountries(row[key],depth+1);
  };
  readCountries(product);

  return {
    hasProductJsonLd: Boolean(product),
    ...(countries.size?{countryAvailability:{availableCountries:[...countries]}}:{}),
    name: text(product?.name), model: text(product?.model), sku: text(product?.sku),
    mpn: text(product?.mpn), gtin: text(product?.gtin ?? product?.gtin14 ?? product?.gtin13 ?? product?.gtin12 ?? product?.gtin8),
    brand: text(typeof brand === 'object' && brand ? (brand as Record<string, unknown>).name : brand),
    // Require an actual control, not the phrase in scripts, reviews or prose.
    hasAddToCart: /<(?:button|input)\b[^>]*(?:name|id|value|aria-label)=["'][^"']*add[-_ ]to[-_ ](?:cart|bag)[^"']*["']/i.test(html)
      || /<button\b[^>]*>\s*add to (?:cart|bag)\s*<\/button>/i.test(html),
  };
}
