import type { SearchCandidate } from '../domain/types';
import { ingestLog } from '../../pipeline/ingestLog';
import { rankPdpCandidates, type PdpRankHints } from './PdpRanker';
import { classifyPdp } from './PdpClassifier';
import { classifyCandidatePage } from './CandidatePageClassifier';

export type ShortlistedCandidate = SearchCandidate & {
  pdpScore: number;
  pdpVerdict: NonNullable<SearchCandidate['pdpVerdict']>;
  sourceTier: NonNullable<SearchCandidate['sourceTier']>;
  candidatePageType: NonNullable<SearchCandidate['candidatePageType']>;
  shoppingEligible: boolean;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Keep multiple trusted PDPs for metadata enrichment.
 * Rejects editorial / hard-negative / non-PDP verdicts before enrichment.
 */
export function shortlistPdpCandidates(
  candidates: SearchCandidate[],
  hints: PdpRankHints,
  maxCandidates: number,
): ShortlistedCandidate[] {
  const ranked = rankPdpCandidates(candidates, hints);
  const rankByUrl = new Map(ranked.map((candidate) => [candidate.merchantUrl, candidate]));
  const decorated: ShortlistedCandidate[] = [];

  for (const candidate of candidates) {
    const classification = classifyPdp({
      url: candidate.merchantUrl,
      title: candidate.title,
      snippet: candidate.snippet,
      expectedBrand: hints.brand,
    });
    const usage = classifyCandidatePage({
      url: candidate.merchantUrl,
      sourceTier: classification.sourceTier,
    });
    if (!usage.metadataEligible) continue;

    const rankedCandidate = rankByUrl.get(candidate.merchantUrl);
    if (
      usage.shoppingEligible &&
      (!rankedCandidate ||
        classification.verdict === 'not_pdp' ||
        !Number.isFinite(rankedCandidate.pdpScore) ||
        rankedCandidate.pdpScore < -20)
    ) {
      continue;
    }

    decorated.push({
      ...candidate,
      ...(rankedCandidate ?? {}),
      pdpScore: rankedCandidate?.pdpScore ?? classification.score * 100,
      pdpVerdict: classification.verdict,
      pdpReasons: classification.reasons,
      sourceTier: classification.sourceTier,
      candidatePageType: usage.pageType,
      shoppingEligible: usage.shoppingEligible,
    });
  }

  decorated.sort((a, b) => {
    if (a.shoppingEligible !== b.shoppingEligible) return a.shoppingEligible ? -1 : 1;
    return b.pdpScore - a.pdpScore;
  });

  const out = decorated.slice(0, maxCandidates);
  for (const shortlisted of out) {
    ingestLog('info', 'metadata.candidate.shortlisted', {
      svc: 'product-intelligence',
      host: hostOf(shortlisted.merchantUrl),
      merchantUrl: shortlisted.merchantUrl.slice(0, 160),
      sourceTier: shortlisted.sourceTier,
      candidatePageType: shortlisted.candidatePageType,
      shoppingEligible: shortlisted.shoppingEligible,
      pdpScore: shortlisted.pdpScore,
      pdpVerdict: shortlisted.pdpVerdict,
    });
  }

  return out;
}
