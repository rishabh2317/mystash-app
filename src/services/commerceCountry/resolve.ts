/** Default commerce country when nothing else is available. */
export const COMMERCE_COUNTRY_DEFAULT = 'IN';

/** Fresh location refresh cooldown (24h). */
export const LOCATION_CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type CommerceCountrySource = 'location' | 'manual' | 'profile' | 'locale' | 'default';

export type CommerceCountrySnapshot = {
  country: string;
  profileCountry: string | null;
  locale: string | null;
  countrySource: 'location' | 'manual' | null;
  source: CommerceCountrySource;
};

export function normalizeIso2Country(value: string | null | undefined): string | null {
  const raw = value?.trim().toUpperCase();
  if (!raw || !/^[A-Z]{2}$/.test(raw)) return null;
  return raw === 'UK' ? 'GB' : raw;
}

export function countryFromLocaleTag(locale: string | null | undefined): string | null {
  const raw = locale?.trim();
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim() ?? raw;
  const tag = first.split(';')[0]?.trim() ?? first;
  const parts = tag.replace(/_/g, '-').split('-').filter(Boolean);
  if (parts.length >= 2 && /^[A-Za-z]{2}$/.test(parts[1]!)) {
    return normalizeIso2Country(parts[1]!);
  }
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]!;
    if (/^[A-Za-z]{2}$/.test(part) && part.toUpperCase() !== 'EN') {
      return normalizeIso2Country(part);
    }
  }
  return null;
}

/**
 * Resolve commerce country for shopping / live pricing.
 *
 * Priority when not using a fresh location fix:
 * 1. Saved profile/manual/location country (users.country)
 * 2. Device locale region
 * 3. App default (IN)
 *
 * A valid saved country is never overwritten by device locale.
 */
export function resolveCommerceCountry(input: {
  profileCountry?: string | null;
  countrySource?: 'location' | 'manual' | null;
  deviceLocale?: string | null;
  defaultCountry?: string | null;
}): CommerceCountrySnapshot {
  const profile = normalizeIso2Country(input.profileCountry);
  const locale = input.deviceLocale?.trim() || null;
  if (profile) {
    const source: CommerceCountrySource =
      input.countrySource === 'manual'
        ? 'manual'
        : input.countrySource === 'location'
          ? 'location'
          : 'profile';
    return {
      country: profile,
      profileCountry: profile,
      locale,
      countrySource: input.countrySource ?? null,
      source,
    };
  }
  const fromLocale = countryFromLocaleTag(locale);
  if (fromLocale) {
    return {
      country: fromLocale,
      profileCountry: null,
      locale,
      countrySource: null,
      source: 'locale',
    };
  }
  const fallback =
    normalizeIso2Country(input.defaultCountry) ?? COMMERCE_COUNTRY_DEFAULT;
  return {
    country: fallback,
    profileCountry: null,
    locale,
    countrySource: null,
    source: 'default',
  };
}

export function shouldRefreshLocation(input: {
  lastLocationCheckAt: string | null | undefined;
  nowMs?: number;
  cooldownMs?: number;
}): boolean {
  const last = input.lastLocationCheckAt?.trim();
  if (!last) return true;
  const parsed = Date.parse(last);
  if (!Number.isFinite(parsed)) return true;
  const now = input.nowMs ?? Date.now();
  const cooldown = input.cooldownMs ?? LOCATION_CHECK_COOLDOWN_MS;
  return now - parsed >= cooldown;
}

/** Display label for settings; unknown codes fall back to the ISO code. */
export function commerceCountryLabel(code: string | null | undefined): string {
  const normalized = normalizeIso2Country(code);
  if (!normalized) return 'Not set';
  const labels: Record<string, string> = {
    IN: 'India',
    US: 'United States',
    GB: 'United Kingdom',
    CA: 'Canada',
    AU: 'Australia',
    DE: 'Germany',
    FR: 'France',
    AE: 'United Arab Emirates',
    SG: 'Singapore',
    JP: 'Japan',
  };
  return labels[normalized] ?? normalized;
}

export const LOCATION_PERMISSION_RATIONALE =
  'Mystash uses your location to show prices and merchant sites for your country.';
