import { validHttpUrl } from '../shopping/urlValidation';
import { normalizeCountryCode } from './country';

export type RegionalOfferInput = {
  url: string;
  regionalUrls?: Record<string, string> | null;
};

export type RegionalResolution = {
  url: string;
  countryCode: string;
  usedRegional: boolean;
};

/**
 * Select the merchant URL for a country using only explicit mappings.
 * Never invents localized URLs (no .com → .in rewriting).
 */
export function resolveMerchantRegion(
  offer: RegionalOfferInput,
  countryCode: string,
): RegionalResolution {
  const country = normalizeCountryCode(countryCode) ?? 'IN';
  const original = validHttpUrl(offer.url);
  if (!original) {
    return { url: offer.url, countryCode: country, usedRegional: false };
  }

  const map = offer.regionalUrls;
  if (map && typeof map === 'object') {
    const candidate = validHttpUrl(map[country] ?? map[country.toLowerCase()] ?? null);
    if (candidate) {
      return { url: candidate, countryCode: country, usedRegional: true };
    }
  }

  return { url: original, countryCode: country, usedRegional: false };
}

/** Parse explicit regional URL maps from candidate/metadata objects. */
export function parseRegionalUrls(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const country = normalizeCountryCode(key);
    const url = typeof value === 'string' ? validHttpUrl(value) : null;
    if (country && url) out[country] = url;
  }
  return Object.keys(out).length > 0 ? out : null;
}
