import { normalizeCountryCode } from '../merchant-pricing/country';

/** Discovery links are not offers: no product identity, price or availability. */
import type {DiscoveryDestination} from './discoveryContract';
export type {DiscoveryDestination} from './discoveryContract';
type Store = { home: string; search?: { url: string; parameter: string } };
/** Explicit first-party storefronts. Unsupported countries never inherit another country's store. */
const STOREFRONTS: Record<string, Record<string, Store>> = {
  zara: {
    IN: { home: 'https://www.zara.com/in/en/', search: { url: 'https://www.zara.com/in/en/search', parameter: 'searchTerm' } },
    US: { home: 'https://www.zara.com/us/en/', search: { url: 'https://www.zara.com/us/en/search', parameter: 'searchTerm' } },
    GB: { home: 'https://www.zara.com/uk/en/', search: { url: 'https://www.zara.com/uk/en/search', parameter: 'searchTerm' } },
  },
  apple: {
    IN: { home: 'https://www.apple.com/in/' },
    US: { home: 'https://www.apple.com/' },
    GB: { home: 'https://www.apple.com/uk/' },
  },
};
const clean = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 160) : '';
const meaningful = (value: string) => /[\p{L}]{3}/u.test(value)
  && !/^(?:[\s(),-]*(?:unknown|unidentified|unconfirmed|product|item|object|clothing|fashion|something|type)[\s(),-]*)+$/i.test(value)
  && !/https?:|www\.|[<>]/i.test(value)
  && !/^(black|white|red|blue|green|small|large)$/i.test(value);


export function meaningfulDiscoveryDescription(name: unknown, brand?: unknown): boolean {
 const title=clean(name), label=clean(brand);
 const description=label && title.toLowerCase().startsWith(label.toLowerCase()+' ')?title.slice(label.length).trim():title;
 return meaningful(description) && description.toLowerCase()!==label.toLowerCase();
}

/** Pure projection of persisted extraction evidence. Never fetches or discovers merchants. */
export function discoveryDestination(input: { name: unknown; brand?: unknown; evidence?: Record<string, unknown> | null; country: string }): DiscoveryDestination | null {
  const rawName = clean(input.name), rawBrand = clean(input.brand);
  const brand = rawBrand.length<=80 && !/https?:|www\.|[<>@]/i.test(rawBrand) ? rawBrand : '';
  const name = brand && rawName.toLowerCase().startsWith(brand.toLowerCase()+' ') ? rawName.slice(brand.length).trim() : rawName;
  const country = normalizeCountryCode(input.country) ?? 'IN';
  if (!meaningfulDiscoveryDescription(name,brand)) return null;
  const attributes = input.evidence?.attributes;
  const groundedBrand = !!brand && Array.isArray(attributes) && attributes.some(a => a && typeof a === 'object'
    && ['brand', 'brandText'].includes(a.attribute) && ['source_text', 'observed'].includes(a.origin)
    && clean(a.value).toLowerCase() === brand.toLowerCase());
  const query = [brand, name].filter(Boolean).join(' ');
  // 'Apple' in a fruit/food description does not establish the electronics brand.
  const brandContext = brand.toLowerCase() !== 'apple' || /\b(iphone|ipad|mac|macbook|imac|airpods|watch|headphones|earphones|pencil|keyboard|mouse|charger|cable|adapter|airtag|vision|homepod|display)\b/i.test(name);
  const store = groundedBrand && brandContext ? STOREFRONTS[brand.toLowerCase()]?.[country] : undefined;
  if (store?.search) {
    const url = new URL(store.search.url); url.searchParams.set(store.search.parameter, name);
    return { kind: 'official_search', label: `Search ${brand}`, url: url.href, query: name, country };
  }
  if (store) return { kind: 'official_storefront', label: `Visit ${brand}`, url: store.home, query, country };
  return { kind: 'google_search', label: 'Search Google', url: `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${country.toLowerCase()}`, query, country };
}
