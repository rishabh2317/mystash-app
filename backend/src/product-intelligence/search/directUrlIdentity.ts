import type { SearchCandidate } from '../domain/types';
import { isExactProductBuyingUrl, isMarketplaceHost } from '../../shopping/productUrlIdentity';
import { classifyCandidatePage } from './CandidatePageClassifier';
import { classifyPdp } from './PdpClassifier';

/**
 * Affiliate / social redirect hosts commonly found in Discover Anywhere shares.
 * These may be useful as source context but must not suppress merchant discovery.
 */
const AFFILIATE_OR_SOCIAL_REDIRECT_HOST =
  /(^|\.)(liketk\.it|liketoknow\.it|rstyle\.me|shopstyle\.com|shop-links\.co|go\.shopmy\.us|go\.link|bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rebrand\.ly)$/i;

export function isAffiliateOrSocialRedirectUrl(raw: string): boolean {
  try {
    const host = new URL(raw.trim()).hostname.replace(/^www\./i, '').toLowerCase();
    if (AFFILIATE_OR_SOCIAL_REDIRECT_HOST.test(host)) return true;
    const page = classifyCandidatePage({ url: raw });
    return page.sourceType === 'SOCIAL' || page.sourceType === 'VIDEO';
  } catch {
    return false;
  }
}

/**
 * True when a user-import HTTP merchantUrl is a genuine commerce PDP seed
 * (marketplace / retailer / official product page), not an affiliate or social redirect.
 * Reuses classifyPdp + CandidatePageClassifier — no new URL taxonomy.
 */
export function isQualifyingMerchantSeedUrl(raw: string): boolean {
  try {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;
    if (isAffiliateOrSocialRedirectUrl(trimmed)) return false;
    const pdp = classifyPdp({ url: trimmed });
    if (pdp.hardNegative || pdp.verdict === 'not_pdp') return false;
    const page = classifyCandidatePage({
      url: trimmed,
      sourceTier: pdp.sourceTier,
    });
    if (page.capabilities.commerce) return true;
    const host = new URL(trimmed).hostname.replace(/^www\./i, '').toLowerCase();
    return isExactProductBuyingUrl(trimmed) && isMarketplaceHost(host);
  } catch {
    return false;
  }
}

/**
 * Creator-supplied product URL is strong enough to skip broad Serper discovery.
 * Uses existing PDP classifier outcomes — does not introduce new verification thresholds.
 */
export function isStrongDirectUrlCandidate(candidate: SearchCandidate): boolean {
  if (candidate.enrichmentSucceeded !== true) return false;
  if (!candidate.title?.trim() || candidate.title.trim().length < 2) return false;
  if (candidate.pdpVerdict === 'not_pdp') return false;
  if (candidate.pdpVerdict === 'pdp') return true;
  return (candidate.pdpScore ?? 0) >= 0.45;
}

export function merchantUrlsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeMerchantUrl(a);
  const nb = normalizeMerchantUrl(b);
  return na !== null && na === nb;
}

export function normalizeMerchantUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return null;
  }
}
