import type { MatchScoreResult, NormalizedProduct, SearchCandidate } from '../domain/types';
import { normalizeProductIdentityTokens } from '../normalizer/ProductIdentityCanonicalizer';

function identityTokenSet(value: string | null | undefined): Set<string> {
  return new Set(normalizeProductIdentityTokens(value).map((token) => token.toLowerCase()));
}

function tokenOverlapScore(needles: string[], haystack: Set<string>): number {
  if (!needles.length) return 0;
  let hits = 0;
  for (const token of needles) {
    if (haystack.has(token.toLowerCase())) hits += 1;
  }
  return hits / needles.length;
}

export class MatchScorer {
  score(ai: NormalizedProduct, candidate: SearchCandidate): MatchScoreResult {
    const title = candidate.title.toLowerCase();
    const titleTokens = identityTokenSet(candidate.title);
    const normTokens = normalizeProductIdentityTokens(ai.normalizedName);
    const titleScore = tokenOverlapScore(normTokens, titleTokens);

    let brandScore = 0;
    const brandTokens = normalizeProductIdentityTokens(ai.normalizedBrand ?? ai.brand);
    if (brandTokens.length && tokenOverlapScore(brandTokens, titleTokens) === 1) brandScore = 1;
    else if (ai.normalizedBrand && title.includes(ai.normalizedBrand)) brandScore = 1;
    else if (ai.brand && candidate.merchant?.toLowerCase().includes(ai.brand.toLowerCase())) {
      brandScore = 0.4;
    }

    let modelScore = 0;
    const modelTokens = normalizeProductIdentityTokens(ai.model);
    if (modelTokens.length) modelScore = tokenOverlapScore(modelTokens, titleTokens);

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
