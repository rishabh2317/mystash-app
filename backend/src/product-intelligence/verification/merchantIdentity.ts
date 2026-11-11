import type { ProductIdentityCandidate, ProductIdentityExpectation } from '../search/productIdentityCompatibility';

const leviBrand = (value: string | null | undefined) => /^levi(?:['’]?s)?$/i.test(value?.trim() ?? '') ? 'Levi' : value;

/** Bounded manufacturer lookup for the two observed SKU misses, shopping only. */
export function merchantSkuDiscoveryQuery(query: string, brand: string | null | undefined): string {
  const normalized = leviBrand(brand)?.toLowerCase();
  const domain = normalized === 'levi' ? 'levi.com' : normalized === 'uniqlo' ? 'uniqlo.com' : null;
  return domain ? `${query} site:${domain}` : query;
}

/** Comparison facts only. Never returns a replacement shopping URL or image query. */
export function merchantComparison(expected: ProductIdentityExpectation, candidate: ProductIdentityCandidate) {
  const e = { ...expected, brand: leviBrand(expected.brand) };
  const c = { ...candidate, brand: leviBrand(candidate.brand),
    title: e.brand === 'Levi' ? candidate.title?.replace(/\blevi(?:['’]s|s)\b/gi, 'Levi') : candidate.title };
  if (/^uniqlo$/i.test(e.brand ?? '')) {
    // Explicit typed identifiers have the same bounded manufacturer alias.
    // Never strip suffixes or digits (which may identify a different variant).
    e.model = e.model?.replace(/^E(?=\d{6}$)/i, '');
    c.model = c.model?.replace(/^E(?=\d{6}$)/i, '');
  }
  let officialSku = false;
  let officialSkuValue: string | undefined;
  try {
    const url = new URL(candidate.merchantUrl ?? '');
    const host = url.hostname.toLowerCase();
    const official = (domain: string) => host === domain || host.endsWith('.' + domain);
    if (official('levi.com') && e.brand === 'Levi') {
      // Locale and category routing is not product/brand evidence.
      const sku = url.pathname.match(/\/p\/([a-z0-9]+)\/?$/i)?.[1];
      if (sku) {
        officialSkuValue = sku;
        c.merchantUrl = `https://www.levi.com/p/${sku}`;
        officialSku = Boolean(e.model && sku.toLowerCase() === e.model.toLowerCase());
      }
    }
    if (official('uniqlo.com') && /^uniqlo$/i.test(e.brand ?? '')) {
      const sku = url.pathname.match(/\/products\/E(\d{6})-\d{3}(?:\/|$)/i)?.[1];
      if (sku) {
        officialSkuValue = sku;
        // E is UNIQLO's typed URL prefix, not a fuzzy match or a generation.
        c.merchantUrl = `https://www.uniqlo.com/products/${sku}`;
        officialSku = sku === e.model;
      }
    }
    if (official('ebay.com') && /^\/itm\/\d+\/?$/.test(url.pathname)) {
      c.merchantUrl = `https://www.ebay.com/product/${url.pathname.split('/')[2]}`;
    }
  } catch { /* Invalid URLs never provide identity evidence. */ }
  return { expected: e, candidate: c, officialSku, officialSkuValue };
}
