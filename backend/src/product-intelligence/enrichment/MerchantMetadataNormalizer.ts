import { ProductNormalizer } from '../normalizer/ProductNormalizer';
import { detectMerchantLabel } from './merchantDetect';
import {
  computeWeightedMetadataCompleteness,
  validPriceValue,
  type CompletenessInput,
} from './MetadataQuality';
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

/** Backward-compatible export for callers; implementation is now weighted. */
export function computeMetadataCompleteness(
  meta: CompletenessInput & { merchant?: string | null },
): number {
  return computeWeightedMetadataCompleteness(meta);
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

    const price = validPriceValue(raw.price, raw.currency);

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
