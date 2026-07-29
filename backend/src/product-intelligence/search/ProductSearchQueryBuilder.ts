import type { AiDraftInput, NormalizedProduct } from '../domain/types';

export type ProductSearchQuery = {
  query: string;
  terms: string[];
  reasons: string[];
};

const STOP = new Set([
  'the', 'and', 'with', 'from', 'seen', 'video', 'youtube', 'instagram',
  'product', 'item', 'this', 'that', 'for', 'review', 'using', 'wearing',
]);

function addUnique(target: string[], value: string | null | undefined): void {
  const clean = value?.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const lower = clean.toLowerCase();
  if (!target.some((v) => v.toLowerCase() === lower)) target.push(clean);
}

function contextTerms(text: string | null | undefined, max = 4): string[] {
  if (!text) return [];
  return text
    .replace(/[^a-zA-Z0-9+\- ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t.toLowerCase()))
    .filter((t, i, all) => all.findIndex((v) => v.toLowerCase() === t.toLowerCase()) === i)
    .slice(0, max);
}

/** Builds a bounded, deterministic commerce query from persisted extraction context. */
export function buildProductSearchQuery(
  draft: AiDraftInput,
  product: NormalizedProduct,
): ProductSearchQuery {
  const terms: string[] = [];
  const reasons: string[] = [];
  addUnique(terms, product.brand);
  if (product.brand) reasons.push('brand');

  const nameWithoutBrand =
    product.brand && product.name.toLowerCase().startsWith(`${product.brand.toLowerCase()} `)
      ? product.name.slice(product.brand.length).trim()
      : product.name;
  addUnique(terms, nameWithoutBrand || product.name);
  reasons.push('name');

  if (product.model && !(nameWithoutBrand || product.name).toLowerCase().includes(product.model.toLowerCase())) {
    addUnique(terms, product.model);
    reasons.push('model');
  } else if (product.model) {
    reasons.push('model');
  }

  const logos = Array.isArray(draft.evidence?.logoHits)
    ? draft.evidence.logoHits.filter((v): v is string => typeof v === 'string')
    : [];
  for (const logo of logos.slice(0, 2)) addUnique(terms, logo);
  if (logos.length) reasons.push('logo');

  const summary = typeof draft.evidence?.summary === 'string' ? draft.evidence.summary : null;
  const context = [
    ...contextTerms(summary, 3),
    ...contextTerms(draft.reasoning, 2),
    ...contextTerms(draft.videoTitle, 2),
  ];
  for (const term of context) {
    if (terms.join(' ').toLowerCase().includes(term.toLowerCase())) continue;
    addUnique(terms, term);
    if (terms.length >= 8) break;
  }
  if (context.length) reasons.push('multimodal_context');

  if (product.category && product.category !== 'unknown' && terms.length < 8) {
    addUnique(terms, product.category);
    reasons.push('category');
  }
  addUnique(terms, 'product');
  return { query: terms.join(' '), terms, reasons };
}
