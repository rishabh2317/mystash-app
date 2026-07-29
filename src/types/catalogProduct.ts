/** UI-facing catalog product model — never bind screens to DB rows directly. */

export type CatalogVerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED';

export type CatalogProductViewModel = {
  id: string;
  title: string;
  brand: string | null;
  merchant: string | null;
  heroImage: string | null;
  galleryImages: string[];
  description: string | null;
  shortDescription: string | null;
  specifications: Record<string, string>;
  verificationStatus: CatalogVerificationStatus;
  merchantUrl: string | null;
  affiliateUrl: string | null;
  availability: string | null;
  price: string | null;
  currency: string | null;
  lastVerifiedAt: string | null;
  metadataCompleteness: number | null;
};

/** Raw catalog_products join shape used by mappers. */
export type CatalogProductRow = {
  id: string;
  name: string;
  brand?: string | null;
  merchant?: string | null;
  merchant_url?: string | null;
  affiliate_url?: string | null;
  image_url?: string | null;
  price?: string | null;
  currency?: string | null;
  description?: string | null;
  availability?: string | null;
  verification_status?: string | null;
  last_verified_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export const CATALOG_IMAGE_PLACEHOLDER = 'https://picsum.photos/seed/mystash-product/400/400';
