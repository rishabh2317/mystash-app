import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnv } from '../env';
import type { ShoppingSelectionConfig } from './shoppingConfig';

const DEFAULT_MERCHANT_PRIORITY = [
  'amazon',
  'official',
  'flipkart',
  'myntra',
  'ajio',
  'bestbuy',
  'merchant',
];

/**
 * Extensible shopping business configuration.
 * V1 source: backend config file (config/shopping.json).
 * Future sources (Campaign/Brand) can implement the same shape without
 * changing resolver precedence contracts.
 */
export type ShoppingProductOverride = {
  configuredBuyingUrl?: string | null;
  preferredMerchant?: string | null;
};

export type ShoppingConfiguration = {
  preferredMerchant: string | null;
  merchantPriority: string[];
  productOverrides: Record<string, ShoppingProductOverride>;
};

export type ResolvedShoppingSelection = {
  selection: ShoppingSelectionConfig;
  merchantPriority: string[];
  source: 'file' | 'default';
};

const DEFAULT_CONFIGURATION: ShoppingConfiguration = {
  preferredMerchant: null,
  merchantPriority: [...DEFAULT_MERCHANT_PRIORITY],
  productOverrides: {},
};

let cached: ShoppingConfiguration | null = null;
let cachedPath: string | null = null;
let testOverride = false;

/** Test / DI hook — clears memoized file load. */
export function resetShoppingConfigurationCache(): void {
  cached = null;
  cachedPath = null;
  testOverride = false;
}

/** Test / DI hook — inject configuration without a file. */
export function setShoppingConfigurationForTests(
  config: ShoppingConfiguration | null,
): void {
  cached = config;
  cachedPath = config ? '__test__' : null;
  testOverride = config != null;
}

export function shoppingConfigurationPath(): string {
  const fromEnv = getEnv('SHOPPING_CONFIG_PATH')?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), 'config', 'shopping.json');
}

function normalizePriority(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_MERCHANT_PRIORITY];
  const parsed = raw
    .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
    .filter(Boolean);
  return parsed.length ? parsed : [...DEFAULT_MERCHANT_PRIORITY];
}

function normalizeOverrides(raw: unknown): Record<string, ShoppingProductOverride> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ShoppingProductOverride> = {};
  for (const [productId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!productId.trim() || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const row = value as Record<string, unknown>;
    const configuredBuyingUrl =
      typeof row.configuredBuyingUrl === 'string' ? row.configuredBuyingUrl : null;
    const preferredMerchant =
      typeof row.preferredMerchant === 'string'
        ? row.preferredMerchant.trim().toLowerCase()
        : null;
    if (!configuredBuyingUrl && !preferredMerchant) continue;
    out[productId] = { configuredBuyingUrl, preferredMerchant };
  }
  return out;
}

function parseConfiguration(raw: unknown): ShoppingConfiguration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_CONFIGURATION, productOverrides: {} };
  }
  const obj = raw as Record<string, unknown>;
  const preferredMerchant =
    typeof obj.preferredMerchant === 'string'
      ? obj.preferredMerchant.trim().toLowerCase() || null
      : null;
  return {
    preferredMerchant,
    merchantPriority: normalizePriority(obj.merchantPriority),
    productOverrides: normalizeOverrides(obj.productOverrides),
  };
}

/**
 * Load ShoppingConfiguration from the V1 file source.
 * Future Campaign/Brand adapters should return the same ShoppingConfiguration shape.
 */
export function loadShoppingConfiguration(options?: {
  path?: string;
  reload?: boolean;
}): ShoppingConfiguration {
  if (testOverride && cached && !options?.reload && !options?.path) {
    return cached;
  }
  const path = options?.path ?? shoppingConfigurationPath();
  if (!options?.reload && cached && cachedPath === path) {
    return cached;
  }
  if (!existsSync(path)) {
    cached = {
      ...DEFAULT_CONFIGURATION,
      productOverrides: {},
    };
    cachedPath = path;
    testOverride = false;
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    cached = parseConfiguration(parsed);
    cachedPath = path;
    testOverride = false;
    return cached;
  } catch {
    cached = {
      ...DEFAULT_CONFIGURATION,
      productOverrides: {},
    };
    cachedPath = path;
    testOverride = false;
    return cached;
  }
}

/**
 * Resolve per-product selection inputs for shopping precedence.
 * File product overrides are authoritative for V1 configured URLs.
 * Optional metadata.shoppingSelection remains a lower-precedence extension
 * surface (ownership preserved; not the V1 write path).
 */
export function resolveShoppingSelectionForProduct(
  catalogProductId: string | null | undefined,
  metadata?: Record<string, unknown> | null,
  options?: { configuration?: ShoppingConfiguration },
): ResolvedShoppingSelection {
  const configuration = options?.configuration ?? loadShoppingConfiguration();
  const override =
    catalogProductId && configuration.productOverrides[catalogProductId]
      ? configuration.productOverrides[catalogProductId]
      : null;

  const metaRaw =
    metadata && typeof metadata === 'object' ? metadata.shoppingSelection : null;
  const meta =
    metaRaw && typeof metaRaw === 'object' && !Array.isArray(metaRaw)
      ? (metaRaw as Record<string, unknown>)
      : null;
  const metaConfigured =
    typeof meta?.configuredBuyingUrl === 'string' ? meta.configuredBuyingUrl : null;
  const metaPreferred =
    typeof meta?.preferredMerchant === 'string'
      ? meta.preferredMerchant.trim().toLowerCase()
      : null;

  return {
    selection: {
      configuredBuyingUrl: override?.configuredBuyingUrl ?? metaConfigured,
      preferredMerchant:
        override?.preferredMerchant ??
        configuration.preferredMerchant ??
        metaPreferred,
    },
    merchantPriority: configuration.merchantPriority,
    source: 'file',
  };
}
