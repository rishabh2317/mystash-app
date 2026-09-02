import type { SearchQueryIntent } from '@/src/services/searchApi';

export type SearchSectionKind = 'collections' | 'creators' | 'products';

export type SearchSections = {
  collections: unknown[];
  creators: unknown[];
  products: unknown[];
};

/** Intent-aware section order for typed Search results. */
export function searchSectionOrder(intent: string | null | undefined): SearchSectionKind[] {
  switch (intent) {
    case 'EXACT_PRODUCT':
    case 'COMMERCE':
    case 'COMPARISON':
      return ['products', 'collections', 'creators'];
    case 'CREATOR':
      return ['creators', 'collections', 'products'];
    case 'TRENDING':
      return ['collections', 'creators', 'products'];
    default:
      return ['collections', 'creators', 'products'];
  }
}

export function searchSectionTitle(kind: SearchSectionKind, intent: string | null | undefined): string {
  if (kind === 'products') {
    if (intent === 'EXACT_PRODUCT' || intent === 'COMMERCE') return 'Products to buy';
    if (intent === 'COMPARISON') return 'Products to compare';
    return 'Products';
  }
  if (kind === 'collections') {
    if (intent === 'DISCOVERY' || intent === 'CATEGORY_CONCEPT' || intent === 'TRENDING') {
      return 'Collections to explore';
    }
    return 'Collections';
  }
  if (kind === 'creators') return 'Creators';
  return 'Results';
}

export function popularFallbackMessage(degraded: string[] | undefined): string | null {
  if (!degraded?.includes('popular_suggestions')) return null;
  return 'No exact matches — showing popular collections';
}

export function searchConstraintChipLabel(
  intent: string | null | undefined,
  query: string,
): string | null {
  const under = query.match(
    /\b(?:under|below|less\s+than|upto|up\s+to|max(?:imum)?)\s+(?:₹|rs\.?|inr|\$|usd)?\s*([\d,]+(?:\.\d+)?)\s*(?:k|K)?\b/i,
  );
  if (!under) return null;
  const raw = under[1]?.replace(/,/g, '') ?? '';
  const amount = raw.match(/^([\d.]+)(k)?$/i);
  if (!amount) return null;
  let n = Number(amount[1]);
  if (!Number.isFinite(n)) return null;
  if (amount[2]) n *= 1000;
  const formatted = n >= 1000 ? n.toLocaleString() : String(n);
  return `Under ${formatted}`;
}
