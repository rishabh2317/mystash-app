import type { DraftProduct, IngestDraftPayload } from '@/src/types/curation';
import type { CatalogVerificationStatus } from '@/src/types/catalogProduct';

/** Review display: never invent UNRESOLVED from a thin/missing client payload. */
export function reviewVerificationStatus(
  product: Pick<DraftProduct, 'catalogProductId' | 'resolutionStatus'> & {
    catalogProductId?: string | null;
  },
): CatalogVerificationStatus {
  if (
    product.resolutionStatus === 'VERIFIED' ||
    product.resolutionStatus === 'UNVERIFIED' ||
    product.resolutionStatus === 'UNRESOLVED'
  ) {
    return product.resolutionStatus;
  }
  return 'RESOLVING';
}

export function ingestDraftNeedsHydration(draft: Pick<IngestDraftPayload, 'products'>): boolean {
  if (!draft.products.length) return false;
  return draft.products.some((p) => !p.catalogProductId || !p.resolutionStatus);
}

export function isPublishableReviewProduct(
  product: Pick<DraftProduct, 'catalogProductId' | 'resolutionStatus'> & {
    catalogProductId?: string | null;
  },
): boolean {
  return (
    Boolean(product.catalogProductId) &&
    (product.resolutionStatus === 'VERIFIED' || product.resolutionStatus === 'UNVERIFIED')
  );
}

export function selectedProductsCanPublish(
  products: DraftProduct[],
  selected: Record<string, boolean>,
): boolean {
  const chosen = products.filter((p) => p.id && selected[p.id]);
  if (chosen.length < 1) return false;
  return chosen.every(isPublishableReviewProduct);
}

/** After a DB hydrate, retry PI only for genuine unresolved/failed drafts. */
export function ingestDraftNeedsProductRetry(
  draft: Pick<IngestDraftPayload, 'products'>,
): boolean {
  return draft.products.some((p) => {
    if (p.resolutionStatus === 'VERIFIED' || p.resolutionStatus === 'UNVERIFIED') {
      return !p.catalogProductId;
    }
    return p.resolutionStatus === 'UNRESOLVED';
  });
}

/** Product identification does not imply that a shopping destination was verified. */
export function reviewShoppingLinkStatus(product: Pick<DraftProduct, 'resolutionStatus' | 'merchantUrl'>): string {
  if (!product.resolutionStatus) return 'Checking shopping link…';
  let hasLink = false;
  try { const url = new URL(product.merchantUrl ?? ''); hasLink = ['https:', 'http:'].includes(url.protocol); } catch { /* No shopping destination. */ }
  if (product.resolutionStatus === 'VERIFIED' && hasLink) return 'Shopping link verified';
  if (product.resolutionStatus === 'UNRESOLVED') return 'Shopping link could not be verified';
  return hasLink ? 'Product identified · Shopping link not verified' : 'Product identified · Shopping link unavailable';
}
