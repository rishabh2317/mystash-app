import type { MatchScoreResult, NormalizedProduct, SearchCandidate } from '../domain/types';

export class MatchScorer {
  score(ai: NormalizedProduct, candidate: SearchCandidate): MatchScoreResult {
    const title = candidate.title.toLowerCase();
    const norm = ai.normalizedName;
    const titleTokens = new Set(title.split(/\s+/).filter(Boolean));
    const normTokens = norm.split(/\s+/).filter(Boolean);
    let overlap = 0;
    for (const t of normTokens) if (titleTokens.has(t)) overlap += 1;
    const titleScore = normTokens.length ? overlap / normTokens.length : 0;

    let brandScore = 0;
    if (ai.normalizedBrand && title.includes(ai.normalizedBrand)) brandScore = 1;
    else if (ai.brand && candidate.merchant?.toLowerCase().includes(ai.brand.toLowerCase())) {
      brandScore = 0.4;
    }

    let modelScore = 0;
    if (ai.model && title.includes(ai.model.toLowerCase())) modelScore = 1;

    const candidateScore = Math.min(1, Math.max(0, candidate.score));
    const score =
      0.45 * titleScore + 0.25 * brandScore + 0.15 * modelScore + 0.15 * candidateScore;

    const reason = `title=${titleScore.toFixed(2)} brand=${brandScore.toFixed(2)} model=${modelScore.toFixed(2)}`;
    return {
      score,
      reason,
      matchConfidence: score,
      components: {
        title: titleScore,
        brand: brandScore,
        model: modelScore,
        candidate: candidateScore,
      },
    };
  }

  pickBest(
    ai: NormalizedProduct,
    candidates: SearchCandidate[],
    minScore: number,
  ): { candidate: SearchCandidate; match: MatchScoreResult } | null {
    let best: { candidate: SearchCandidate; match: MatchScoreResult } | null = null;
    for (const c of candidates) {
      const match = this.score(ai, c);
      if (match.score < minScore) continue;
      if (!best || match.score > best.match.score) best = { candidate: c, match };
    }
    return best;
  }
}
