import { canonicalizeProductUrl } from '../../pipeline/urlCanonicalization';
import { normalizeMerchantUrl, isQualifyingMerchantSeedUrl } from '../search/directUrlIdentity';
import type { SearchCandidate } from '../domain/types';
import { assessProductIdentityCompatibility, type ProductIdentityCandidate, type ProductIdentityExpectation } from '../search/productIdentityCompatibility';
import { normalizeProductIdentityTokens } from '../normalizer/ProductIdentityCanonicalizer';
import { classifyCandidatePage } from '../search/CandidatePageClassifier';
import { classifyPdp } from '../search/PdpClassifier';
import { isPubliclyRoutableHost } from '../../user-import/domain/hostSafety';
import {countryAvailability} from '../../shopping/countrySuitability';
import { merchantComparison } from './merchantIdentity';

export const MERCHANT_EVIDENCE_VERSION = 'merchant-evidence-v1';
export type MerchantEvidenceState = 'PAGE_VERIFIED' | 'DISCOVERY_VERIFIED' | 'UNRESOLVED' | 'REJECTED';
export type MerchantEvidenceInput = {
  countryAvailability?: import('../../shopping/countrySuitability').CountryAvailability;
  url: string;
  discovery?: { title: string; snippet?: string | null; provider: string };
  page?: ProductIdentityCandidate;
  pageRead: 'READ' | 'UNAVAILABLE' | 'NOT_ATTEMPTED';
};
export type MerchantEvidence = MerchantEvidenceInput & {
  version: typeof MERCHANT_EVIDENCE_VERSION;
  state: MerchantEvidenceState;
  usable: boolean;
  reason: string;
  origin: 'merchant_page' | 'independent_discovery' | null;
};
const words = (s: string | null | undefined): string[] => normalizeProductIdentityTokens(s ?? '').map(t => t.toLowerCase());

/** Merchant-only gate. The image/enrichment identity policy deliberately remains unchanged. */
export function assessMerchantIdentity(expected: ProductIdentityExpectation, candidate: ProductIdentityCandidate) {
  const comparison = merchantComparison(expected, candidate);
  ({ expected, candidate } = comparison);
  if (comparison.officialSkuValue && expected.model && /^(?:\d{6}|A\d{8})$/i.test(expected.model)
    && comparison.officialSkuValue.toLowerCase() !== expected.model.toLowerCase()) return { ok: false, reason: 'model_conflict' as const };
  const base = assessProductIdentityCompatibility(expected, candidate);
  if (!base.ok) {
    if (base.reason === 'identifier_mismatch' && ['gtin', 'mpn'].some(key => {
      const field = key as 'gtin' | 'mpn';
      return expected[field] && !candidate[field];
    })) return { ok: false, reason: 'identifier_missing' as const };
    return base;
  }
  const requested = words([expected.name, expected.model].filter(Boolean).join(' '));
  let pathName = '';
  try { pathName = candidate.merchantUrl ? new URL(candidate.merchantUrl).pathname : ''; } catch { /* Not identity evidence. */ }
  const title = words([candidate.title, candidate.model].filter(Boolean).join(' '));
  const titleOnly = words(candidate.title);
  for (let i = 1; i < requested.length; i++) {
    if (!/^\d+$/.test(requested[i]!)) continue;
    for (let j = 0; j < titleOnly.length - 1; j++) {
      if (titleOnly[j] === requested[i - 1] && /^\d+$/.test(titleOnly[j + 1]!) && titleOnly[j + 1] !== requested[i]) return { ok: false, reason: 'model_conflict' as const };
    }
  }
  const requestedNumbers = requested.filter(t => /^\d+$/.test(t));
  const actualNumbers = title.filter(t => /^\d+$/.test(t));
  if (requestedNumbers.length && actualNumbers.length && !requestedNumbers.every(t => actualNumbers.includes(t))) return { ok: false, reason: 'model_conflict' as const };
  const actual = new Set([...title, ...words(pathName)]);
  // Pure generation tokens were previously discarded (Tune Beam 2 -> Tune Beam).
  const missingNumber = requested.filter(t => /^\d+$/.test(t)).some(t => !actual.has(t));
  if (missingNumber) {
    const title = words([candidate.title, candidate.model].filter(Boolean).join(' '));
    const titleNumbers = title.filter(t => /^\d+$/.test(t));
    const requiredNumbers = requested.filter(t => /^\d+$/.test(t));
    const otherGeneration = titleNumbers.length > 0 && !requiredNumbers.every(t => titleNumbers.includes(t));
    const path = words(pathName.replace(/\.html?$/i, ''));
    const family = requested.filter(t => !/^\d+$/.test(t) && !words(expected.brand).includes(t));
    const originalGenerationPath = family.length > 1 && path.length === family.length && family.every(t => path.includes(t));
    return { ok: false, reason: otherGeneration || originalGenerationPath ? 'model_conflict' as const : 'model_missing' as const };
  }
  for (const token of requested.filter(t => /^\d+(?:gb|tb)$/.test(t))) {
    if (!actual.has(token)) return { ok: false, reason: title.some(t => /^\d+(?:gb|tb)$/.test(t)) ? 'model_conflict' as const : 'model_missing' as const };
  }
  return base;
}

function safeDestination(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      && (!url.port || url.port === '443' || url.port === '80') && isPubliclyRoutableHost(url.hostname)
      && !url.searchParams.has('url') && !url.searchParams.has('redirect');
  } catch { return false; }
}

export function qualifyMerchantEvidence(expected: ProductIdentityExpectation, input: MerchantEvidenceInput): MerchantEvidence {
  const result = (state: MerchantEvidenceState, reason: string, origin: MerchantEvidence['origin'] = null): MerchantEvidence => ({
    ...input, version: MERCHANT_EVIDENCE_VERSION, state, reason, origin,
    usable: state === 'PAGE_VERIFIED' || state === 'DISCOVERY_VERIFIED',
  });
  if (!safeDestination(input.url)) return result('REJECTED', 'unsafe_destination');
  const url = new URL(input.url);
  if (/\/(?:s|search|search-results|category|categories|collections)(?:\/|$)/i.test(url.pathname)
    || ['k', 'q', 'search', 'query'].some(key => url.searchParams.has(key))) return result('REJECTED', 'not_product_destination');
  const pdp = classifyPdp({ url: input.url, title: input.discovery?.title, expectedBrand: expected.brand });
  const pageType = classifyCandidatePage({ url: input.url, expectedBrand: expected.brand });
  if (pdp.hardNegative || pdp.verdict === 'not_pdp'
    || ['SOCIAL', 'VIDEO', 'FORUM', 'REVIEW', 'NEWS', 'WIKI', 'SPECIFICATION'].includes(pageType.sourceType)) return result('REJECTED', 'not_product_destination');
  const assess = (facts: ProductIdentityCandidate) => assessMerchantIdentity(expected, { ...facts, merchantUrl: input.url });
  const page = input.page && assessMerchantIdentity(expected, { ...input.page, merchantUrl: null });
  const discovery = input.discovery && assess({ title: input.discovery.title });
  const pageRoute = input.page && assess(input.page);
  // Explicit contradictions always win over another source's positive evidence.
  for (const identity of [page, pageRoute, discovery]) {
    if (identity && !identity.ok && /conflict|identifier_mismatch/.test(identity.reason ?? '')) return result('REJECTED', identity.reason!);
  }
  if (input.pageRead === 'READ' && input.page?.title && page?.ok) return result('PAGE_VERIFIED', 'page_identity_supported', 'merchant_page');
  // Discovery needs a meaningful full-name match, not merely a brand/host or shortlist score.
  const brand = new Set(words(expected.brand));
  const identityWords = words([expected.name, expected.model].filter(Boolean).join(' ')).filter(t => !brand.has(t));
  const titleWords = new Set(words(input.discovery?.title));
  const comparison = merchantComparison(expected, { title: input.discovery?.title, merchantUrl: input.url });
  // A recognized manufacturer's exact SKU route plus matching product-family
  // words is independent discovery evidence, never a fetched-page claim.
  const family = identityWords.filter(t => !/\d/.test(t) && !['s', 'fit'].includes(t));
  const skuTitle = comparison.officialSku && family.length >= 2 && family.every(t => titleWords.has(t));
  const exactTitle = skuTitle || (identityWords.length > 0 && identityWords.every(t => titleWords.has(t)));
  const recognized = pageType.sourceType === 'MARKETPLACE' || (() => {
    const b = words(comparison.expected.brand).join('');
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return b.length >= 2 && ['com', 'in', 'co.in', 'co.uk', 'de', 'fr', 'ca', 'com.au', 'co.jp'].some(suffix => host === `${b}.${suffix}` || host.endsWith(`.${b}.${suffix}`));
  })();
  if (input.pageRead !== 'READ' && input.discovery && discovery?.ok && exactTitle && recognized && isQualifyingMerchantSeedUrl(input.url)) return result('DISCOVERY_VERIFIED', 'independent_discovery_identity_supported', 'independent_discovery');
  return result('UNRESOLVED', page && !page.ok ? page.reason! : discovery && !discovery.ok ? discovery.reason! : 'insufficient_independent_evidence');
}

/** Legacy/internal providers must supply independent page facts explicitly. */
export function candidateEvidence(candidate: SearchCandidate): MerchantEvidenceInput {
  const page = candidate.enrichmentMeta?.merchantPageIdentity as ProductIdentityCandidate | undefined;
  return { url: candidate.merchantUrl, countryAvailability:countryAvailability(candidate.enrichmentMeta?.countryAvailability), page, pageRead: page ? 'READ' : 'NOT_ATTEMPTED' };
}

/** No image, description, or metadata capability can leak from discovery into the catalogue merge. */
export function merchantOfferCandidate(evidence: MerchantEvidence, source?: SearchCandidate, expectedBrand?: string | null): SearchCandidate {
  const facts = evidence.origin === 'merchant_page' ? evidence.page : evidence.discovery;
  const pdp = classifyPdp({ url: evidence.url, title: facts?.title, expectedBrand });
  const classification = classifyCandidatePage({ url: evidence.url, sourceTier: source?.sourceTier, title: facts?.title, expectedBrand });
  return { merchantUrl: evidence.url, merchant: source?.merchant ?? new URL(evidence.url).hostname,
    title: facts?.title ?? '', brand: evidence.page?.brand, model: evidence.page?.model,
    image: null, score: 0, pdpScore: evidence.state === 'PAGE_VERIFIED' ? Math.min(1, Math.max(0, source?.pdpScore ?? pdp.score)) : pdp.score, pdpVerdict: 'pdp', sourceType: classification.sourceType,
    sourceTier: source?.sourceTier, pageType: 'PRODUCT', capabilities: { ...classification.capabilities, commerce: true, images: false, metadata: false },
    price: evidence.state === 'PAGE_VERIFIED' ? source?.price : null,
    currency: evidence.state === 'PAGE_VERIFIED' ? source?.currency : null,
    enrichmentMeta: { merchantEvidence: evidence, countryAvailability:evidence.countryAvailability } };
}

/** A duplicate search hit cannot override contradictory or incomplete fetched page evidence. */
export function qualifyMerchantEvidenceSet(expected: ProductIdentityExpectation, inputs: MerchantEvidenceInput[], options?: { requirePage?: boolean }): MerchantEvidence[] {
  const groups = new Map<string, MerchantEvidence[]>();
  for (const input of inputs) {
    const key = normalizeMerchantUrl(canonicalizeProductUrl(input.url)) ?? input.url;
    const group = groups.get(key) ?? [];
    const qualified = qualifyMerchantEvidence(expected, input);
    group.push(options?.requirePage && qualified.state === 'DISCOVERY_VERIFIED' ? { ...qualified, state: 'UNRESOLVED', usable: false, origin: null, reason: 'independent_merchant_page_required' } : qualified);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => group.find(e => e.state === 'REJECTED')
    ?? group.find(e => e.state === 'PAGE_VERIFIED')
    ?? group.find(e => e.pageRead === 'READ')
    ?? group.find(e => e.state === 'DISCOVERY_VERIFIED') ?? group[0]!);
}
