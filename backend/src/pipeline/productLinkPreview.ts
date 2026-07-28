import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../env';
import { tavilyExtractCanonicalUrl } from '../services/tavily';
import { ingestLog } from './ingestLog';
import { createOpenAIClient } from './openaiClient';
import { openaiCompletionWithRateLimit } from './openaiRateLimit';

const FETCH_TIMEOUT_MS = 18_000;
const MAX_HTML_BYTES = 900_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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

export function externalIdForProductUrl(raw: string): string {
  const canonical = canonicalizeProductUrl(raw);
  const h = createHash('sha256').update(canonical).digest('hex').slice(0, 28);
  return `m_${h}`;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function metaTag(html: string, prop: string): string | null {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${esc}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${esc}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${esc}["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${esc}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return decodeBasicEntities(m[1]);
  }
  return null;
}

function extractTitle(html: string): string | null {
  const og = metaTag(html, 'og:title') ?? metaTag(html, 'twitter:title');
  if (og) return og.trim();
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m?.[1]) return decodeBasicEntities(m[1].replace(/\s+/g, ' ').trim());
  return null;
}

function absolutizeImageUrl(raw: string, pageUrl: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const abs = new URL(t, pageUrl).href;
    return abs.startsWith('http') ? abs : null;
  } catch {
    return t.startsWith('http') ? t : null;
  }
}

function extractImage(html: string, pageUrl: string): string | null {
  const og =
    metaTag(html, 'og:image:secure_url') ??
    metaTag(html, 'og:image:url') ??
    metaTag(html, 'og:image') ??
    metaTag(html, 'twitter:image:src') ??
    metaTag(html, 'twitter:image');
  if (og) {
    const u = absolutizeImageUrl(og, pageUrl);
    if (u) return u;
  }
  const linkImg = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
  if (linkImg?.[1]) {
    const u = absolutizeImageUrl(linkImg[1], pageUrl);
    if (u) return u;
  }
  const fromLd = tryJsonLdImage(html, pageUrl);
  if (fromLd) return fromLd;
  return null;
}

function extractPriceString(html: string): string | null {
  const keys = [
    'product:price:amount',
    'og:price:amount',
    'og:price:standard_amount',
    'twitter:data1',
  ];
  for (const k of keys) {
    const v = metaTag(html, k);
    if (v && /\d/.test(v)) return v.trim();
  }
  const currency = metaTag(html, 'product:price:currency') ?? metaTag(html, 'og:price:currency');
  const amount = metaTag(html, 'product:price:amount');
  if (amount && currency && /\d/.test(amount)) return `${currency} ${amount}`.trim();

  const fromLd = tryJsonLdPrice(html);
  if (fromLd) return fromLd;

  const loose = html.slice(0, 120_000).match(/\$\s*([\d,]+\.?\d{0,2})/);
  if (loose?.[1]) return `$${loose[1].replace(/\s+/g, '')}`;

  const eur = html.slice(0, 120_000).match(/€\s*[\d,]+\.?\d{0,2}/);
  if (eur) return eur[0].replace(/\s+/g, '');

  const gbp = html.slice(0, 120_000).match(/£\s*[\d,]+\.?\d{0,2}/);
  if (gbp) return gbp[0].replace(/\s+/g, '');

  return null;
}

function tryJsonLdImage(html: string, pageUrl: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = m[1].trim();
      const data = JSON.parse(raw) as unknown;
      const flat = flattenLdNodes(data);
      for (const node of flat) {
        if (!node || typeof node !== 'object') continue;
        const o = node as Record<string, unknown>;
        const types = o['@type'];
        const isProduct =
          types === 'Product' ||
          (Array.isArray(types) && types.includes('Product')) ||
          (typeof types === 'string' && types.includes('Product'));
        if (!isProduct) continue;
        const img = o.image;
        if (typeof img === 'string') {
          const u = absolutizeImageUrl(img, pageUrl);
          if (u) return u;
        }
        if (Array.isArray(img) && img[0] && typeof img[0] === 'string') {
          const u = absolutizeImageUrl(img[0], pageUrl);
          if (u) return u;
        }
        if (img && typeof img === 'object' && 'url' in img && typeof (img as { url: unknown }).url === 'string') {
          const u = absolutizeImageUrl((img as { url: string }).url, pageUrl);
          if (u) return u;
        }
      }
    } catch {
      /* next */
    }
  }
  return null;
}

function tryJsonLdPrice(html: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = m[1].trim();
      const data = JSON.parse(raw) as unknown;
      const flat = flattenLdNodes(data);
      for (const node of flat) {
        if (!node || typeof node !== 'object') continue;
        const o = node as Record<string, unknown>;
        const types = o['@type'];
        const isProduct =
          types === 'Product' ||
          (Array.isArray(types) && types.includes('Product')) ||
          (typeof types === 'string' && types.includes('Product'));
        if (!isProduct) continue;
        const offers = o.offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        if (offer && typeof offer === 'object') {
          const off = offer as Record<string, unknown>;
          const price = off.price ?? off.lowPrice ?? off.highPrice;
          const cur = off.priceCurrency;
          if (typeof price === 'number' || typeof price === 'string') {
            const p = String(price);
            if (/\d/.test(p)) {
              return typeof cur === 'string' && cur ? `${cur} ${p}` : p.startsWith('$') ? p : `$${p}`;
            }
          }
        }
      }
    } catch {
      /* next script */
    }
  }
  return null;
}

function flattenLdNodes(data: unknown): unknown[] {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) return data.flatMap(flattenLdNodes);
  if (typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;
  const out: unknown[] = [data];
  if (Array.isArray(o['@graph'])) {
    for (const g of o['@graph']) out.push(...flattenLdNodes(g));
  }
  return out;
}

export type ProductLinkPreview = {
  externalId: string;
  name: string;
  price: string;
  currency?: string;
  image?: string;
  merchantUrl: string;
};

export type ProductLinkPreviewContext = {
  ingestId: string;
  traceId: string;
};

function isFreshCache(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < CACHE_TTL_MS;
}

function isValidHttpImageUrl(s: string | undefined): boolean {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!t.startsWith('http://') && !t.startsWith('https://')) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function scrapeSuccess(price: string, image: string | undefined): boolean {
  if (!price || price === '—' || !/\d/.test(price)) return false;
  return isValidHttpImageUrl(image);
}

type CanonicalRow = {
  canonical_url: string;
  name: string;
  price: string;
  currency: string | null;
  image: string | null;
  last_extracted_at: string;
};

async function loadFreshCanonical(
  admin: SupabaseClient,
  canonicalUrl: string,
): Promise<ProductLinkPreview | null> {
  const { data, error } = await admin
    .from('canonical_products')
    .select('canonical_url, name, price, currency, image, last_extracted_at')
    .eq('canonical_url', canonicalUrl)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as CanonicalRow;
  if (!isFreshCache(row.last_extracted_at)) return null;

  ingestLog('info', 'product_link_preview.cache_hit', {
    canonicalUrl: canonicalUrl.slice(0, 120),
    source: 'canonical_products',
  });

  return {
    externalId: externalIdForProductUrl(canonicalUrl),
    name: row.name,
    price: row.price,
    currency: row.currency ?? undefined,
    image: row.image ?? undefined,
    merchantUrl: canonicalUrl,
  };
}

async function upsertCanonicalProduct(
  admin: SupabaseClient,
  params: {
    canonicalUrl: string;
    name: string;
    price: string;
    currency: string | null;
    image: string | null;
    extractionSource: 'scrape' | 'ai';
  },
): Promise<void> {
  const { error } = await admin.from('canonical_products').upsert(
    {
      canonical_url: params.canonicalUrl,
      name: params.name,
      price: params.price,
      currency: params.currency,
      image: params.image,
      last_extracted_at: new Date().toISOString(),
      extraction_source: params.extractionSource,
    },
    { onConflict: 'canonical_url' },
  );

  if (error) {
    ingestLog('warn', 'product_link_preview.canonical_upsert_failed', {
      message: error.message,
      code: error.code,
    });
  }
}

async function manualScrapeProductPage(merchantUrl: string): Promise<{
  name: string;
  price: string;
  currency?: string;
  image?: string;
  html: string;
  parsed: URL;
  fetchOk: boolean;
  status?: number;
}> {
  let parsed: URL;
  try {
    parsed = new URL(merchantUrl);
  } catch {
    throw new Error('Invalid product URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Product URL must be http(s)');
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(merchantUrl, {
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': UA,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not fetch product page: ${msg}`);
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const host = parsed.hostname.replace(/^www\./, '');
    return {
      fetchOk: false,
      status: res.status,
      html: '',
      name: host,
      price: '—',
      parsed,
    };
  }

  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
  const html = new TextDecoder('utf-8', { fatal: false }).decode(slice);

  let price = extractPriceString(html);
  if (price && !/\d/.test(price)) price = null;
  if (!price) price = '—';

  let name = extractTitle(html);
  if (!name || name.length < 2) {
    name = parsed.hostname.replace(/^www\./, '');
  }
  if (name.length > 200) name = `${name.slice(0, 197)}…`;

  const image = extractImage(html, merchantUrl) ?? undefined;

  return {
    fetchOk: true,
    html,
    name,
    price,
    currency: 'USD',
    image,
    parsed,
  };
}

const TAVILY_GPT_MAX_MARKDOWN_CHARS = 48_000;
const TAVILY_GPT_MAX_IMAGES = 40;

type AiExtract = { name?: string; price?: string; imageUrl?: string; currency?: string };

function parseAiJson(raw: string): AiExtract | null {
  const trimmed = raw.trim();
  let body = trimmed;
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence?.[1]) body = fence[1].trim();
  try {
    return JSON.parse(body) as AiExtract;
  } catch {
    return null;
  }
}

async function extractCommerceFromTavilyWithGpt(
  admin: SupabaseClient,
  ctx: ProductLinkPreviewContext,
  tavilyMarkdown: string,
  tavilyImageUrls: string[],
  productNameHint: string,
): Promise<AiExtract | null> {
  if (!getEnv('OPENAI_API_KEY')) return null;

  const tavilyContent =
    tavilyMarkdown.length > TAVILY_GPT_MAX_MARKDOWN_CHARS
      ? `${tavilyMarkdown.slice(0, TAVILY_GPT_MAX_MARKDOWN_CHARS)}\n…`
      : tavilyMarkdown;
  const imageList = tavilyImageUrls.slice(0, TAVILY_GPT_MAX_IMAGES);
  const tavilyImagesBlock = imageList.length > 0 ? imageList.join('\n') : '(none)';

  const client = createOpenAIClient();
  const userPrompt =
    'You are an expert commerce data entry agent. I have extracted the following raw content from a product page:\n' +
    tavilyContent +
    '\n\nI also have these discovered image URLs:\n' +
    tavilyImagesBlock +
    '\n\nYour Task:\n' +
    'Identify the current sale price (look for ₹ or INR).\n' +
    "Select the absolute best high-resolution 'hero' image URL from the list that represents the product.\n" +
    'Return only valid JSON: { "name": string, "price": string, "imageUrl": string, "currency": "INR" }.\n\n' +
    'Product name hint (from prior scrape or URL): ' +
    productNameHint;

  try {
    const completion = await openaiCompletionWithRateLimit(admin, ctx, () =>
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You output only compact JSON objects. Prefer INR when prices use ₹ or INR; otherwise set currency to a sensible ISO code.',
          },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 600,
      }),
    );

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    return parseAiJson(raw);
  } catch (e) {
    ingestLog('warn', 'product_link_preview.tavily_gpt_exception', {
      ...ctx,
      message: (e as Error).message?.slice(0, 160),
    });
    return null;
  }
}

function toPreview(
  canonicalUrl: string,
  name: string,
  price: string,
  currency: string | undefined,
  image: string | undefined,
): ProductLinkPreview {
  return {
    externalId: externalIdForProductUrl(canonicalUrl),
    name,
    price,
    currency,
    image,
    merchantUrl: canonicalUrl,
  };
}

async function runTavilyCommerceFallback(
  admin: SupabaseClient,
  ctx: ProductLinkPreviewContext,
  canonicalUrl: string,
  productNameHint: string,
): Promise<ProductLinkPreview | null> {
  if (!getEnv('TAVILY_API_KEY')) {
    return null;
  }

  const page = await tavilyExtractCanonicalUrl(canonicalUrl);
  if (!page || (!page.rawContent.trim() && page.images.length === 0)) {
    ingestLog('warn', 'product_link_preview.tavily_empty', { ...ctx });
    return null;
  }

  const ai = await extractCommerceFromTavilyWithGpt(
    admin,
    ctx,
    page.rawContent,
    page.images,
    productNameHint,
  );

  const aiPrice =
    typeof ai?.price === 'string' && ai.price !== '—' && /\d/.test(ai.price) ? ai.price.trim() : null;
  const aiImage =
    typeof ai?.imageUrl === 'string' && isValidHttpImageUrl(ai.imageUrl) ? ai.imageUrl.trim() : null;
  const aiName =
    typeof ai?.name === 'string' && ai.name.trim().length >= 2 ? ai.name.trim() : productNameHint;
  const aiCurrency =
    typeof ai?.currency === 'string' && ai.currency.trim() ? ai.currency.trim() : 'INR';

  if (!aiPrice || !aiImage) {
    return null;
  }

  ingestLog('info', 'product_link_preview.tavily_fallback_ok', { ...ctx });
  await upsertCanonicalProduct(admin, {
    canonicalUrl,
    name: aiName,
    price: aiPrice,
    currency: aiCurrency,
    image: aiImage,
    extractionSource: 'ai',
  });
  return toPreview(canonicalUrl, aiName, aiPrice, aiCurrency, aiImage);
}

/**
 * High-reliability product link preview: canonical cache → manual HTML scrape → Tavily Extract (advanced) + gpt-4o-mini → graceful placeholders.
 */
export async function previewProductLink(
  admin: SupabaseClient,
  productUrl: string,
  ctx: ProductLinkPreviewContext,
): Promise<ProductLinkPreview> {
  const canonicalUrl = canonicalizeProductUrl(productUrl);

  let parsed: URL;
  try {
    parsed = new URL(canonicalUrl);
  } catch {
    throw new Error('Invalid product URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Product URL must be http(s)');
  }

  const cached = await loadFreshCanonical(admin, canonicalUrl);
  if (cached) return cached;

  let scrape: Awaited<ReturnType<typeof manualScrapeProductPage>>;
  try {
    scrape = await manualScrapeProductPage(canonicalUrl);
  } catch (e) {
    let hostShort = 'product';
    try {
      hostShort = new URL(canonicalUrl).hostname.replace(/^www\./, '');
    } catch {
      /* */
    }
    ingestLog('warn', 'product_link_preview.scrape_failed', {
      ...ctx,
      message: (e as Error).message?.slice(0, 160),
    });
    const tavilyAfterThrow = await runTavilyCommerceFallback(admin, ctx, canonicalUrl, hostShort);
    if (tavilyAfterThrow) return tavilyAfterThrow;
    return toPreview(canonicalUrl, hostShort, '—', undefined, undefined);
  }

  if (scrapeSuccess(scrape.price, scrape.image)) {
    await upsertCanonicalProduct(admin, {
      canonicalUrl,
      name: scrape.name,
      price: scrape.price,
      currency: scrape.currency ?? 'USD',
      image: scrape.image ?? null,
      extractionSource: 'scrape',
    });
    return toPreview(canonicalUrl, scrape.name, scrape.price, scrape.currency, scrape.image);
  }

  const tavilyOut = await runTavilyCommerceFallback(admin, ctx, canonicalUrl, scrape.name);
  if (tavilyOut) {
    return tavilyOut;
  }

  ingestLog('info', 'product_link_preview.graceful_degraded', {
    ...ctx,
    fetchOk: scrape.fetchOk,
    triedTavily: !!getEnv('TAVILY_API_KEY'),
  });

  return toPreview(
    canonicalUrl,
    scrape.name,
    scrape.price === '—' ? '—' : scrape.price,
    scrape.currency,
    scrape.image,
  );
}
