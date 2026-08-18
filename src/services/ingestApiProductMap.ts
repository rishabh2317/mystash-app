import type { DraftProduct } from '@/src/types/curation';

export type IngestApiProductDto = {
  id: string;
  name: string;
  price: string;
  currency?: string;
  provider: string;
  affiliateUrl: string;
  merchantUrl?: string;
  image?: string;
  confidence?: number;
  catalogProductId?: string;
  resolutionStatus?: 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED';
  brand?: string | null;
};

/** Map a POST /ingest/manual (or ingest-url) product DTO onto the Review draft product. */
export function mapIngestApiProductToDraft(p: IngestApiProductDto): DraftProduct {
  let merchant: string | undefined;
  if (p.merchantUrl) {
    try {
      merchant = new URL(p.merchantUrl).hostname.replace(/^www\./, '');
    } catch {
      merchant = undefined;
    }
  }
  const resolutionStatus =
    p.resolutionStatus === 'VERIFIED' ||
    p.resolutionStatus === 'UNVERIFIED' ||
    p.resolutionStatus === 'UNRESOLVED'
      ? p.resolutionStatus
      : undefined;
  const catalogProductId =
    typeof p.catalogProductId === 'string' && p.catalogProductId ? p.catalogProductId : undefined;
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    currency: p.currency,
    provider: p.provider,
    affiliateUrl: p.affiliateUrl,
    merchantUrl: p.merchantUrl,
    merchant,
    image: p.image,
    confidence: p.confidence,
    catalogProductId,
    resolutionStatus,
    brand: p.brand ?? null,
  };
}
