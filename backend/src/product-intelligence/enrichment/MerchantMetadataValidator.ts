import type { MerchantProductMetadata } from './types';

export type MerchantValidation = {
  ok: boolean;
  errors: string[];
};

/**
 * Soft validation — price is optional; never fail enrichment solely for missing price.
 */
export class MerchantMetadataValidator {
  validate(meta: MerchantProductMetadata): MerchantValidation {
    const errors: string[] = [];
    if (!meta.merchantUrl || !/^https?:\/\//i.test(meta.merchantUrl)) {
      errors.push('merchantUrl_invalid');
    }
    if (!meta.title || meta.title.trim().length < 2) {
      errors.push('title_missing');
    }
    if (!meta.merchant || meta.merchant.trim().length < 1) {
      errors.push('merchant_missing');
    }
    return { ok: errors.length === 0, errors };
  }
}
