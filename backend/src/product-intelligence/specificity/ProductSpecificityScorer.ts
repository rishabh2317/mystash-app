import type { AiDraftInput, NormalizedProduct } from '../domain/types';

export type SpecificityAssessment = {
  score: number;
  decision: 'searchable' | 'review_only';
  reasons: string[];
};

const GENERIC_TERMS = new Set([
  'shoe', 'shoes', 'running shoe', 'running shoes', 'sneaker', 'sneakers',
  'jacket', 'coat', 'phone', 'smartphone', 'laptop', 'computer',
  'headphone', 'headphones', 'earbuds', 'watch', 'bag', 'backpack',
  'camera', 'tablet', 'television', 'tv', 'monitor', 'product', 'item',
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function evidenceSignals(evidence: Record<string, unknown> | null | undefined) {
  const logoHits = Array.isArray(evidence?.logoHits) ? evidence.logoHits.length : 0;
  return {
    logoHits,
    ocr: evidence?.ocrMentions === true,
    transcript: evidence?.transcriptMentions === true,
  };
}

/** Scores identity specificity independently from AI confidence. */
export function scoreProductSpecificity(
  draft: AiDraftInput,
  product: NormalizedProduct,
  threshold = 0.55,
): SpecificityAssessment {
  const reasons: string[] = [];
  const normalized = product.normalizedName.trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const generic = GENERIC_TERMS.has(normalized) || tokens.length <= 1;
  let score = generic ? 0.08 : 0.22;
  reasons.push(generic ? 'generic_category_name' : 'multi_token_name');

  if (product.brand) {
    score += 0.2;
    reasons.push('brand_present');
  }
  if (product.model && product.model.length >= 2) {
    score += 0.28;
    reasons.push('model_present');
  }
  if (tokens.some((t) => /\d/.test(t)) || /\d/.test(product.model ?? '')) {
    score += 0.16;
    reasons.push('identifier_token');
  }
  const distinctive = tokens.filter(
    (t) => t.length >= 3 && !GENERIC_TERMS.has(t) && t !== product.normalizedBrand,
  );
  if (distinctive.length >= 2) {
    score += 0.12;
    reasons.push('distinctive_product_line');
  }
  if (product.merchantUrlHint) {
    score += 0.55;
    reasons.push('explicit_merchant_url');
  }
  const evidence = evidenceSignals(draft.evidence);
  if (evidence.logoHits > 0) {
    score += 0.08;
    reasons.push('logo_evidence');
  }
  if (evidence.ocr) {
    score += 0.06;
    reasons.push('ocr_evidence');
  }
  if (evidence.transcript) {
    score += 0.04;
    reasons.push('transcript_evidence');
  }

  score = clamp01(score);
  return {
    score,
    decision: score >= threshold ? 'searchable' : 'review_only',
    reasons,
  };
}
