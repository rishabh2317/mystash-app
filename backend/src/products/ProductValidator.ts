import { createHash } from 'node:crypto';
import { getPipelineConfig } from '../config/pipelineConfig';
import type { EvidenceSource, ProductCandidate, ProductEvidence } from '../domain/types';

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function asEvidence(e: ProductCandidate['evidence']): ProductEvidence {
  if (typeof e === 'string') {
    return {
      summary: e,
      frames: [],
      frameCount: 0,
      logoHits: [],
      transcriptMentions: false,
      ocrMentions: false,
    };
  }
  return {
    summary: e?.summary ?? '',
    frames: Array.isArray(e?.frames) ? e.frames : [],
    frameCount: typeof e?.frameCount === 'number' ? e.frameCount : e?.frames?.length ?? 0,
    logoHits: Array.isArray(e?.logoHits) ? e.logoHits : [],
    transcriptMentions: !!e?.transcriptMentions,
    ocrMentions: !!e?.ocrMentions,
  };
}

/** Deterministic post-reasoner cleanup — no LLM. */
export class ProductValidator {
  validate(raw: ProductCandidate[]): ProductCandidate[] {
    const cfg = getPipelineConfig();
    const out: ProductCandidate[] = [];
    const seen = new Set<string>();

    for (const p of raw) {
      if (!p || typeof p.name !== 'string') continue;
      const name = p.name.trim();
      if (name.length < 2) continue;

      let confidence = Number(p.confidence);
      if (!Number.isFinite(confidence)) continue;
      confidence = Math.max(0, Math.min(1, confidence));
      if (confidence < cfg.reviewMinConfidence) continue;

      let category = (p.category ?? 'unknown').toString().trim().toLowerCase() || 'unknown';
      if (!cfg.categoryAllowlist.has(category)) category = 'unknown';

      let brand = p.brand == null || p.brand === '' ? null : String(p.brand).trim();
      const sources = Array.isArray(p.sources)
        ? (p.sources.filter(Boolean) as EvidenceSource[])
        : [];
      const evidence = asEvidence(p.evidence);
      const hasLogo = sources.includes('LOGO') || evidence.logoHits.length > 0;
      if (brand && !hasLogo && sources.includes('VISION') && !sources.includes('OCR')) {
        // Prefer null brand when only weak visual inference and no logo evidence
        if (confidence < cfg.autoApproveConfidence) brand = null;
      }

      const key = `${normalizeName(name)}|${(brand ?? '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const externalId =
        p.externalId ??
        `p_${createHash('sha256').update(`${name}:${brand ?? ''}:${category}`).digest('hex').slice(0, 20)}`;

      out.push({
        ...p,
        name,
        category,
        brand,
        model: p.model == null || p.model === '' ? null : String(p.model).trim(),
        confidence,
        sources,
        evidence,
        externalId,
        includeByDefault: confidence >= cfg.autoApproveConfidence,
        merchantUrl: p.merchantUrl?.startsWith('http') ? p.merchantUrl : undefined,
        price: p.price && /\d/.test(p.price) ? p.price : '—',
        currency: p.currency ?? 'USD',
      });

      if (out.length >= cfg.maxProductsPerIngest) break;
    }

    return out;
  }
}
