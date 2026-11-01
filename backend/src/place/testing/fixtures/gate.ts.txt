import { getPipelineConfig } from '../config/pipelineConfig';
import type { ProductCandidate, StagePassResult } from '../domain/types';

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
