import { createHash } from 'node:crypto';
import type { ProductIdentityContext } from './types';

/** Deterministic fingerprint of catalog identity inputs used for review research. */
export function computeProductEvidenceHash(identity: ProductIdentityContext): string {
  const payload = {
    productId: identity.productId,
    name: identity.name.trim().toLowerCase(),
    brand: identity.brand?.trim().toLowerCase() ?? null,
    model: identity.model?.trim().toLowerCase() ?? null,
    category: identity.category?.trim().toLowerCase() ?? null,
    canonicalSlug: identity.canonicalSlug.trim().toLowerCase(),
    specifications: Object.fromEntries(
      Object.entries(identity.specifications).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
