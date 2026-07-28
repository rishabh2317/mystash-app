/**
 * Optional merchant URL grounding via Google Programmable Search (Custom Search JSON API).
 * Env: GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID (search engine id / cx).
 */

import { ingestLog } from './ingestLog.ts';

const TRUSTED_HOST_PARTS = [
  'amazon.',
  'target.com',
  'walmart.com',
  'bestbuy.com',
  'bhphotovideo.com',
  'newegg.com',
  'apple.com',
  'google.com/store',
  'ebay.com',
  'costco.com',
  'homedepot.com',
  'lowes.com',
  'ulta.com',
  'sephora.com',
  'nike.com',
  'adidas.com',
  'rei.com',
];

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, '').toLowerCase();
}

export function verifyUrlMatchesProduct(productName: string, pageTitle: string, link: string): boolean {
  const hay = `${pageTitle} ${link}`.toLowerCase();
  const tokens = productName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);
  if (tokens.length === 0) return true;
  const hits = tokens.filter((t) => hay.includes(t));
  return hits.length >= Math.min(2, tokens.length) || hits.includes(tokens[0]!);
}

function scoreCandidate(link: string, title: string, productName: string): number {
  let s = 0;
  try {
    const host = normalizeHost(new URL(link).hostname);
    if (TRUSTED_HOST_PARTS.some((p) => host.includes(p.replace(/\.$/, '')))) s += 3;
    if (verifyUrlMatchesProduct(productName, title, link)) s += 4;
    if (link.startsWith('https://')) s += 1;
  } catch {
    return -1;
  }
  return s;
}

export type CseHit = { url: string; title: string };

/**
 * Returns best https shopping URL for a product query, or null if CSE is not configured / empty.
 */
export async function searchProductPurchaseUrl(
  productName: string,
  logCtx: { ingestId: string; traceId: string },
): Promise<CseHit | null> {
  const key = Deno.env.get('GOOGLE_CSE_API_KEY');
  const cx = Deno.env.get('GOOGLE_CSE_ID');
  if (!key || !cx) {
    return null;
  }

  const q = encodeURIComponent(`${productName} buy`);
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&num=8&q=${q}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      ingestLog('warn', 'cse.http', {
        ...logCtx,
        status: res.status,
      });
      return null;
    }
    const json = (await res.json()) as {
      items?: Array<{ link?: string; title?: string }>;
    };
    const items = json.items ?? [];
    let best: CseHit | null = null;
    let bestScore = -1;

    for (const it of items) {
      const link = it.link;
      const title = it.title ?? '';
      if (!link || !link.startsWith('https://')) continue;
      if (link.includes('example.com')) continue;
      const sc = scoreCandidate(link, title, productName);
      if (sc > bestScore) {
        bestScore = sc;
        best = { url: link, title };
      }
    }

    if (best && bestScore >= 3) {
      ingestLog('info', 'cse.hit', { ...logCtx, score: bestScore });
      return best;
    }

    if (best && verifyUrlMatchesProduct(productName, best.title, best.url)) {
      ingestLog('info', 'cse.hit_loose', { ...logCtx, score: bestScore });
      return best;
    }

    return null;
  } catch (e) {
    ingestLog('warn', 'cse.exception', {
      ...logCtx,
      message: (e as Error).message?.slice(0, 120),
    });
    return null;
  }
}
