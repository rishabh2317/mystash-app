import { createHash } from 'node:crypto';
import type { ContentSourceProductRecord } from '../../content-source/domain/types';
import { assessMerchantIdentity } from '../../product-intelligence/verification/merchantEvidence';
import { isExactProductBuyingUrl } from '../../shopping/productUrlIdentity';
import { classifyCandidatePage } from '../../product-intelligence/search/CandidatePageClassifier';
import { isPubliclyRoutableHost } from '../domain/hostSafety';
import { assessSimilar, type MatchAssessment, type ReviewCandidate } from './similarity';

type Hypothesis = Pick<ContentSourceProductRecord, 'name'|'brand'|'model'|'category'|'confidence'> & Partial<Pick<ContentSourceProductRecord, 'evidence'>>;
export const findGarmentType = (value: string) => value.toLowerCase().match(/\b(jacket|shirt|jeans|dress|coat|hoodie|sweater|skirt)\b/)?.[1];
const words = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const colours = new Set(['blue','black','white','red','green','brown','pink','grey','gray','navy']);

/** Source association is separate from merchant identity; alternatives never auto-bind. */
export function assessFindMatches(product: Hypothesis, candidates: ReviewCandidate[], exact = false): MatchAssessment {
  const possible = (product.evidence?.identification as { kind?: string } | undefined)?.kind === 'possible';
  if (!possible || exact || !findGarmentType(product.name)) {
    const assessment = assessSimilar(product, candidates, exact);
    // A named model is still useful when merchant confirmation failed. This
    // changes presentation only, never resolution eligibility or Stash writes.
    return !exact && (possible || product.model) && (product.confidence ?? 0) >= 0.6
      ? { ...assessment, kind: 'possible' } : assessment;
  }
  const facts = Array.isArray(product.evidence?.attributes) ? product.evidence.attributes as { attribute?: string; value?: string; origin?: string }[] : [];
  const descriptor = [product.name, ...facts.filter(a => a.origin === 'observed' && ['colour','material','style','fit'].includes(a.attribute ?? '')).map(a => a.value)].join(' ');
  const required = new Set(words(descriptor));
  const type = findGarmentType(product.name);
  const suggestions: MatchAssessment['suggestions'] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.slice(0, 50)) {
    // Only independently established catalogue/page identities; raw discovery ranking is insufficient.
    if (!candidate.verifiedCatalogId && !(candidate.enrichmentSucceeded && candidate.enrichmentMeta?.identitySource === 'merchant_html')) continue;
    let url: URL;
    try { url = new URL(candidate.merchantUrl); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !isPubliclyRoutableHost(url.hostname) || !isExactProductBuyingUrl(url.href)) continue;
    const page = classifyCandidatePage({ url: url.href, title: candidate.title, sourceTier: candidate.sourceTier });
    if (!page.capabilities.commerce || !type || findGarmentType(candidate.title) !== type) continue;
    if (!assessMerchantIdentity({ name: candidate.title, brand: candidate.brand, model: candidate.model, category: candidate.category },
      { title: candidate.title, brand: candidate.brand, model: candidate.model, merchantUrl: candidate.merchantUrl, category: candidate.category }).ok) continue;
    const available = new Set(words(candidate.title));
    const matched = [...required].filter(word => available.has(word));
    if (matched.length < 2) continue;
    const expectedColours = [...required].filter(w => colours.has(w));
    const actualColours = [...available].filter(w => colours.has(w));
    if (expectedColours.length && actualColours.length && !expectedColours.some(c => actualColours.includes(c))) continue;
    const identity = candidate.verifiedCatalogId ?? [candidate.title, candidate.brand, candidate.model].join('|').toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    const sameBrand = product.brand && candidate.brand && product.brand.toLowerCase() === candidate.brand.toLowerCase();
    suggestions.push({ key: createHash('sha256').update(candidate.merchantUrl).digest('hex'), title: candidate.title,
      brand: candidate.brand ?? null, model: candidate.model ?? null, category: candidate.category ?? null,
      image: candidate.image ?? null, merchantUrl: candidate.merchantUrl, catalogId: candidate.verifiedCatalogId ?? null,
      score: matched.length / required.size, kind: sameBrand ? 'possible' : 'similar_styles',
      reasonCodes: ['source_identity_unconfirmed','independent_candidate_identity','explicit_save_required'] });
  }
  return { version: 1, policy: 'share-similar-v1', kind: 'possible',
    suggestions: suggestions.sort((a,b) => b.score-a.score || a.key.localeCompare(b.key)).slice(0,3),
    reasonCodes: ['source_identity_unconfirmed','explicit_save_required'] };
}
