import type { SearchCandidate } from '../domain/types';

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
