import { createHash } from 'node:crypto';
import type { ContentSourceProductRecord } from '../../content-source/domain/types';
import type { SearchCandidate } from '../../product-intelligence/domain/types';
import { assessProductIdentityCompatibility } from '../../product-intelligence/search/productIdentityCompatibility';
import { classifyCandidatePage } from '../../product-intelligence/search/CandidatePageClassifier';
import { isExactProductBuyingUrl } from '../../shopping/productUrlIdentity';
import { normalizeProductIdentityTokens } from '../../product-intelligence/normalizer/ProductIdentityCanonicalizer';

export type SimilarSuggestion = { key: string; title: string; brand: string | null; model: string | null;
  kind?: 'possible' | 'similar_styles';
  category: string | null; image: string | null; merchantUrl: string; catalogId: string | null;
  score: number; reasonCodes: string[] };
export type MatchAssessment = { version: 1; policy: 'share-similar-v1'; kind: 'exact' | 'possible' | 'similar' | 'unable_to_identify';
  suggestions: SimilarSuggestion[]; reasonCodes: string[] };
export type ReviewCandidate = SearchCandidate & { verifiedCatalogId?: string };
const TYPES = /\b(handbag|bag|dress|shoe|sneaker|phone|smartphone|laptop|headphone|earbud|watch|camera|speaker|perfume|lipstick|jacket|coat|bicycle|bike)s?\b/i;
const OMIT = new Set(['the','for','with','and','product','new','buy','shop','official','women','men','womens','mens','a','an']);
const tokens = (text: string) => normalizeProductIdentityTokens(text).filter(t => !OMIT.has(t) && !TYPES.test(t));
const safeImage = (v: string | null) => v && /^https?:\/\//i.test(v) ? v : null;

/** Conservative evidence ranking, not a probability; never relaxes exact gates. */
export function assessSimilar(product: Pick<ContentSourceProductRecord,'name'|'brand'|'model'|'category'|'confidence'>,
  candidates: ReviewCandidate[], exact = false): MatchAssessment {
  const base = { version: 1 as const, policy: 'share-similar-v1' as const };
  if (exact) return { ...base, kind: 'exact', suggestions: [], reasonCodes: ['existing_identity_validated'] };
  const attributes = [...new Set(tokens(product.name))];
  if (!TYPES.test(product.name) || attributes.length < 2 || (product.confidence ?? 0) < 0.8) {
    return { ...base, kind: 'unable_to_identify', suggestions: [], reasonCodes: ['insufficient_distinguishing_evidence'] };
  }
  const accepted: SimilarSuggestion[] = [];
  for (const c of candidates.slice(0, 50)) {
    const provenance = c.enrichmentMeta?.identitySource ?? c.enrichmentMeta?.identity_source;
    if (!c.verifiedCatalogId && (!c.enrichmentSucceeded || !['merchant_html','canonical_cache'].includes(String(provenance)))) continue;
    const compatibility = assessProductIdentityCompatibility({ name: product.name, brand: product.brand, model: product.model, category: product.category },
      { title: c.title, brand: c.brand, model: c.model, category: c.category, merchantUrl: c.merchantUrl });
    if (!compatibility.ok || !TYPES.test(c.title)) continue;
    const typeA = product.name.match(TYPES)?.[1]?.toLowerCase(), typeB = c.title.match(TYPES)?.[1]?.toLowerCase();
    const type = (s?: string) => s === 'handbag' ? 'bag' : s === 'smartphone' ? 'phone' : s === 'sneaker' ? 'shoe' : s;
    if (type(typeA) !== type(typeB)) continue;
    let url: URL; try { url = new URL(c.merchantUrl); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith('[')
      || ['.local','.localhost','.internal','.lan','.home.arpa'].some(s=>url.hostname.endsWith(s)) || !isExactProductBuyingUrl(c.merchantUrl)) continue;
    const page = classifyCandidatePage({ url: c.merchantUrl, sourceTier: c.sourceTier, title: c.title });
    if (!page.capabilities.commerce || c.pdpVerdict !== 'pdp' || (c.pdpScore ?? 0) < 0.45) continue;
    const available = new Set(tokens(c.title)), matched = attributes.filter(t => available.has(t));
    const score = matched.length / attributes.length;
    if (matched.length < 2 || score < 0.8) continue;
    const key = createHash('sha256').update(c.merchantUrl).digest('hex');
    if (accepted.some(s => s.key === key)) continue;
    accepted.push({ key, title: c.title, brand: c.brand ?? null, model: c.model ?? null, category: c.category ?? null,
      image: safeImage(c.image), merchantUrl: c.merchantUrl, catalogId: c.verifiedCatalogId ?? null,
      score, reasonCodes: ['compatible_product_type','distinguishing_attributes_supported','merchant_identity_checked'] });
  }
  const suggestions = accepted.sort((a,b) => b.score-a.score || a.key.localeCompare(b.key)).slice(0,3);
  return { ...base, kind: suggestions.length ? 'similar' : 'unable_to_identify', suggestions,
    reasonCodes: suggestions.length ? ['review_required'] : ['no_reliable_existing_candidate'] };
}
