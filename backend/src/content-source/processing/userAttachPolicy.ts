import type { ContentSourceProductRecord } from '../domain/types';

/**
 * Resolver decisions that may become a Stash product.
 * Anything else — including weak identity, AI fallback, empty search, and
 * specificity rejection — must stay unbound.
 */
export const ATTACHABLE_USER_DECISIONS = new Set([
  'local_hit',
  'created_verified',
  'updated_verified',
  'created_metadata_only',
  'updated_metadata_only',
]);

const VIDEO_EVIDENCE_SOURCES = new Set(['TRANSCRIPT', 'OCR', 'LOGO', 'METADATA']);

export function isAttachableUserDecision(decision: string | null | undefined): boolean {
  return typeof decision === 'string' && ATTACHABLE_USER_DECISIONS.has(decision);
}

/**
 * Video reasoner output is a hypothesis. It may be resolved only when some
 * non-vision source named the product. A merchant page extracted only by the
 * GPT fallback is not evidence enough to resolve.
 */
export function hypothesisMayResolve(product: ContentSourceProductRecord): boolean {
  if (product.extractionMethod === 'merchant_enrichment') {
    return product.evidence?.identitySource !== 'tavily_gpt';
  }
  return product.sources.some((source) => VIDEO_EVIDENCE_SOURCES.has(source));
}
