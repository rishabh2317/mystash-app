import { getPipelineConfig } from '../config/pipelineConfig';
import type { ProductCandidate, StagePassResult } from '../domain/types';
import type { ExtractedPlaceMention } from '../place/parseReasonerPayload';
import { placeNameIsSpecific } from '../place/placeNameIsSpecific';
import { placeMaySearch, statedPlaceLocation } from '../place/placeMaySearch';

/** A venue does not prove the absence of merchandise. Keep the existing product
 * evidence budget, but independently publish grounded place identities immediately.
 * Missing places never introduce another AI/provider stage after the product gate closes. */
export function discoveryStageDecision(products: ProductCandidate[], places: ExtractedPlaceMention[], text: string) {
  const productGate = stagePass(products);
  const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const grounded = fold(text);
  const earlyPlaces = places.filter((p) => placeNameIsSpecific(p.name) && placeMaySearch(p)
    && (p.confidence ?? 0) >= getPipelineConfig().stagePassConfidence
    && Boolean(statedPlaceLocation(p)) && grounded.includes(fold(p.name))
    && grounded.includes(fold(statedPlaceLocation(p)!)));
  return {
    productGate,
    productsSettled: productGate.pass,
    placesSettled: places.length > 0 && earlyPlaces.length === places.length,
    earlyPlaces,
    needsSharedEnrichment: !productGate.pass,
    reason: productGate.pass ? 'products_ready_no_extra_ai_for_places'
      : earlyPlaces.length ? 'places_ready_products_need_evidence' : 'shared_evidence_needed',
  };
}

export function stagePass(products: ProductCandidate[]): StagePassResult {
  const cfg = getPipelineConfig();
  const maxConfidence = products.reduce((m, p) => Math.max(m, p.confidence), 0);
  const productCount = products.length;
  const pass =
    productCount >= cfg.minProducts && maxConfidence >= cfg.stagePassConfidence;
  return {
    pass,
    productCount,
    maxConfidence,
    reason: pass
      ? 'threshold_met'
      : productCount === 0
        ? 'no_products'
        : `max_confidence_${maxConfidence.toFixed(2)}_below_${cfg.stagePassConfidence}`,
  };
}

export function needsStage2Enrichment(params: {
  stage1Pass: boolean;
  transcriptAvailable: boolean;
  transcriptLength: number;
}): boolean {
  if (params.stage1Pass) return false;
  const cfg = getPipelineConfig();
  if (!params.transcriptAvailable || params.transcriptLength < cfg.transcriptMinChars) {
    return true;
  }
  return true; // stage1 failed gate
}
