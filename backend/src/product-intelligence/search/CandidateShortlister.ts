import type { SearchCandidate } from '../domain/types';
import { ingestLog } from '../../pipeline/ingestLog';
import { rankPdpCandidates, type PdpRankHints } from './PdpRanker';
import { classifyPdp } from './PdpClassifier';
import { classifyCandidatePage } from './CandidatePageClassifier';
import { mayEnterMetadataEnrichment } from './MetadataEnrichmentAdmissionPolicy';

export type ShortlistedCandidate = SearchCandidate & {
  pdpScore: number;
  pdpVerdict: NonNullable<SearchCandidate['pdpVerdict']>;
  sourceTier: NonNullable<SearchCandidate['sourceTier']>;
  sourceType: NonNullable<SearchCandidate['sourceType']>;
  pageType: NonNullable<SearchCandidate['pageType']>;
  capabilities: NonNullable<SearchCandidate['capabilities']>;
  /** @deprecated Compatibility projection. */
  candidatePageType: NonNullable<SearchCandidate['candidatePageType']>;
  /** @deprecated Compatibility projection. */
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
 * Classify and rank PDPs without truncating. Used to pick Official/Amazon
 * from the full discovery set, not only the enrichment shortlist.
 */
export function decoratePdpCandidates(
  candidates: SearchCandidate[],
  hints: PdpRankHints,
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
      title: candidate.title,
      expectedBrand: hints.brand,
    });
    if (
      !mayEnterMetadataEnrichment({
        url: candidate.merchantUrl,
        sourceTier: classification.sourceTier,
      })
    ) {
      continue;
    }

    const rankedCandidate = rankByUrl.get(candidate.merchantUrl);
    if (
      usage.capabilities.commerce &&
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
      sourceType: usage.sourceType,
      pageType: usage.pageType,
      capabilities: usage.capabilities,
      candidatePageType: usage.candidatePageType,
      shoppingEligible: usage.capabilities.commerce,
    });
  }

  decorated.sort((a, b) => {
    if (a.capabilities.commerce !== b.capabilities.commerce) {
      return a.capabilities.commerce ? -1 : 1;
    }
    return b.pdpScore - a.pdpScore;
  });
  return decorated;
}

/**
 * Keep multiple trusted PDPs for metadata enrichment.
 * Preserves the pre-capability enrichment admission policy while attaching
 * descriptive classification and capability data for downstream routing.
 */
export function shortlistPdpCandidates(
  candidates: SearchCandidate[],
  hints: PdpRankHints,
  maxCandidates: number,
): ShortlistedCandidate[] {
  const out = decoratePdpCandidates(candidates, hints).slice(0, maxCandidates);
  for (const shortlisted of out) {
    ingestLog('info', 'metadata.candidate.shortlisted', {
      svc: 'product-intelligence',
      host: hostOf(shortlisted.merchantUrl),
      merchantUrl: shortlisted.merchantUrl.slice(0, 160),
      sourceTier: shortlisted.sourceTier,
      sourceType: shortlisted.sourceType,
      pageType: shortlisted.pageType,
      metadataCapable: shortlisted.capabilities.metadata,
      commerceCapable: shortlisted.capabilities.commerce,
      pdpScore: shortlisted.pdpScore,
      pdpVerdict: shortlisted.pdpVerdict,
    });
  }

  return out;
}
