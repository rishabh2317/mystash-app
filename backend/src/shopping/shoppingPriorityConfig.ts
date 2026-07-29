import { getEnv } from '../env';

/** Default commerce priority — independent of metadata quality ranking. */
export const DEFAULT_SHOPPING_PROVIDER_PRIORITY = [
  'amazon',
  'official',
  'flipkart',
  'myntra',
  'ajio',
  'bestbuy',
  'merchant',
] as const;

export type ShoppingProviderId = (typeof DEFAULT_SHOPPING_PROVIDER_PRIORITY)[number] | string;

export function getShoppingProviderPriority(): string[] {
  const raw = getEnv('SHOPPING_PROVIDER_PRIORITY')?.trim();
  if (!raw) return [...DEFAULT_SHOPPING_PROVIDER_PRIORITY];
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length ? parsed : [...DEFAULT_SHOPPING_PROVIDER_PRIORITY];
}

export function classifyShoppingProvider(
  url: string,
  sourceTier?: 'official' | 'marketplace' | 'retailer' | 'editorial' | null,
): ShoppingProviderId {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return 'merchant';
  }

  if (/(^|\.)amazon\./i.test(host)) return 'amazon';
  if (/(^|\.)flipkart\./i.test(host)) return 'flipkart';
  if (/(^|\.)myntra\./i.test(host)) return 'myntra';
  if (/(^|\.)ajio\./i.test(host)) return 'ajio';
  if (/(^|\.)nykaa\./i.test(host)) return 'nykaa';
  if (/(^|\.)bestbuy\./i.test(host)) return 'bestbuy';
  if (/(^|\.)walmart\./i.test(host)) return 'walmart';
  if (/(^|\.)target\./i.test(host)) return 'target';
  if (/(^|\.)decathlon\./i.test(host)) return 'decathlon';
  if (/(^|\.)rei\./i.test(host)) return 'rei';
  if (sourceTier === 'official') return 'official';
  return 'merchant';
}
