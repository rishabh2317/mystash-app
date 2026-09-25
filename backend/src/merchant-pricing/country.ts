import { getMerchantPricingConfig } from './config';

const ISO2 = /^[A-Za-z]{2}$/;

/** Normalize to ISO 3166-1 alpha-2 or null. */
export function normalizeCountryCode(value: string | null | undefined): string | null {
  const raw = value?.trim().toUpperCase();
  if (!raw || !ISO2.test(raw)) return null;
  if (raw === 'UK') return 'GB';
  return raw;
}

/**
 * Resolve country for merchant routing.
 * Priority: explicit → profile → device locale → app default → safe fallback.
 */
export function resolveCountryCode(input: {
  explicit?: string | null;
  profile?: string | null;
  deviceLocale?: string | null;
  defaultCountry?: string | null;
}): string {
  const cfg = getMerchantPricingConfig();
  return (
    normalizeCountryCode(input.explicit) ??
    normalizeCountryCode(input.profile) ??
    countryFromLocale(input.deviceLocale) ??
    normalizeCountryCode(input.defaultCountry) ??
    normalizeCountryCode(cfg.defaultCountry) ??
    'IN'
  );
}

/** Extract region from locale tags like en-IN, en_US, hi-Latn-IN. */
export function countryFromLocale(locale: string | null | undefined): string | null {
  const raw = locale?.trim();
  if (!raw) return null;
  // Accept-Language may be a list: en-IN,en;q=0.9
  const first = raw.split(',')[0]?.trim() ?? raw;
  const tag = first.split(';')[0]?.trim() ?? first;
  const parts = tag.replace(/_/g, '-').split('-').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]!;
    if (ISO2.test(part) && part.toUpperCase() !== 'EN') {
      const code = normalizeCountryCode(part);
      if (code) return code;
    }
  }
  // Prefer second segment when it looks like a region (en-IN).
  if (parts.length >= 2 && ISO2.test(parts[1]!)) {
    return normalizeCountryCode(parts[1]!);
  }
  return null;
}
