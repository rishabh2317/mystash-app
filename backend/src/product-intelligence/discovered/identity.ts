import { createHash } from 'node:crypto';
import {
  canonicalizeProductUrl,
  externalIdForProductUrl,
} from '../../pipeline/urlCanonicalization';
import type { NormalizedProduct } from '../domain/types';

/**
 * Stable discovered-product identity. Merchant URL uses the existing product-URL
 * identity; otherwise name+brand+model. Not a second canonicalizer.
 */
export function discoveredProductIdentityKey(
  norm: Pick<NormalizedProduct, 'normalizedName' | 'normalizedBrand' | 'model'>,
  merchantUrl?: string | null,
): string {
  const url = merchantUrl?.trim();
  if (url) {
    try {
      return externalIdForProductUrl(canonicalizeProductUrl(url));
    } catch {
      /* fall through to name identity */
    }
  }
  const basis = [
    norm.normalizedName.trim().toLowerCase(),
    (norm.normalizedBrand ?? '').trim().toLowerCase(),
    (norm.model ?? '').trim().toLowerCase(),
  ].join('|');
  const h = createHash('sha256').update(basis).digest('hex').slice(0, 28);
  return `n_${h}`;
}
