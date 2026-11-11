import { normalizeCountryCode } from '../merchant-pricing/country';

export type CountryAvailability = {
  availableCountries?: string[]; excludedCountries?: string[];
  merchantCountry?: string | null; shipsWorldwide?: boolean;
};
/** Explicit merchant marketplace markets, not a ccTLD guess. Unknown hosts stay unknown. */
const MARKETS: Record<string,string> = {
  'amazon.in':'IN','amazon.com':'US','amazon.co.uk':'GB','amazon.ca':'CA','amazon.de':'DE',
  'amazon.fr':'FR','amazon.it':'IT','amazon.es':'ES','amazon.co.jp':'JP','amazon.com.au':'AU',
  'amazon.ae':'AE','amazon.sg':'SG','amazon.com.br':'BR','amazon.com.mx':'MX',
  'flipkart.com':'IN','myntra.com':'IN','ajio.com':'IN','croma.com':'IN',
  'walmart.com':'US','target.com':'US','bestbuy.com':'US','argos.co.uk':'GB','currys.co.uk':'GB','johnlewis.com':'GB',
};
export function countryAvailability(value: unknown): CountryAvailability {
  if(!value || typeof value!=='object')return {};
  const row=value as CountryAvailability;
  const codes=(a:unknown)=>Array.isArray(a)?[...new Set(a.filter((v):v is string=>typeof v==='string').map(normalizeCountryCode).filter((v):v is string=>!!v))]:undefined;
  return {availableCountries:codes(row.availableCountries),excludedCountries:codes(row.excludedCountries),
    merchantCountry:normalizeCountryCode(row.merchantCountry),shipsWorldwide:row.shipsWorldwide===true};
}
export function merchantMarket(url:string):string|null {
  try{const host=new URL(url).hostname.toLowerCase();return Object.entries(MARKETS).find(([known])=>host===known||host.endsWith(`.${known}`))?.[1]??null;}catch{return null;}
}
/** Lower is better: local, explicitly serves country, unconfirmed fallback, limited shipping, excluded. */
export function countrySuitability(url:string,country:string|null|undefined,evidence?:unknown,regionalUrls?:Record<string,string>|null):number {
  const code=normalizeCountryCode(country);if(!code)return 2;
  const facts=countryAvailability(evidence);
  if(facts.excludedCountries?.includes(code))return 4;
  const market=facts.merchantCountry??merchantMarket(url);
  if(market===code || regionalUrls?.[code])return 0;
  if(facts.availableCountries?.includes(code)||facts.shipsWorldwide)return 1;
  if(facts.availableCountries?.length)return 3;
  return 2;
}
export function rankCountryOffers<T extends {url:string;countryAvailability?:CountryAvailability;regionalUrls?:Record<string,string>|null;destinationType?:string}>(offers:T[],country?:string|null):T[] {
  return offers.map((offer,index)=>({offer,index})).sort((a,b)=>
    // Explicit configured/affiliate destinations retain their contractual precedence.
    Number(['configured','affiliate'].includes(b.offer.destinationType??''))-Number(['configured','affiliate'].includes(a.offer.destinationType??'')) ||
    countrySuitability(a.offer.url,country,a.offer.countryAvailability,a.offer.regionalUrls)-countrySuitability(b.offer.url,country,b.offer.countryAvailability,b.offer.regionalUrls)||a.index-b.index).map(x=>x.offer);
}
