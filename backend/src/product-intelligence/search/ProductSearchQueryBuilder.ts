import type { AiDraftInput, NormalizedProduct } from '../domain/types';
import { normalizeProductIdentityTokens } from '../normalizer/ProductIdentityCanonicalizer';
import { normalizeQueryTokens } from './QueryNormalizer';

export type ProductSearchQuery = {
  query: string;
  terms: string[];
  reasons: string[];
};

function addTokens(target: string[], value: string | null | undefined): void {
  for (const token of normalizeQueryTokens(value)) {
    if (!target.some((existing) => existing.toLowerCase() === token.toLowerCase())) {
      target.push(token);
    }
  }
}

function addIdentityTokens(
  target: string[],
  value: string | null | undefined,
): void {
  for (const token of normalizeProductIdentityTokens(value)) {
    if (!target.some((existing) => existing.toLowerCase() === token.toLowerCase())) {
      target.push(token);
    }
  }
}

/** Builds a compact, deterministic product query from persisted extraction context. */
export function buildProductSearchQuery(
  draft: AiDraftInput,
  product: NormalizedProduct,
  options?: { merchantOnly?: boolean },
): ProductSearchQuery {
  const terms: string[] = [];
  const reasons: string[] = [];
  addIdentityTokens(terms, product.brand);
  if (product.brand) reasons.push('brand');

  addIdentityTokens(terms, product.name);
  reasons.push('name');

  if (product.model) {
    addIdentityTokens(terms, product.model);
    reasons.push('model');
  }

  const logos = Array.isArray(draft.evidence?.logoHits)
    ? draft.evidence.logoHits.filter((v): v is string => typeof v === 'string')
    : [];
  for (const logo of logos.slice(0, 2)) addIdentityTokens(terms, logo);
  if (logos.length) reasons.push('logo');

  const summary = typeof draft.evidence?.summary === 'string' ? draft.evidence.summary : null;
  const context = [summary, draft.reasoning, draft.videoTitle]
    .flatMap((value) => normalizeQueryTokens(value))
    .filter((token) => /\d/.test(token) || /^[A-Z0-9-]{3,}$/.test(token))
    .slice(0, 2);
  for (const token of context) {
    addTokens(terms, token);
  }
  if (context.length) reasons.push('multimodal_context');

  if (product.category && product.category !== 'unknown' && terms.length < 4) {
    addTokens(terms, product.category);
    reasons.push('category');
  }
  // Image discovery retains its original query. Shopping reserves the complete
  // explicit model before spending the remaining budget on descriptive words.
  const reserved: string[] = [];
  if (options?.merchantOnly) {
    addIdentityTokens(reserved, product.brand);
    addIdentityTokens(reserved, product.model);
  }
  const bounded = options?.merchantOnly
    ? [...reserved, ...terms.filter(t => !reserved.some(r => r.toLowerCase() === t.toLowerCase()))]
      .slice(0, Math.max(6, reserved.length))
    : terms.slice(0, 6);
  return { query: bounded.join(' '), terms: bounded, reasons };
}
