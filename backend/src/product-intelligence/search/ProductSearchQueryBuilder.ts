import type { AiDraftInput, NormalizedProduct } from '../domain/types';
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

/** Builds a compact, deterministic product query from persisted extraction context. */
export function buildProductSearchQuery(
  draft: AiDraftInput,
  product: NormalizedProduct,
): ProductSearchQuery {
  const terms: string[] = [];
  const reasons: string[] = [];
  addTokens(terms, product.brand);
  if (product.brand) reasons.push('brand');

  addTokens(terms, product.name);
  reasons.push('name');

  if (product.model) {
    addTokens(terms, product.model);
    reasons.push('model');
  }

  const logos = Array.isArray(draft.evidence?.logoHits)
    ? draft.evidence.logoHits.filter((v): v is string => typeof v === 'string')
    : [];
  for (const logo of logos.slice(0, 2)) addTokens(terms, logo);
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
  const bounded = terms.slice(0, 6);
  return { query: bounded.join(' '), terms: bounded, reasons };
}
