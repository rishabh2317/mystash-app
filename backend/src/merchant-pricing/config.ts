import { getEnv } from '../env';

function num(key: string, fallback: number): number {
  const raw = getEnv(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(key: string, fallback: string): string {
  return getEnv(key)?.trim() || fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = getEnv(key)?.trim().toLowerCase();
  if (raw == null || raw === '') return fallback;
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return fallback;
}

export type MerchantPricingConfig = {
  /** Hard timeout per merchant outbound request. */
  perMerchantTimeoutMs: number;
  /** Max parallel merchant fetches per live-prices call. */
  maxConcurrency: number;
  /** Cap offers refreshed per Product Page open. */
  maxOffersPerPage: number;
  /** Short dedupe/cache window to prevent stampede. */
  cacheTtlMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  /** When true, attempt pluggable browser fallback after HTTP parse failure. */
  browserFallbackEnabled: boolean;
  /** App default country (ISO 3166-1 alpha-2). */
  defaultCountry: string;
};

let cached: MerchantPricingConfig | null = null;

export function getMerchantPricingConfig(): MerchantPricingConfig {
  if (cached) return cached;
  cached = {
    perMerchantTimeoutMs: Math.max(1_000, num('MERCHANT_PRICING_TIMEOUT_MS', 8_000)),
    maxConcurrency: Math.max(1, num('MERCHANT_PRICING_MAX_CONCURRENCY', 3)),
    maxOffersPerPage: Math.max(1, num('MERCHANT_PRICING_MAX_OFFERS', 8)),
    cacheTtlMs: Math.max(5_000, num('MERCHANT_PRICING_CACHE_TTL_MS', 45_000)),
    maxResponseBytes: Math.max(50_000, num('MERCHANT_PRICING_MAX_BYTES', 900_000)),
    maxRedirects: Math.max(0, num('MERCHANT_PRICING_MAX_REDIRECTS', 5)),
    browserFallbackEnabled: bool('MERCHANT_PRICING_BROWSER_FALLBACK', false),
    defaultCountry: str('MERCHANT_PRICING_DEFAULT_COUNTRY', 'IN').toUpperCase().slice(0, 2),
  };
  return cached;
}

/** Reset cached config (tests). */
export function resetMerchantPricingConfigCache(): void {
  cached = null;
}
