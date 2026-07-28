import { getEnv } from '../env';

const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
const EXTRACT_FETCH_MS = 65_000;

export type TavilyExtractPage = {
  url: string;
  rawContent: string;
  images: string[];
};

type TavilyExtractApiResult = {
  url?: string;
  raw_content?: string;
  images?: string[];
};

type TavilyExtractResponse = {
  results?: TavilyExtractApiResult[];
  failed_results?: Array<{ url?: string; error?: string }>;
};

/**
 * Headless extract (`extract_depth: advanced`) for JS-heavy merchant pages (e.g. Myntra, Ajio).
 * Tavily's API field is `extract_depth` (`basic` | `advanced`), not `depth`.
 * Uses `Authorization: Bearer <TAVILY_API_KEY>` per Tavily docs.
 */
export async function tavilyExtractCanonicalUrl(canonicalUrl: string): Promise<TavilyExtractPage | null> {
  const apiKey = getEnv('TAVILY_API_KEY');
  if (!apiKey?.trim()) {
    return null;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), EXTRACT_FETCH_MS);

  try {
    const res = await fetch(TAVILY_EXTRACT_URL, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        urls: [canonicalUrl],
        include_images: true,
        extract_depth: 'advanced',
        format: 'markdown',
        timeout: 55,
      }),
    });

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as TavilyExtractResponse;
    const first = json.results?.[0];
    const raw = typeof first?.raw_content === 'string' ? first.raw_content : '';
    const imgs = Array.isArray(first?.images) ? first.images.filter((u): u is string => typeof u === 'string') : [];
    const urlOut = typeof first?.url === 'string' ? first.url : canonicalUrl;

    if (!raw.trim() && imgs.length === 0) {
      return null;
    }

    return {
      url: urlOut,
      rawContent: raw,
      images: imgs,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
