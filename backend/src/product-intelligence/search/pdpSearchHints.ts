import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiDraftInput } from '../domain/types';
import { ProductNormalizer } from '../normalizer/ProductNormalizer';
import type { PdpRankHints } from './PdpRanker';

/** Per-draft identity hints for PDP ranking and enrichment. */
export const pdpSearchHintsAls = new AsyncLocalStorage<PdpRankHints>();

export function getPdpSearchHints(): PdpRankHints {
  return pdpSearchHintsAls.getStore() ?? {};
}

function filled(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Search, shortlist, and enrichment must see the caller’s expectation.
 * A raw query fills the name only when the expectation is empty. It never
 * replaces a brand, name, model, or category that was already set.
 */
export function identityExpectationForSearch(
  expectation: PdpRankHints | null | undefined,
  query?: string | null,
): PdpRankHints {
  const brand = filled(expectation?.brand);
  const name = filled(expectation?.name);
  const model = filled(expectation?.model);
  const category = filled(expectation?.category);
  const populated = Boolean(brand || name || model || category);
  return {
    brand,
    name: name ?? (populated ? null : filled(query)),
    model,
    category,
  };
}

const userIdentityNormalizer = new ProductNormalizer();

/**
 * The only identity expectation used for a User-import draft.
 * Shortlist, enrichment, and post-enrichment validation must see this object,
 * not an empty store and not the raw search query.
 */
export function userIdentityExpectation(draft: AiDraftInput): PdpRankHints {
  const norm = userIdentityNormalizer.normalize(draft);
  return {
    brand: norm.brand,
    name: norm.name,
    model: norm.model,
    category: norm.category === 'unknown' ? null : norm.category,
  };
}
