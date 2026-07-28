import { getPipelineConfig } from '../config/pipelineConfig';
import type { MultimodalContext, ProductCandidate, ProductEvidence } from '../domain/types';

function evidenceOf(p: ProductCandidate): ProductEvidence {
  if (typeof p.evidence === 'string') {
    return {
      summary: p.evidence,
      frames: [],
      frameCount: 0,
      logoHits: [],
      transcriptMentions: false,
      ocrMentions: false,
    };
  }
  return p.evidence;
}

/**
 * Deterministic ranking for dock / review display order.
 */
export class ProductRanker {
  rank(products: ProductCandidate[], ctx: MultimodalContext): ProductCandidate[] {
    const cfg = getPipelineConfig();
    const sceneLabel = (ctx.media?.scene?.label ?? '').toLowerCase();

    const scored = products.map((p) => {
      const ev = evidenceOf(p);
      const visibility = Math.min(1, (ev.frameCount || ev.frames.length || 0) / 3);
      const transcript = ev.transcriptMentions || p.sources.includes('TRANSCRIPT') ? 1 : 0;
      const ocr = ev.ocrMentions || p.sources.includes('OCR') ? 1 : 0;
      const logo = ev.logoHits.length > 0 || p.sources.includes('LOGO') ? 1 : 0;
      const scene =
        sceneLabel && p.category && sceneLabel.includes(p.category.slice(0, 4))
          ? 1
          : p.sources.includes('SCENE')
            ? 0.6
            : 0;

      const score =
        cfg.rankWeightConfidence * p.confidence +
        cfg.rankWeightVisibility * visibility +
        cfg.rankWeightTranscript * transcript +
        cfg.rankWeightOcr * ocr +
        cfg.rankWeightLogo * logo +
        cfg.rankWeightScene * scene;

      return { p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s, i) => ({ ...s.p, sortOrder: i }));
  }
}
