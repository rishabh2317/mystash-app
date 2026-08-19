import type { CatalogProduct } from '../catalog/domain/types';
import type { ProductIndexInput } from './documents';

/** Map Catalog product → disposable CatalogProductSearchDocument input. */
export function catalogProductToSearchIndexInput(p: CatalogProduct): ProductIndexInput {
  const status = String(p.status ?? '').toUpperCase();
  const searchEligible = status === 'ACTIVE';
  const aliases: string[] = [];
  if (p.normalizedName && p.normalizedName !== p.name) aliases.push(p.normalizedName);
  return {
    catalogProductId: p.id,
    canonicalSlug: p.canonicalSlug ?? null,
    name: p.name,
    brand: p.brand ?? null,
    model: p.model ?? null,
    category: p.category ?? null,
    aliases,
    verificationStatus: p.verificationStatus ?? null,
    primaryImageRef: p.imageUrl ?? null,
    popularity: 0,
    lastVerifiedAt: p.lastVerifiedAt ?? null,
    // Price filter only when Search-side denorm exists — parse best-effort, never live Shopping.
    priceAmount: parsePriceAmount(p.price),
    priceCurrency: p.currency ?? null,
    searchEligible: searchEligible && !p.mergedIntoId,
    contentRevision: 1,
    deleted: Boolean(p.mergedIntoId) || status === 'MERGED' || status === 'HIDDEN',
  };
}

function parsePriceAmount(price: string | null): number | null {
  if (!price) return null;
  const n = Number(String(price).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}
