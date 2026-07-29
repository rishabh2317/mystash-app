import type { DraftProduct } from '@/src/types/curation';
import type {
  CatalogProductRow,
  CatalogProductViewModel,
  CatalogVerificationStatus,
} from '@/src/types/catalogProduct';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';

function asVerification(raw: string | null | undefined): CatalogVerificationStatus {
  if (raw === 'VERIFIED' || raw === 'UNVERIFIED' || raw === 'UNRESOLVED') return raw;
  return 'UNRESOLVED';
}

function cleanPrice(price: string | null | undefined): string | null {
  if (!price || price === '—') return null;
  return price.trim() || null;
}

function parseSpecs(metadata: Record<string, unknown> | null | undefined): Record<string, string> {
  const raw = metadata?.specifications;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

function parseGallery(metadata: Record<string, unknown> | null | undefined, hero: string | null): string[] {
  const gallery = metadata?.gallery;
  const urls: string[] = [];
  if (Array.isArray(gallery)) {
    for (const u of gallery) {
      if (typeof u === 'string' && u.startsWith('http')) urls.push(u);
    }
  }
  if (hero && !urls.includes(hero)) urls.unshift(hero);
  return urls;
}

function resolveHero(row: CatalogProductRow): string | null {
  const meta = row.metadata ?? {};
  const primary =
    (typeof meta.primary_image === 'string' && meta.primary_image.startsWith('http')
      ? meta.primary_image
      : null) ||
    (typeof meta.hero_image === 'string' && meta.hero_image.startsWith('http') ? meta.hero_image : null) ||
    (row.image_url && row.image_url.startsWith('http') ? row.image_url : null);
  return primary;
}

/** Map a persisted catalog_products row into the UI view model. */
export function catalogRowToViewModel(row: CatalogProductRow): CatalogProductViewModel {
  const meta = row.metadata ?? {};
  const hero = resolveHero(row);
  const description =
    (typeof row.description === 'string' && row.description.trim()) ||
    (typeof meta.short_description === 'string' ? meta.short_description : null) ||
    (typeof meta.description === 'string' ? meta.description : null);
  const shortDescription =
    typeof meta.short_description === 'string' ? meta.short_description : description?.slice(0, 160) ?? null;
  const completeness =
    typeof meta.metadata_completeness === 'number' ? meta.metadata_completeness : null;

  return {
    id: row.id,
    title: row.name,
    brand: row.brand ?? null,
    merchant: row.merchant ?? null,
    heroImage: hero,
    galleryImages: parseGallery(meta, hero),
    description,
    shortDescription,
    specifications: parseSpecs(meta),
    verificationStatus: asVerification(row.verification_status),
    merchantUrl: row.merchant_url ?? null,
    affiliateUrl: row.affiliate_url ?? null,
    availability: row.availability ?? null,
    price: cleanPrice(row.price),
    currency: row.currency ?? null,
    lastVerifiedAt: row.last_verified_at ?? null,
    metadataCompleteness: completeness,
  };
}

/**
 * Review / draft path: prefer joined catalog row; fall back to denormalized draft
 * only for legacy rows without catalog_product_id.
 */
export function draftProductToViewModel(
  draft: DraftProduct & {
    brand?: string | null;
    description?: string | null;
    catalogRow?: CatalogProductRow | null;
  },
): CatalogProductViewModel {
  if (draft.catalogRow) {
    return catalogRowToViewModel(draft.catalogRow);
  }

  const id = draft.catalogProductId || draft.id;
  const hero = draft.image?.startsWith('http') ? draft.image : null;
  return {
    id,
    title: draft.name,
    brand: draft.brand ?? null,
    merchant: draft.merchant ?? draft.provider ?? null,
    heroImage: hero,
    galleryImages: hero ? [hero] : [],
    description: draft.description ?? null,
    shortDescription: draft.description?.slice(0, 160) ?? null,
    specifications: {},
    verificationStatus: draft.resolutionStatus ?? 'UNRESOLVED',
    merchantUrl: draft.merchantUrl ?? null,
    affiliateUrl: draft.affiliateUrl?.startsWith('http') ? draft.affiliateUrl : null,
    availability: null,
    price: cleanPrice(draft.price),
    currency: draft.currency ?? null,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  };
}

export function viewProductUrl(product: CatalogProductViewModel): string | null {
  if (product.affiliateUrl?.startsWith('http')) return product.affiliateUrl;
  if (product.merchantUrl?.startsWith('http')) return product.merchantUrl;
  return null;
}

export function displayHeroUri(product: CatalogProductViewModel): string {
  return product.heroImage || product.galleryImages[0] || CATALOG_IMAGE_PLACEHOLDER;
}
