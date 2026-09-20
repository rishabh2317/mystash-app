/**
 * Pure URL canonicalization and identity shared by ingest product previews, user imports,
 * and content sources.
 *
 * Extracted from `productLinkPreview.ts` (which re-exports it) so callers that only
 * need URL identity do not pull in the Tavily / OpenAI module graph.
 */

import { createHash } from 'node:crypto';

const TRACKING_QUERY_KEYS = new Set(
  [
    'gclid',
    'fbclid',
    'msclkid',
    'dclid',
    'ref',
    'referrer',
    'source',
    's_kwcid',
    'mc_cid',
    'mc_eid',
    'igshid',
    'mkt_tok',
    'mkwid',
    'affiliate',
    'partner',
    'tag',
    'cmpid',
    'ad_id',
    'campaign_id',
    'otracker',
    'trkid',
    'afftrack',
    'si',
    '_ga',
    '_gl',
    'gbraid',
    'wbraid',
    'yclid',
    'ymclid',
    'eud',
    'spm',
    'ved',
    'usg',
    'ocid',
    'cvid',
    'sca_esv',
  ].map((k) => k.toLowerCase()),
);

/**
 * Strips hash, UTM (`utm_*`), and common tracking query params so the same product URL dedupes in cache.
 */
export function canonicalizeProductUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    const keys = [...u.searchParams.keys()];
    for (const k of keys) {
      const kl = k.toLowerCase();
      if (kl.startsWith('utm_') || TRACKING_QUERY_KEYS.has(kl)) {
        u.searchParams.delete(k);
      }
    }
    return u.href;
  } catch {
    return raw.trim();
  }
}

/** Stable identity for a product / web page URL, keyed on its canonical form. */
export function externalIdForProductUrl(raw: string): string {
  const canonical = canonicalizeProductUrl(raw);
  const h = createHash('sha256').update(canonical).digest('hex').slice(0, 28);
  return `m_${h}`;
}
