import { normalizeCountryCode } from '../../merchant-pricing/country';
import { isAmazonMarketplaceHost } from '../../shopping/productUrlIdentity';

/**
 * Regional Amazon site hosts for discovery queries (site: constraints).
 * Does not rewrite stored URLs — only guides Serper/CSE toward the right TLDs.
 */
const AMAZON_SITE_BY_COUNTRY: Record<string, string> = {
  IN: 'amazon.in',
  US: 'amazon.com',
  GB: 'amazon.co.uk',
  UK: 'amazon.co.uk',
  CA: 'amazon.ca',
  DE: 'amazon.de',
  FR: 'amazon.fr',
  IT: 'amazon.it',
  ES: 'amazon.es',
  JP: 'amazon.co.jp',
  AU: 'amazon.com.au',
  AE: 'amazon.ae',
  SG: 'amazon.sg',
  BR: 'amazon.com.br',
  MX: 'amazon.com.mx',
};

/**
 * Extra marketplace site: hints for country-aware preferred discovery.
 * Kept small — complements Amazon + Official, does not replace Serper recall.
 */
const MARKETPLACE_SITES_BY_COUNTRY: Record<string, string[]> = {
  IN: ['flipkart.com', 'myntra.com', 'ajio.com', 'croma.com'],
  US: ['walmart.com', 'target.com', 'bestbuy.com'],
  GB: ['johnlewis.com', 'argos.co.uk', 'currys.co.uk'],
};

/** Default when profile country is missing — matches merchant-pricing fallback. */
export const DISCOVERY_COUNTRY_FALLBACK = 'IN';

export function resolveDiscoveryCountry(country: string | null | undefined): string {
  return normalizeCountryCode(country) ?? DISCOVERY_COUNTRY_FALLBACK;
}

/**
 * Amazon site host for discovery `site:` queries.
 * Unspecified country preserves legacy creator behavior (`amazon.com`).
 * User-import always passes a resolved country (default IN).
 */
export function amazonSiteHostForCountry(country: string | null | undefined): string {
  const code = normalizeCountryCode(country);
  if (!code) return 'amazon.com';
  return AMAZON_SITE_BY_COUNTRY[code] ?? 'amazon.com';
}

export function marketplaceSiteHostsForCountry(country: string | null | undefined): string[] {
  const code = normalizeCountryCode(country);
  if (!code) return [];
  return MARKETPLACE_SITES_BY_COUNTRY[code] ?? [];
}

export function hostOfMerchantUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** True when the URL host matches the Amazon site preferred for this country. */
export function isCountryPreferredAmazonHost(
  url: string,
  country: string | null | undefined,
): boolean {
  const host = hostOfMerchantUrl(url);
  if (!host || !isAmazonMarketplaceHost(host)) return false;
  const preferred = amazonSiteHostForCountry(country);
  return host === preferred || host.endsWith(`.${preferred}`);
}

/**
 * True when a known marketplace host is a reasonable match for the discovery country.
 * Unknown/official hosts return true (do not exclude brand sites).
 */
export function hostAlignsWithDiscoveryCountry(
  url: string,
  country: string | null | undefined,
): boolean {
  const host = hostOfMerchantUrl(url);
  if (!host) return false;
  if (isAmazonMarketplaceHost(host)) {
    return isCountryPreferredAmazonHost(url, country);
  }
  const preferredSites = marketplaceSiteHostsForCountry(country);
  if (!preferredSites.length) return true;
  const isKnownForeignMarketplace =
    /(^|\.)(walmart\.|target\.|bestbuy\.|flipkart\.|myntra\.|ajio\.|croma\.|argos\.|currys\.|johnlewis\.)/i.test(
      host,
    );
  if (!isKnownForeignMarketplace) return true;
  return preferredSites.some((site) => host === site || host.endsWith(`.${site}`));
}
