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
