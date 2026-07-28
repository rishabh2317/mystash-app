/**
 * Optional sanity-check of merchant URLs using Google Programmable Search (Custom Search JSON API).
 * Env: GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID — same as `productRetrieval.ts`.
 */

import type { ExtractedProduct } from './productTypes';
import { getEnv } from '../env';
import { ingestLog } from './ingestLog';
import { verifyUrlMatchesProduct } from './productRetrieval';

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export async function verifyProductsWithGoogleSearch(
  products: ExtractedProduct[],
  logCtx: { ingestId: string; traceId: string },
): Promise<{ products: ExtractedProduct[]; usedGoogleCse: boolean }> {
  const key = getEnv('GOOGLE_CSE_API_KEY');
  const cx = getEnv('GOOGLE_CSE_ID');
  if (!key || !cx || products.length === 0) {
    return { products, usedGoogleCse: false };
  }

  const out: ExtractedProduct[] = [];

  for (const p of products) {
    let confidence = p.confidence ?? 0.72;
    const merchantUrl = p.merchantUrl;

    try {
      const q = encodeURIComponent(`${p.name} buy`);
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&num=8&q=${q}`;
      const res = await fetch(url);
      if (!res.ok) {
        ingestLog('warn', 'google_verify.cse_http', {
          ...logCtx,
          status: res.status,
        });
        out.push(p);
        continue;
      }

      const json = (await res.json()) as {
        items?: Array<{ link?: string; title?: string }>;
      };
      const items = json.items ?? [];
      const targetHost = hostOf(p.merchantUrl);
      let matched = false;

      for (const it of items) {
        const u = it.link;
        if (!u || !u.startsWith('https://')) continue;
        const rh = hostOf(u);
        if (
          targetHost &&
          rh &&
          (rh === targetHost || rh.endsWith('.' + targetHost) || targetHost.endsWith('.' + rh))
        ) {
          matched = true;
          break;
        }
        const title = it.title ?? '';
        if (verifyUrlMatchesProduct(p.name, title, u)) {
          matched = true;
          break;
        }
      }

      if (matched) {
        confidence = Math.min(0.95, Math.max(confidence, 0.62));
      } else {
        confidence = Math.max(0.35, confidence - 0.08);
      }

      out.push({
        ...p,
        merchantUrl,
        confidence,
      });
    } catch (e) {
      ingestLog('warn', 'google_verify.exception', {
        ...logCtx,
        message: (e as Error).message?.slice(0, 120),
      });
      out.push(p);
    }
  }

  return { products: out, usedGoogleCse: true };
}
