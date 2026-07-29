import type { CandidatePageType, SearchCandidate } from '../domain/types';
import { scoreCandidateDecisions } from '../scoring/CandidateScoring';
import { classifyCandidatePage } from '../search/CandidatePageClassifier';
import {
  computeWeightedMetadataCompleteness,
  validPriceValue,
} from './MetadataQuality';

export { validPriceValue } from './MetadataQuality';

export type MetadataFieldSource = {
  value: unknown;
  source: string;
  confidence: number;
  metadataScore: number;
};

export type MergedProductMetadata = {
  title: string | null;
  brand: string | null;
  description: string | null;
  shortDescription: string | null;
  heroImage: string | null;
  gallery: string[];
  specifications: Record<string, string>;
  price: string | null;
  currency: string | null;
  availability: string | null;
  merchant: string | null;
  metadataSources: string[];
  metadataSourceMap: Record<string, MetadataFieldSource>;
  metadataCompleteness: number;
};

type FieldName =
  | 'title'
  | 'brand'
  | 'description'
  | 'shortDescription'
  | 'heroImage'
  | 'gallery'
  | 'specifications'
  | 'price'
  | 'currency'
  | 'availability'
  | 'merchant';

const FIELD_AUTHORITY_PRIORITY: Record<
  'title' | 'description' | 'gallery' | 'specifications',
  Record<CandidatePageType, number>
> = {
  title: {
    official_product: 400,
    marketplace_pdp: 300,
    retailer_pdp: 200,
    review_site: 100,
    comparison_site: 80,
    official_brand_news: 60,
  },
  description: {
    official_product: 400,
    retailer_pdp: 300,
    marketplace_pdp: 220,
    review_site: 100,
    comparison_site: 80,
    official_brand_news: 60,
  },
  gallery: {
    official_product: 400,
    retailer_pdp: 300,
    marketplace_pdp: 220,
    review_site: 80,
    comparison_site: 60,
    official_brand_news: 50,
  },
  specifications: {
    official_product: 400,
    retailer_pdp: 300,
    marketplace_pdp: 220,
    review_site: 100,
    comparison_site: 80,
    official_brand_news: 50,
  },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return 'unknown';
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pageType(candidate: SearchCandidate): CandidatePageType {
  return (
    candidate.candidatePageType ??
    classifyCandidatePage({
      url: candidate.merchantUrl,
      sourceTier: candidate.sourceTier,
    }).pageType
  );
}

function specsOf(candidate: SearchCandidate): Record<string, string> {
  const raw = candidate.enrichmentMeta?.specifications;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim(),
    ),
  );
}

function galleryOf(candidate: SearchCandidate): string[] {
  const raw = candidate.enrichmentMeta?.gallery;
  const gallery = Array.isArray(raw)
    ? raw.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
    : [];
  if (candidate.image && /^https?:\/\//i.test(candidate.image)) gallery.unshift(candidate.image);
  return [...new Set(gallery)];
}

function extractedAt(candidate: SearchCandidate): number {
  const raw =
    candidate.enrichmentMeta?.price_last_verified_at ?? candidate.enrichmentMeta?.extracted_at;
  if (typeof raw !== 'string') return 0;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function fieldPriority(
  field: keyof typeof FIELD_AUTHORITY_PRIORITY,
  candidate: SearchCandidate,
): number {
  return FIELD_AUTHORITY_PRIORITY[field][pageType(candidate)];
}

function recordProvenance(
  map: Record<string, MetadataFieldSource>,
  field: FieldName,
  candidate: SearchCandidate,
  value: unknown,
  fieldScore: number,
): void {
  const scores = scoreCandidateDecisions(candidate);
  map[field] = {
    value,
    source: hostOf(candidate.merchantUrl),
    confidence: Math.max(0, Math.min(1, fieldScore / 500)),
    metadataScore: candidate.metadataScore ?? scores.metadataScore,
  };
}

function bestText(
  candidates: SearchCandidate[],
  field: 'title' | 'description',
  read: (candidate: SearchCandidate) => string | null,
): { candidate: SearchCandidate; value: string; score: number } | null {
  let best: { candidate: SearchCandidate; value: string; score: number } | null = null;
  for (const candidate of candidates) {
    const value = read(candidate);
    if (!value) continue;
    const base = candidate.metadataScore ?? scoreCandidateDecisions(candidate).metadataScore;
    const quality = Math.min(30, value.length / (field === 'title' ? 4 : 20));
    const score = fieldPriority(field, candidate) + base + quality;
    if (!best || score > best.score) best = { candidate, value, score };
  }
  return best;
}

/** Field-specific merge. Shopping scores are never read here. */
export function mergeEnrichedCandidates(candidates: SearchCandidate[]): MergedProductMetadata {
  const enriched = candidates.filter((candidate) => candidate.enrichmentSucceeded === true);
  const provenance: Record<string, MetadataFieldSource> = {};
  const metadataSources = [...new Set(enriched.map((candidate) => hostOf(candidate.merchantUrl)))];

  const titleWinner = bestText(enriched, 'title', (candidate) => text(candidate.title));
  const descriptionWinner = bestText(enriched, 'description', (candidate) =>
    text(candidate.description),
  );
  const shortDescriptionWinner = bestText(enriched, 'description', (candidate) =>
    text(candidate.enrichmentMeta?.short_description),
  );

  const simpleWinner = (
    read: (candidate: SearchCandidate) => string | null,
  ): { candidate: SearchCandidate; value: string; score: number } | null => {
    let winner: { candidate: SearchCandidate; value: string; score: number } | null = null;
    for (const candidate of enriched) {
      const value = read(candidate);
      if (!value) continue;
      const score = candidate.metadataScore ?? scoreCandidateDecisions(candidate).metadataScore;
      if (!winner || score > winner.score) winner = { candidate, value, score };
    }
    return winner;
  };

  const brandWinner = simpleWinner((candidate) => text(candidate.brand));
  const merchantWinner = simpleWinner((candidate) => text(candidate.merchant));

  let galleryWinner:
    | { candidate: SearchCandidate; value: string[]; score: number }
    | null = null;
  for (const candidate of enriched) {
    const gallery = galleryOf(candidate);
    if (!gallery.length) continue;
    const base = candidate.metadataScore ?? scoreCandidateDecisions(candidate).metadataScore;
    const score = fieldPriority('gallery', candidate) + base + Math.min(30, gallery.length * 5);
    if (!galleryWinner || score > galleryWinner.score) {
      galleryWinner = { candidate, value: gallery, score };
    }
  }

  let specsWinner:
    | { candidate: SearchCandidate; value: Record<string, string>; score: number }
    | null = null;
  for (const candidate of enriched) {
    const specifications = specsOf(candidate);
    const count = Object.keys(specifications).length;
    if (!count) continue;
    const base = candidate.metadataScore ?? scoreCandidateDecisions(candidate).metadataScore;
    const score =
      fieldPriority('specifications', candidate) + base + Math.min(40, count * 4);
    if (!specsWinner || score > specsWinner.score) {
      specsWinner = { candidate, value: specifications, score };
    }
  }

  let priceWinner:
    | { candidate: SearchCandidate; value: string; score: number }
    | null = null;
  for (const candidate of enriched) {
    const price = validPriceValue(candidate.price, candidate.currency);
    if (!price) continue;
    const base = candidate.metadataScore ?? scoreCandidateDecisions(candidate).metadataScore;
    const recency = extractedAt(candidate) / 1e12;
    const score = base + recency;
    if (!priceWinner || score > priceWinner.score) {
      priceWinner = { candidate, value: price, score };
    }
  }

  let availabilityWinner:
    | { candidate: SearchCandidate; value: string; score: number }
    | null = null;
  for (const candidate of enriched) {
    const availability = text(candidate.enrichmentMeta?.availability);
    if (!availability) continue;
    const score = candidate.metadataScore ?? scoreCandidateDecisions(candidate).metadataScore;
    if (!availabilityWinner || score > availabilityWinner.score) {
      availabilityWinner = { candidate, value: availability, score };
    }
  }

  if (titleWinner) {
    recordProvenance(
      provenance,
      'title',
      titleWinner.candidate,
      titleWinner.value,
      titleWinner.score,
    );
  }
  if (descriptionWinner) {
    recordProvenance(
      provenance,
      'description',
      descriptionWinner.candidate,
      descriptionWinner.value,
      descriptionWinner.score,
    );
  }
  if (shortDescriptionWinner) {
    recordProvenance(
      provenance,
      'shortDescription',
      shortDescriptionWinner.candidate,
      shortDescriptionWinner.value,
      shortDescriptionWinner.score,
    );
  }
  if (brandWinner) {
    recordProvenance(
      provenance,
      'brand',
      brandWinner.candidate,
      brandWinner.value,
      brandWinner.score,
    );
  }
  if (merchantWinner) {
    recordProvenance(
      provenance,
      'merchant',
      merchantWinner.candidate,
      merchantWinner.value,
      merchantWinner.score,
    );
  }
  if (galleryWinner) {
    recordProvenance(
      provenance,
      'gallery',
      galleryWinner.candidate,
      galleryWinner.value,
      galleryWinner.score,
    );
    recordProvenance(
      provenance,
      'heroImage',
      galleryWinner.candidate,
      galleryWinner.value[0],
      galleryWinner.score,
    );
  }
  if (specsWinner) {
    recordProvenance(
      provenance,
      'specifications',
      specsWinner.candidate,
      specsWinner.value,
      specsWinner.score,
    );
  }
  if (priceWinner) {
    recordProvenance(
      provenance,
      'price',
      priceWinner.candidate,
      priceWinner.value,
      priceWinner.score,
    );
    const currency = text(priceWinner.candidate.currency);
    if (currency) {
      recordProvenance(
        provenance,
        'currency',
        priceWinner.candidate,
        currency,
        priceWinner.score,
      );
    }
  }
  if (availabilityWinner) {
    recordProvenance(
      provenance,
      'availability',
      availabilityWinner.candidate,
      availabilityWinner.value,
      availabilityWinner.score,
    );
  }

  const gallery = galleryWinner?.value ?? [];
  const specifications = specsWinner?.value ?? {};
  const merged: MergedProductMetadata = {
    title: titleWinner?.value ?? null,
    brand: brandWinner?.value ?? null,
    description: descriptionWinner?.value ?? null,
    shortDescription: shortDescriptionWinner?.value ?? null,
    heroImage: gallery[0] ?? null,
    gallery,
    specifications,
    price: priceWinner?.value ?? null,
    currency: priceWinner ? text(priceWinner.candidate.currency) : null,
    availability: availabilityWinner?.value ?? null,
    merchant: merchantWinner?.value ?? null,
    metadataSources,
    metadataSourceMap: provenance,
    metadataCompleteness: 0,
  };
  merged.metadataCompleteness = computeWeightedMetadataCompleteness({
    title: merged.title,
    brand: merged.brand,
    gallery: merged.gallery,
    description: merged.description,
    price: merged.price,
    currency: merged.currency,
    availability: merged.availability,
    specifications: merged.specifications,
  });
  return merged;
}

export function requiredMetadataFieldsFilled(merged: MergedProductMetadata): boolean {
  return (
    merged.metadataCompleteness >= 90 &&
    Boolean(merged.title && merged.gallery.length && Object.keys(merged.specifications).length)
  );
}
