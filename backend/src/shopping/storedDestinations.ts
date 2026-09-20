import { createHash } from 'node:crypto';
import { detectMerchantLabel } from '../product-intelligence/enrichment/merchantDetect';
import { merchantUrlsMatch, normalizeMerchantUrl } from '../product-intelligence/search/directUrlIdentity';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import type { DiscoveredProductRecord } from '../discovered/domain/types';
import { resolveShoppingSelectionForProduct } from './ShoppingConfiguration';
import { classifyShoppingProvider } from './shoppingPriorityConfig';
import { validHttpUrl } from './urlValidation';

export type StoredDestinationType = 'configured' | 'affiliate' | 'preferred' | 'merchant';

export type StoredShoppingDestination = {
  offerId: string;
  url: string;
  merchant: string | null;
  shoppingProvider: string;
  destinationType: StoredDestinationType;
  price: string | null;
  currency: string | null;
  availability: string | null;
};

export type StoredShoppingSource = {
  merchant: string | null;
  merchantUrl: string | null;
  preferredShoppingUrl: string | null;
  price: string | null;
  currency: string | null;
  brand: string | null;
  metadata: Record<string, unknown> | null | undefined;
  catalogProductId?: string | null;
};

type CandidateHint = {
  url?: string | null;
  merchant?: string | null;
  price?: string | null;
  currency?: string | null;
  availability?: string | null;
  shoppingProvider?: string | null;
  sourceType?: string | null;
  destinationType?: StoredDestinationType;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Stable opaque id — clients send this back; they never send a URL. */
export function shoppingOfferId(url: string): string {
  const key = normalizeMerchantUrl(url) ?? url.trim();
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

export function catalogShoppingSource(product: CatalogProduct): StoredShoppingSource {
  return {
    merchant: product.merchant,
    merchantUrl: product.merchantUrl,
    preferredShoppingUrl: product.preferredShoppingUrl,
    price: product.price,
    currency: product.currency,
    brand: product.brand,
    metadata: product.metadata,
    catalogProductId: product.id,
  };
}

export function discoveredShoppingSource(product: DiscoveredProductRecord): StoredShoppingSource {
  return {
    merchant: product.merchant,
    merchantUrl: product.merchantUrl,
    preferredShoppingUrl: null,
    price: product.price,
    currency: product.currency,
    brand: product.brand,
    metadata: product.metadata,
    catalogProductId: null,
  };
}

function readOffer(metadata: Record<string, unknown> | null | undefined): {
  merchant: string | null;
  merchantUrl: string | null;
  price: string | null;
  currency: string | null;
  availability: string | null;
} | null {
  const raw = metadata && typeof metadata === 'object' ? metadata.offer : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const merchantUrl = text(row.merchantUrl);
  if (!merchantUrl && !text(row.price) && !text(row.merchant)) return null;
  return {
    merchant: text(row.merchant),
    merchantUrl,
    price: text(row.price),
    currency: text(row.currency),
    availability: text(row.availability),
  };
}

function metadataAvailability(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  return text(metadata.availability);
}

function readCandidates(metadata: Record<string, unknown> | null | undefined): CandidateHint[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const raw = metadata.shopping_candidates;
  if (!Array.isArray(raw)) return [];
  const out: CandidateHint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const url = text(row.url);
    if (!url) continue;
    out.push({
      url,
      merchant: text(row.merchant),
      price: text(row.price),
      currency: text(row.currency),
      availability: text(row.availability),
      shoppingProvider: text(row.shoppingProvider),
      sourceType: text(row.sourceType) ?? text(row.sourceTier),
      destinationType: 'merchant',
    });
  }
  return out;
}

function commerceFor(
  url: string,
  source: StoredShoppingSource,
  hint: CandidateHint,
): { price: string | null; currency: string | null; availability: string | null } {
  if (hint.price) {
    return {
      price: hint.price,
      currency: hint.currency ?? null,
      availability: hint.availability ?? null,
    };
  }
  const offer = readOffer(source.metadata);
  if (offer && merchantUrlsMatch(offer.merchantUrl, url)) {
    return {
      price: offer.price,
      currency: offer.currency,
      availability: offer.availability ?? metadataAvailability(source.metadata),
    };
  }
  if (merchantUrlsMatch(source.merchantUrl, url)) {
    return {
      price: source.price,
      currency: source.currency,
      availability: hint.availability ?? metadataAvailability(source.metadata),
    };
  }
  return {
    price: null,
    currency: null,
    availability: hint.availability ?? null,
  };
}

function displayMerchant(url: string, source: StoredShoppingSource, hint: CandidateHint): string | null {
  if (hint.merchant) return hint.merchant;
  if (merchantUrlsMatch(source.merchantUrl, url) && source.merchant) return source.merchant;
  const offer = readOffer(source.metadata);
  if (offer?.merchant && merchantUrlsMatch(offer.merchantUrl, url)) return offer.merchant;
  const provider = (hint.shoppingProvider ?? classifyShoppingProvider(url, hint.sourceType as never)).toLowerCase();
  if (provider === 'official') return source.brand ? `${source.brand}` : 'Official store';
  if (provider && provider !== 'merchant') {
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
  const fromHost = detectMerchantLabel(url);
  return fromHost === 'Merchant' ? null : fromHost;
}

export function listStoredShoppingDestinations(source: StoredShoppingSource): StoredShoppingDestination[] {
  const seen = new Set<string>();
  const out: StoredShoppingDestination[] = [];

  const push = (rawUrl: string | null | undefined, hint: CandidateHint = {}): void => {
    const url = validHttpUrl(rawUrl);
    if (!url) return;
    const key = normalizeMerchantUrl(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const commerce = commerceFor(url, source, hint);
    const shoppingProvider =
      hint.shoppingProvider ?? classifyShoppingProvider(url, hint.sourceType as never);
    out.push({
      offerId: shoppingOfferId(url),
      url,
      merchant: displayMerchant(url, source, hint),
      shoppingProvider,
      destinationType: hint.destinationType ?? 'merchant',
      price: commerce.price,
      currency: commerce.currency,
      availability: commerce.availability,
    });
  };

  if (source.catalogProductId) {
    const configured = resolveShoppingSelectionForProduct(
      source.catalogProductId,
      source.metadata,
    ).selection.configuredBuyingUrl;
    push(configured, { destinationType: 'configured' });
  }

  for (const hint of readCandidates(source.metadata)) {
    push(hint.url, { ...hint, destinationType: 'merchant' });
  }

  const offer = readOffer(source.metadata);
  if (offer) {
    push(offer.merchantUrl, {
      destinationType: 'merchant',
      merchant: offer.merchant,
      price: offer.price,
      currency: offer.currency,
      availability: offer.availability,
    });
  }

  push(source.preferredShoppingUrl, { destinationType: 'preferred' });
  push(source.merchantUrl, {
    destinationType: 'merchant',
    merchant: source.merchant,
    price: source.price,
    currency: source.currency,
    availability: metadataAvailability(source.metadata),
  });

  return out;
}

export function findStoredShoppingDestination(
  source: StoredShoppingSource,
  offerId: string,
): StoredShoppingDestination | null {
  const id = offerId.trim();
  if (!id) return null;
  return listStoredShoppingDestinations(source).find((row) => row.offerId === id) ?? null;
}

const UNAVAILABLE = /out\s*of\s*stock|outofstock|unavailable|sold\s*out|not\s*available/i;

export function isUnavailableAvailability(value: string | null | undefined): boolean {
  return Boolean(value && UNAVAILABLE.test(value));
}

export function userFacingAvailability(value: string | null | undefined): string | null {
  const raw = text(value);
  if (!raw || raw.length > 40) return null;
  if (/^instock$/i.test(raw)) return 'In stock';
  if (/^outofstock$/i.test(raw)) return 'Out of stock';
  return raw;
}
