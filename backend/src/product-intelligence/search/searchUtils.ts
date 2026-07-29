import type { SearchFailureKind } from '../domain/types';
import { classifyPdp } from './PdpClassifier';

const BLOCKED_HOST_SNIPPETS = [
  'google.com/search',
  'google.com/url',
  'bing.com/search',
  'duckduckgo.com',
  'youtube.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'wikipedia.org',
];

/** Reject SERP noise / non-commerce hosts; keep likely product page URLs. */
export function hostLooksLikePdp(
  url: string,
  title?: string | null,
  snippet?: string | null,
): boolean {
  const classification = classifyPdp({ url, title, snippet });
  if (classification.hardNegative) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const full = `${u.hostname}${u.pathname}`.toLowerCase();
    return !BLOCKED_HOST_SNIPPETS.some((b) => full.includes(b));
  } catch {
    return false;
  }
}

export function classifyHttpError(status: number): SearchFailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status >= 500) return 'network';
  return 'unknown';
}

export function classifyNetworkError(message: string): SearchFailureKind {
  return /timeout|aborted/i.test(message) ? 'timeout' : 'network';
}
