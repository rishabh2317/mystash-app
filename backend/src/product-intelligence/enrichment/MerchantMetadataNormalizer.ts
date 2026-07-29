import { ProductNormalizer } from '../normalizer/ProductNormalizer';
import { detectMerchantLabel } from './merchantDetect';
import type { MerchantProductMetadata } from './types';

const INC_SUFFIX =
  /\b(inc\.?|incorporated|ltd\.?|limited|llc|corp\.?|corporation|electronics|co\.?)\b/gi;

function cleanHtmlish(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\b(utm_[a-z0-9]+|click here|subscribe now|sign up for|cookie policy)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortDesc(description: string | null, max = 160): string | null {
  if (!description) return null;
  const t = description.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Completeness 0–100 per Objective.docx:
 * Title 20, Brand 15, Thumbnail 20, Description 15, Merchant 10, Price 10, Specs 10.
 */
export function computeMetadataCompleteness(meta: {
  title?: string | null;
  brand?: string | null;
  image?: string | null;
  description?: string | null;
  merchant?: string | null;
  price?: string | null;
  specifications?: Record<string, string>;
}): number {
  let score = 0;
  if (meta.title && meta.title.trim().length >= 2) score += 20;
  if (meta.brand && meta.brand.trim().length >= 2) score += 15;
  if (meta.image && /^https?:\/\//i.test(meta.image)) score += 20;
  if (meta.description && meta.description.trim().length >= 20) score += 15;
  if (meta.merchant && meta.merchant.trim().length >= 2) score += 10;
  if (meta.price && /\d/.test(meta.price)) score += 10;
  if (meta.specifications && Object.keys(meta.specifications).length > 0) score += 10;
  return score;
}

export class MerchantMetadataNormalizer {
  private readonly productNormalizer = new ProductNormalizer();

  normalize(
    raw: Partial<MerchantProductMetadata>,
    hints?: { brandHint?: string | null; categoryHint?: string | null },
  ): MerchantProductMetadata {
    const merchantUrl = (raw.merchantUrl ?? '').trim();
    const merchant =
      raw.merchant?.trim() ||
      (merchantUrl ? detectMerchantLabel(merchantUrl) : 'Merchant');

    let brand = raw.brand?.trim() || hints?.brandHint?.trim() || null;
    if (brand) {
      brand = brand
        .replace(INC_SUFFIX, ' ')
        .replace(/[.,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const norm = this.productNormalizer.normalize({
        draftId: 'enrich',
        externalId: 'enrich',
        name: brand,
        brand,
        confidence: 1,
      });
      brand = norm.brand ?? brand;
    }

    const titleRaw = (raw.title ?? '').trim() || merchant;
    const titleNorm = this.productNormalizer.normalize({
      draftId: 'enrich',
      externalId: 'enrich',
      name: titleRaw,
      brand,
      confidence: 1,
    });

    const description = raw.description ? cleanHtmlish(raw.description) : null;
    const image = raw.primaryImage || raw.image || null;
    const validImage = image && /^https?:\/\//i.test(image) ? image : null;
    const specs =
      raw.specifications && typeof raw.specifications === 'object' && !Array.isArray(raw.specifications)
        ? { ...raw.specifications }
        : {};

    const price =
      raw.price && raw.price !== '—' && /\d/.test(raw.price) ? raw.price.trim() : null;

    const meta: MerchantProductMetadata = {
      title: titleNorm.name || titleRaw,
      brand,
      image: validImage,
      primaryImage: validImage,
      description,
      shortDescription: shortDesc(description),
      merchant,
      merchantUrl,
      category: raw.category?.trim() || hints?.categoryHint?.trim() || null,
      price,
      currency: price ? raw.currency ?? null : null,
      availability: raw.availability?.trim() || null,
      specifications: specs,
      priceSource: price ? raw.priceSource ?? 'merchant' : null,
      priceLastVerifiedAt: price
        ? raw.priceLastVerifiedAt ?? new Date().toISOString()
        : null,
      extractedAt: raw.extractedAt ?? new Date().toISOString(),
      provider: raw.provider ?? 'unknown',
      metadataCompleteness: 0,
    };
    meta.metadataCompleteness = computeMetadataCompleteness(meta);
    return meta;
  }
}
