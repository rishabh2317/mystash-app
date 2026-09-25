import type { ExtractedMerchantPrice } from '../types';

function flattenLdNodes(data: unknown): unknown[] {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) return data.flatMap(flattenLdNodes);
  if (typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o['@graph'])) return flattenLdNodes(o['@graph']);
  return [data];
}

function isProductType(types: unknown): boolean {
  if (types === 'Product' || types === 'http://schema.org/Product' || types === 'https://schema.org/Product') {
    return true;
  }
  if (Array.isArray(types)) return types.some(isProductType);
  if (typeof types === 'string') return types.includes('Product');
  return false;
}

function isOfferType(types: unknown): boolean {
  if (
    types === 'Offer' ||
    types === 'AggregateOffer' ||
    types === 'http://schema.org/Offer' ||
    types === 'https://schema.org/Offer'
  ) {
    return true;
  }
  if (Array.isArray(types)) return types.some(isOfferType);
  if (typeof types === 'string') {
    return types.includes('Offer') || types.includes('AggregateOffer');
  }
  return false;
}

function readAvailability(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const leaf = raw.split(/[/#]/).pop() ?? raw;
  if (/instock/i.test(leaf)) return 'InStock';
  if (/outofstock/i.test(leaf)) return 'OutOfStock';
  if (/preorder/i.test(leaf)) return 'PreOrder';
  if (/limitedavailability/i.test(leaf)) return 'LimitedAvailability';
  if (/discontinued/i.test(leaf)) return 'Discontinued';
  return leaf.slice(0, 40);
}

function readPrice(offer: Record<string, unknown>): ExtractedMerchantPrice | null {
  const priceRaw = offer.price ?? offer.lowPrice ?? offer.highPrice;
  if (typeof priceRaw !== 'number' && typeof priceRaw !== 'string') return null;
  const price = String(priceRaw).trim().replace(/,/g, '');
  if (!/\d/.test(price)) return null;
  // Reject clearly non-numeric fabrications
  if (!/^\d+(\.\d+)?$/.test(price)) {
    const cleaned = price.replace(/[^\d.]/g, '');
    if (!cleaned || !/\d/.test(cleaned)) return null;
    const currency =
      typeof offer.priceCurrency === 'string' && offer.priceCurrency.trim()
        ? offer.priceCurrency.trim().toUpperCase()
        : null;
    return {
      price: cleaned,
      currency,
      availability: readAvailability(offer.availability),
    };
  }
  const currency =
    typeof offer.priceCurrency === 'string' && offer.priceCurrency.trim()
      ? offer.priceCurrency.trim().toUpperCase()
      : null;
  return {
    price,
    currency,
    availability: readAvailability(offer.availability),
  };
}

function fromOfferNode(node: Record<string, unknown>): ExtractedMerchantPrice | null {
  if (isOfferType(node['@type']) || node.price != null || node.lowPrice != null) {
    return readPrice(node);
  }
  return null;
}

/**
 * Deterministic schema.org Product/Offer JSON-LD extraction.
 * Does not invent or estimate prices.
 */
export function extractJsonLdPrice(html: string): ExtractedMerchantPrice | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]!.trim()) as unknown;
      const flat = flattenLdNodes(data);
      for (const node of flat) {
        if (!node || typeof node !== 'object') continue;
        const o = node as Record<string, unknown>;
        if (isProductType(o['@type'])) {
          const offers = o.offers;
          const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
          for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const parsed = fromOfferNode(item as Record<string, unknown>);
            if (parsed) return parsed;
          }
        }
        const direct = fromOfferNode(o);
        if (direct) return direct;
      }
    } catch {
      /* next script block */
    }
  }
  return null;
}
