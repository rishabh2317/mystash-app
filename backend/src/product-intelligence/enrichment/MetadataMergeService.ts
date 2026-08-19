import type {
  CandidateClassification,
  PageCapabilities,
  SearchCandidate,
} from '../domain/types';
import {
  scoreCandidateDecisions,
  sourceAuthorityFor,
} from '../scoring/CandidateScoring';
import { classifyCandidatePage } from '../search/CandidatePageClassifier';
import {
  computeWeightedMetadataCompleteness,
  validPriceValue,
} from './MetadataQuality';
import {
  FIELD_TRUST_POLICY,
  type FieldTrustPolicyKey,
  type TrustRule,
} from './field-trust-policy';

export { validPriceValue } from './MetadataQuality';

export type MetadataFieldSource = {
  value: unknown;
  source: string;
  confidence: number;
  metadataScore: number;
  sourceType: CandidateClassification['sourceType'];
  pageType: CandidateClassification['pageType'];
  trustRank: number;
};

export type Offer = {
  price: string;
  currency: string | null;
  availability: string | null;
  merchant: string | null;
  merchantUrl: string;
  affiliateUrl: string | null;
  offerId: string | null;
};

export type EvidenceSource = {
  source: string;
  sourceType: CandidateClassification['sourceType'];
  pageType: CandidateClassification['pageType'];
  sourceAuthority: number;
};

export type MergedProductMetadata = {
  title: string | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  description: string | null;
  shortDescription: string | null;
  heroImage: string | null;
  gallery: string[];
  specifications: Record<string, string>;
  price: string | null;
  currency: string | null;
  availability: string | null;
  merchant: string | null;
  offer: Offer | null;
  metadataSources: string[];
  frameRefs: Array<string | number>;
  evidence: Record<string, unknown>;
  evidenceProvenance: Record<string, EvidenceSource[]>;
  metadataSourceMap: Record<string, MetadataFieldSource>;
  metadataCompleteness: number;
};

type Winner<T> = {
  candidate: SearchCandidate;
  classification: CandidateClassification;
  value: T;
  trustRank: number;
  policySize: number;
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

function classificationOf(candidate: SearchCandidate): CandidateClassification {
  if (candidate.sourceType && candidate.pageType && candidate.capabilities) {
    return {
      sourceType: candidate.sourceType,
      pageType: candidate.pageType,
      capabilities: candidate.capabilities,
    };
  }
  const classification = classifyCandidatePage({
    url: candidate.merchantUrl,
    sourceTier: candidate.sourceTier,
    title: candidate.title,
  });
  return {
    sourceType: classification.sourceType,
    pageType: classification.pageType,
    capabilities: classification.capabilities,
  };
}

function specsOf(candidate: SearchCandidate): Record<string, string> | null {
  const raw = candidate.enrichmentMeta?.specifications;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const specifications = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim(),
    ),
  );
  return Object.keys(specifications).length ? specifications : null;
}

function galleryOf(candidate: SearchCandidate): string[] | null {
  const raw = candidate.enrichmentMeta?.gallery;
  const gallery = Array.isArray(raw)
    ? raw.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
    : [];
  if (candidate.image && /^https?:\/\//i.test(candidate.image)) gallery.unshift(candidate.image);
  const unique = [...new Set(gallery)];
  return unique.length ? unique : null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function offerOf(candidate: SearchCandidate): Offer | null {
  const price = validPriceValue(candidate.price, candidate.currency);
  const merchantUrl = httpUrl(candidate.merchantUrl);
  if (!price || !merchantUrl) return null;

  return {
    price,
    currency: text(candidate.currency),
    availability: text(candidate.enrichmentMeta?.availability),
    merchant: text(candidate.merchant),
    merchantUrl,
    affiliateUrl:
      httpUrl(candidate.affiliateUrl) ??
      httpUrl(candidate.enrichmentMeta?.affiliateUrl) ??
      httpUrl(candidate.enrichmentMeta?.affiliate_url),
    offerId:
      text(candidate.offerId) ??
      text(candidate.enrichmentMeta?.offerId) ??
      text(candidate.enrichmentMeta?.offer_id),
  };
}

function matches(rule: TrustRule, classification: CandidateClassification): boolean {
  return (
    rule.sourceType === classification.sourceType &&
    rule.pageType === classification.pageType
  );
}

function pickByPolicy<T>(
  field: FieldTrustPolicyKey,
  candidates: SearchCandidate[],
  read: (candidate: SearchCandidate) => T | null,
  requiredCapability?: keyof PageCapabilities,
): Winner<T> | null {
  const policy = FIELD_TRUST_POLICY[field];
  for (let trustRank = 0; trustRank < policy.length; trustRank += 1) {
    const rule = policy[trustRank]!;
    for (const candidate of candidates) {
      const classification = classificationOf(candidate);
      if (!matches(rule, classification)) continue;
      if (requiredCapability && !classification.capabilities[requiredCapability]) continue;
      const value = read(candidate);
      if (value === null) continue;
      return {
        candidate,
        classification,
        value,
        trustRank,
        policySize: policy.length,
      };
    }
  }
  return null;
}

function recordProvenance<T>(
  map: Record<string, MetadataFieldSource>,
  field: string,
  winner: Winner<T> | null,
): void {
  if (!winner) return;
  const scores = scoreCandidateDecisions(winner.candidate);
  map[field] = {
    value: winner.value,
    source: hostOf(winner.candidate.merchantUrl),
    confidence: Math.max(0.5, 1 - winner.trustRank / Math.max(1, winner.policySize)),
    metadataScore: winner.candidate.metadataScore ?? scores.metadataScore,
    sourceType: winner.classification.sourceType,
    pageType: winner.classification.pageType,
    trustRank: winner.trustRank,
  };
}

function recordOfferFieldProvenance(
  map: Record<string, MetadataFieldSource>,
  field: keyof Offer,
  winner: Winner<Offer> | null,
): void {
  if (!winner || winner.value[field] === null) return;
  recordProvenance(map, field, {
    ...winner,
    value: winner.value[field],
  });
}

function unionArrayValues(
  candidates: SearchCandidate[],
  key: string,
): Array<string | number> {
  const values = candidates.flatMap((candidate) => {
    const value = candidate.enrichmentMeta?.[key];
    return Array.isArray(value)
      ? value.filter(
          (item): item is string | number =>
            typeof item === 'string' || typeof item === 'number',
        )
      : [];
  });
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function evidenceSource(candidate: SearchCandidate): EvidenceSource {
  const classification = classificationOf(candidate);
  return {
    source: hostOf(candidate.merchantUrl),
    sourceType: classification.sourceType,
    pageType: classification.pageType,
    sourceAuthority: sourceAuthorityFor(classification.sourceType),
  };
}

function addEvidenceProvenance(
  provenance: Record<string, EvidenceSource[]>,
  path: string,
  source: EvidenceSource,
): void {
  if (!path) return;
  const sources = provenance[path] ?? [];
  if (!sources.some((entry) => entry.source === source.source)) sources.push(source);
  provenance[path] = sources;
}

function arrayValueKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`;
  return `json:${JSON.stringify(value)}`;
}

/**
 * Evidence conflict policy:
 * - candidates are processed from highest to lowest source authority;
 * - primitive/type conflicts keep the existing higher-trust value;
 * - arrays are unioned in trust order;
 * - plain objects are merged recursively;
 * - every contributing source is retained per JSON-style field path.
 */
function mergeEvidenceValue(
  existing: unknown,
  incoming: unknown,
  path: string,
  source: EvidenceSource,
  provenance: Record<string, EvidenceSource[]>,
): unknown {
  addEvidenceProvenance(provenance, path, source);

  if (existing === undefined) {
    if (Array.isArray(incoming)) return [...incoming];
    if (isRecord(incoming)) {
      return Object.fromEntries(
        Object.entries(incoming).map(([key, value]) => [
          key,
          mergeEvidenceValue(undefined, value, path ? `${path}.${key}` : key, source, provenance),
        ]),
      );
    }
    return incoming;
  }

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const seen = new Set(existing.map(arrayValueKey));
    return [
      ...existing,
      ...incoming.filter((value) => {
        const key = arrayValueKey(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    ];
  }

  if (isRecord(existing) && isRecord(incoming)) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = mergeEvidenceValue(
        merged[key],
        value,
        path ? `${path}.${key}` : key,
        source,
        provenance,
      );
    }
    return merged;
  }

  return existing;
}

function mergeEvidence(candidates: SearchCandidate[]): {
  evidence: Record<string, unknown>;
  provenance: Record<string, EvidenceSource[]>;
} {
  const ranked = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      authority: evidenceSource(candidate).sourceAuthority,
    }))
    .sort((a, b) => b.authority - a.authority || a.index - b.index);
  const provenance: Record<string, EvidenceSource[]> = {};
  let evidence: Record<string, unknown> = {};

  for (const { candidate } of ranked) {
    const incoming = candidate.enrichmentMeta?.evidence;
    if (!isRecord(incoming)) continue;
    evidence = mergeEvidenceValue(
      evidence,
      incoming,
      '',
      evidenceSource(candidate),
      provenance,
    ) as Record<string, unknown>;
  }

  return { evidence, provenance };
}

/** Deterministic field merge driven only by classification and FIELD_TRUST_POLICY. */
export function mergeEnrichedCandidates(candidates: SearchCandidate[]): MergedProductMetadata {
  const enriched = candidates.filter((candidate) => candidate.enrichmentSucceeded === true);
  const provenance: Record<string, MetadataFieldSource> = {};

  const title = pickByPolicy('name', enriched, (candidate) => text(candidate.title));
  const brand = pickByPolicy('brand', enriched, (candidate) => text(candidate.brand));
  const model = pickByPolicy('model', enriched, (candidate) => text(candidate.model));
  const category = pickByPolicy('category', enriched, (candidate) => text(candidate.category));
  const description = pickByPolicy('description', enriched, (candidate) =>
    text(candidate.description),
  );
  const shortDescription = pickByPolicy('description', enriched, (candidate) =>
    text(candidate.enrichmentMeta?.short_description),
  );
  const heroImage = pickByPolicy(
    'image',
    enriched,
    (candidate) =>
      candidate.image && /^https?:\/\//i.test(candidate.image) ? candidate.image : null,
    'images',
  );
  const gallery = pickByPolicy('gallery', enriched, galleryOf, 'images');
  const specifications = pickByPolicy(
    'specifications',
    enriched,
    specsOf,
    'specifications',
  );
  const offer = pickByPolicy('offer', enriched, offerOf, 'commerce');

  recordProvenance(provenance, 'title', title);
  recordProvenance(provenance, 'brand', brand);
  recordProvenance(provenance, 'model', model);
  recordProvenance(provenance, 'category', category);
  recordProvenance(provenance, 'description', description);
  recordProvenance(provenance, 'shortDescription', shortDescription);
  recordProvenance(provenance, 'heroImage', heroImage);
  recordProvenance(provenance, 'gallery', gallery);
  recordProvenance(provenance, 'specifications', specifications);
  recordProvenance(provenance, 'offer', offer);
  recordOfferFieldProvenance(provenance, 'price', offer);
  recordOfferFieldProvenance(provenance, 'currency', offer);
  recordOfferFieldProvenance(provenance, 'availability', offer);
  recordOfferFieldProvenance(provenance, 'merchant', offer);
  recordOfferFieldProvenance(provenance, 'merchantUrl', offer);
  recordOfferFieldProvenance(provenance, 'affiliateUrl', offer);
  recordOfferFieldProvenance(provenance, 'offerId', offer);

  const metadataSources = [
    ...new Set([
      ...enriched.map((candidate) => hostOf(candidate.merchantUrl)),
      ...unionArrayValues(enriched, 'sources').map(String),
    ]),
  ];
  const evidenceContributors = enriched.filter(
    (candidate) => classificationOf(candidate).capabilities.evidence,
  );
  const evidenceMerge = mergeEvidence(evidenceContributors);

  const merged: MergedProductMetadata = {
    title: title?.value ?? null,
    brand: brand?.value ?? null,
    model: model?.value ?? null,
    category: category?.value ?? null,
    description: description?.value ?? null,
    shortDescription: shortDescription?.value ?? null,
    heroImage: heroImage?.value ?? null,
    gallery: gallery?.value ?? [],
    specifications: specifications?.value ?? {},
    price: offer?.value.price ?? null,
    currency: offer?.value.currency ?? null,
    availability: offer?.value.availability ?? null,
    merchant: offer?.value.merchant ?? null,
    offer: offer?.value ?? null,
    metadataSources,
    frameRefs: unionArrayValues(evidenceContributors, 'frameRefs'),
    evidence: evidenceMerge.evidence,
    evidenceProvenance: evidenceMerge.provenance,
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
