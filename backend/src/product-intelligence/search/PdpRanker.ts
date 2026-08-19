import type { SearchCandidate } from '../domain/types';
import { classifyCandidatePage } from './CandidatePageClassifier';
import { classifyPdp } from './PdpClassifier';

export type PdpRankHints = {
  brand?: string | null;
  name?: string | null;
  category?: string | null;
};

const MARKETPLACE_HOSTS: Array<{ match: RegExp; bonus: number }> = [
  { match: /(^|\.)amazon\./i, bonus: 95 },
  { match: /(^|\.)flipkart\./i, bonus: 95 },
  { match: /(^|\.)myntra\./i, bonus: 95 },
  { match: /(^|\.)ajio\./i, bonus: 90 },
  { match: /(^|\.)nykaa\./i, bonus: 90 },
  { match: /(^|\.)walmart\./i, bonus: 90 },
  { match: /(^|\.)bestbuy\./i, bonus: 88 },
  { match: /(^|\.)target\./i, bonus: 85 },
  { match: /(^|\.)ebay\./i, bonus: 70 },
];

const PENALTY_HOSTS: Array<{ match: RegExp; penalty: number }> = [
  { match: /(youtube\.com|youtu\.be)/i, penalty: -50 },
  { match: /(reddit\.com)/i, penalty: -100 },
  { match: /(wikipedia\.org)/i, penalty: -80 },
  { match: /(facebook\.com|instagram\.com|twitter\.com|x\.com|pinterest\.com)/i, penalty: -90 },
  { match: /(blogspot\.|medium\.com|quora\.com)/i, penalty: -100 },
  { match: /(cnn\.com|bbc\.|nytimes\.|theverge\.com|techcrunch\.com|wired\.com)/i, penalty: -80 },
  { match: /(rtings\.com|wirecutter|reviewed\.com|tomsguide|cnet\.com\/reviews)/i, penalty: -70 },
];

function brandSlug(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function tokenOverlapScore(haystack: string, needle: string): number {
  const h = new Set(
    haystack
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
  const tokens = needle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!tokens.length) return 0;
  let hit = 0;
  for (const t of tokens) if (h.has(t)) hit += 1;
  return hit / tokens.length;
}

/**
 * Rank Serper PDP URLs using AI brand / name / category before any metadata extraction.
 * Higher raw score = better. Scores are relative (not 0–1).
 */
export function scorePdpCandidate(candidate: SearchCandidate, hints: PdpRankHints): number {
  const classification = classifyPdp({
    url: candidate.merchantUrl,
    title: candidate.title,
    snippet: candidate.snippet,
    expectedBrand: hints.brand,
  });
  if (classification.hardNegative) return Number.NEGATIVE_INFINITY;
  const host = hostOf(candidate.merchantUrl);
  const title = candidate.title || '';
  let score = 0;

  for (const p of PENALTY_HOSTS) {
    if (p.match.test(host) || p.match.test(candidate.merchantUrl)) {
      score += p.penalty;
    }
  }

  const brand = hints.brand?.trim();
  let officialBrandDomain = false;
  if (brand) {
    const slug = brandSlug(brand);
    if (slug.length >= 2 && host.replace(/[^a-z0-9]/g, '').includes(slug)) {
      score += 120; // official / brand domain — always outranks marketplaces below
      officialBrandDomain = true;
    } else if (title.toLowerCase().includes(brand.toLowerCase())) {
      score += 3;
    }
  }

  if (!officialBrandDomain) {
    for (const m of MARKETPLACE_HOSTS) {
      if (m.match.test(host)) {
        score += m.bonus;
        break;
      }
    }
  }

  // Tie-breakers only — must not invert brand(+120) vs Amazon(+95)
  if (hints.name?.trim()) {
    score += Math.round(4 * tokenOverlapScore(`${title} ${host}`, hints.name));
  }

  if (hints.category?.trim()) {
    score += Math.round(2 * tokenOverlapScore(`${title} ${host} ${candidate.merchantUrl}`, hints.category));
  }

  score += Math.round(2 * Math.min(1, Math.max(0, candidate.score)));
  // Classifier contributes only as a tie-breaker; never invert brand vs marketplace.
  score += Math.round(classification.score * 8);

  return score;
}

export function rankPdpCandidates(
  candidates: SearchCandidate[],
  hints: PdpRankHints,
): Array<SearchCandidate & { pdpScore: number }> {
  return candidates
    .map((c) => {
      const classification = classifyPdp({
        url: c.merchantUrl,
        title: c.title,
        snippet: c.snippet,
        expectedBrand: hints.brand,
      });
      const pageClassification = classifyCandidatePage({
        url: c.merchantUrl,
        title: c.title,
        expectedBrand: hints.brand,
      });
      return {
        ...c,
        pdpScore: scorePdpCandidate(c, hints),
        pdpVerdict: classification.verdict,
        pdpReasons: classification.reasons,
        sourceTier: classification.sourceTier,
        sourceType: pageClassification.sourceType,
        pageType: pageClassification.pageType,
        capabilities: pageClassification.capabilities,
        candidatePageType: pageClassification.candidatePageType,
        shoppingEligible: pageClassification.capabilities.commerce,
      };
    })
    .filter((c) => Number.isFinite(c.pdpScore))
    .sort((a, b) => {
      const tierOrder = {
        OFFICIAL: 3,
        MARKETPLACE: 2,
        RETAILER: 1,
        SPECIFICATION: 0,
        REVIEW: 0,
        EDITORIAL: 0,
        NEWS: 0,
        FORUM: 0,
        SOCIAL: 0,
        VIDEO: 0,
        WIKI: 0,
        UNKNOWN: 0,
      };
      const tierDelta =
        tierOrder[b.sourceType ?? 'UNKNOWN'] - tierOrder[a.sourceType ?? 'UNKNOWN'];
      return tierDelta || b.pdpScore - a.pdpScore;
    });
}

export function pickBestPdpUrl(
  candidates: SearchCandidate[],
  hints: PdpRankHints,
  minScore = -20,
): (SearchCandidate & { pdpScore: number }) | null {
  const ranked = rankPdpCandidates(candidates, hints);
  const best = ranked[0];
  if (!best || best.pdpScore < minScore) return null;
  return best;
}
