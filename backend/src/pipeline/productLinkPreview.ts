import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../env';
import { tavilyExtractCanonicalUrl } from '../services/tavily';
import {
  detectPageLocale,
  inspectPriceEvidence,
  sourceContainsRawPrice,
  type CurrencyEvidenceSource,
} from './CommercePriceEvidence';
import { ingestLog } from './ingestLog';
import { createOpenAIClient } from './openaiClient';
import { openaiCompletionWithRateLimit } from './openaiRateLimit';

const FETCH_TIMEOUT_MS = 18_000;
const MAX_HTML_BYTES = 900_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENT_EXTRACTION_SOURCES = new Set([
  'scrape_currency_v2',
  'ai_currency_v2',
]);
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
  const pairedMeta = [
    ['product:price:amount', 'product:price:currency'],
    ['og:price:amount', 'og:price:currency'],
  ];
  for (const [amountKey, currencyKey] of pairedMeta) {
    const amount = metaTag(html, amountKey!);
    const currency = metaTag(html, currencyKey!);
    if (amount && /\d/.test(amount)) {
      return currency ? `${currency} ${amount}`.trim() : amount.trim();
    }
  }

  for (const key of ['og:price:standard_amount', 'twitter:data1']) {
    const value = metaTag(html, key);
    if (value && /\d/.test(value)) return value.trim();
  }

  const fromLd = tryJsonLdPrice(html);
  if (fromLd) return fromLd;

  const loose = html.slice(0, 120_000).match(/\$\s*([\d,]+\.?\d{0,2})/);
  if (loose?.[1]) return `$${loose[1].replace(/\s+/g, '')}`;

  const inr = html.slice(0, 120_000).match(/₹\s*[\d,]+\.?\d{0,2}/);
  if (inr) return inr[0].replace(/\s+/g, '');

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
              return typeof cur === 'string' && cur ? `${cur} ${p}` : p;
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
  priceSource?: 'scrape' | 'ai' | 'canonical_cache';
  image?: string;
  merchantUrl: string;
  /** Hostname or brand site label — derived from URL / page. */
  merchant?: string;
  brand?: string;
  description?: string;
  /** Structured specs when extractor can provide them (JSON object). */
  specifications?: Record<string, string>;
};

export type ProductLinkPreviewContext = {
  ingestId: string;
  traceId: string;
  /**
   * When false, a canonical_products row that only has name/price/image is not
   * treated as complete evidence (manual / direct-URL path).
   */
  acceptPartialCache?: boolean;
};

const livePreviewMemo = new Map<string, ProductLinkPreview>();

export function isRichProductPreview(preview: {
  brand?: string | null;
  description?: string | null;
  specifications?: Record<string, string> | null;
}): boolean {
  const description = preview.description?.trim() ?? '';
  const brand = preview.brand?.trim() ?? '';
  const specCount = preview.specifications ? Object.keys(preview.specifications).length : 0;
  return description.length >= 20 || brand.length >= 2 || specCount > 0;
}

export function shouldUseCanonicalCacheHit(
  cached: {
    brand?: string | null;
    description?: string | null;
    specifications?: Record<string, string> | null;
  },
  acceptPartialCache?: boolean,
): boolean {
  return acceptPartialCache !== false || isRichProductPreview(cached);
}

export function rememberLiveProductPreview(
  canonicalUrl: string,
  preview: ProductLinkPreview,
): void {
  if (isRichProductPreview(preview)) {
    livePreviewMemo.set(canonicalUrl, preview);
  }
}

export function getLiveProductPreview(canonicalUrl: string): ProductLinkPreview | undefined {
  return livePreviewMemo.get(canonicalUrl);
}

export function clearLiveProductPreviewMemoForTests(): void {
  livePreviewMemo.clear();
}

function rememberAndReturn(canonicalUrl: string, preview: ProductLinkPreview): ProductLinkPreview {
  rememberLiveProductPreview(canonicalUrl, preview);
  return preview;
}

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

function scrapeSuccess(
  price: string,
  currency: string | undefined,
  image: string | undefined,
): boolean {
  if (!price || price === '—' || !/\d/.test(price)) return false;
  return !!currency && isValidHttpImageUrl(image);
}

type CanonicalRow = {
  canonical_url: string;
  name: string;
  price: string;
  currency: string | null;
  image: string | null;
  extraction_source: string | null;
  last_extracted_at: string;
};

async function loadFreshCanonical(
  admin: SupabaseClient,
  canonicalUrl: string,
  ctx: ProductLinkPreviewContext,
): Promise<ProductLinkPreview | null> {
  const { data, error } = await admin
    .from('canonical_products')
    .select('canonical_url, name, price, currency, image, extraction_source, last_extracted_at')
    .eq('canonical_url', canonicalUrl)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as CanonicalRow;
  if (!isFreshCache(row.last_extracted_at)) return null;
  if (!CURRENT_EXTRACTION_SOURCES.has(row.extraction_source ?? '')) return null;

  ingestLog('info', 'product_link_preview.cache_hit', {
    canonicalUrl: canonicalUrl.slice(0, 120),
    source: 'canonical_products',
  });
  const priceEvidence = inspectPriceEvidence(row.price, row.currency);
  ingestLog('info', 'offer.extraction.raw', {
    ...ctx,
    extractionSource: 'canonical_cache',
    rawPriceText: row.price,
    parsedAmount: priceEvidence.parsedAmount,
    parsedCurrency: priceEvidence.parsedCurrency,
    detectedCurrencySource: priceEvidence.detectedCurrencySource,
    merchantDomain: merchantFromUrl(canonicalUrl),
    pageLocale: null,
    priceBackedBySource: null,
  });

  return {
    externalId: externalIdForProductUrl(canonicalUrl),
    name: row.name,
    price: row.price,
    currency: row.currency ?? undefined,
    priceSource: row.extraction_source === 'ai_currency_v2' ? 'ai' : 'canonical_cache',
    image: row.image ?? undefined,
    merchantUrl: canonicalUrl,
    merchant: merchantFromUrl(canonicalUrl),
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
    extractionSource: 'scrape_currency_v2' | 'ai_currency_v2';
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
  parsedAmount?: number | null;
  detectedCurrencySource?: CurrencyEvidenceSource;
  pageLocale?: string | null;
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
  const priceEvidence = inspectPriceEvidence(price === '—' ? null : price);

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
    currency: priceEvidence.parsedCurrency ?? undefined,
    image,
    parsed,
    parsedAmount: priceEvidence.parsedAmount,
    detectedCurrencySource: priceEvidence.detectedCurrencySource,
    pageLocale: detectPageLocale(html),
  };
}

const TAVILY_GPT_MAX_MARKDOWN_CHARS = 48_000;
const TAVILY_GPT_MAX_IMAGES = 40;

type AiExtract = {
  name?: string;
  price?: string;
  imageUrl?: string;
  currency?: string;
  brand?: string;
  description?: string;
  specifications?: Record<string, string>;
};

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
    'Identify the current sale price and its native currency from the page content.\n' +
    'Copy the price text verbatim, including its symbol or currency code. Do not convert currencies or infer currency from user locale, country, or domain.\n' +
    "Select the absolute best high-resolution 'hero' image URL from the list that represents the product.\n" +
    'Return only valid JSON: { "name": string, "price": string|null, "imageUrl": string, "currency": string|null, "brand": string|null, "description": string|null, "specifications": object|null }.\n' +
    'If currency is not explicit in the page content, return null for both price and currency.\n' +
    'specifications should be a flat string map of product attributes when present (e.g. Color, Storage, RAM) — omit or null if unknown.\n\n' +
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
              'You output only compact JSON objects. Preserve explicit merchant currency exactly and never guess, convert, or localize a price.',
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

function merchantFromUrl(canonicalUrl: string): string {
  try {
    return new URL(canonicalUrl).hostname.replace(/^www\./i, '');
  } catch {
    return 'merchant';
  }
}

function metaDescription(html: string): string | undefined {
  const d =
    metaTag(html, 'og:description') ??
    metaTag(html, 'twitter:description') ??
    metaTag(html, 'description');
  const t = d?.replace(/\s+/g, ' ').trim();
  return t && t.length >= 8 ? t.slice(0, 500) : undefined;
}

function toPreview(
  canonicalUrl: string,
  name: string,
  price: string,
  currency: string | undefined,
  image: string | undefined,
  extras?: {
    brand?: string;
    description?: string;
    merchant?: string;
    specifications?: Record<string, string>;
    priceSource?: ProductLinkPreview['priceSource'];
  },
): ProductLinkPreview {
  return {
    externalId: externalIdForProductUrl(canonicalUrl),
    name,
    price,
    currency,
    priceSource: extras?.priceSource,
    image,
    merchantUrl: canonicalUrl,
    merchant: extras?.merchant ?? merchantFromUrl(canonicalUrl),
    brand: extras?.brand,
    description: extras?.description,
    specifications: extras?.specifications,
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

  const rawPriceText =
    typeof ai?.price === 'string' && ai.price !== '—' && /\d/.test(ai.price)
      ? ai.price.trim()
      : null;
  const priceEvidence = inspectPriceEvidence(rawPriceText, ai?.currency);
  const priceBackedBySource = sourceContainsRawPrice(page.rawContent, rawPriceText);
  ingestLog(priceBackedBySource || !rawPriceText ? 'info' : 'warn', 'offer.extraction.raw', {
    ...ctx,
    extractionSource: 'tavily_gpt',
    rawPriceText,
    parsedAmount: priceEvidence.parsedAmount,
    parsedCurrency: priceEvidence.parsedCurrency,
    detectedCurrencySource: priceEvidence.detectedCurrencySource,
    merchantDomain: merchantFromUrl(canonicalUrl),
    pageLocale: detectPageLocale(page.rawContent),
    priceBackedBySource,
  });
  const aiPrice =
    rawPriceText && priceEvidence.parsedAmount !== null && priceBackedBySource
      ? rawPriceText
      : null;
  const aiImage =
    typeof ai?.imageUrl === 'string' && isValidHttpImageUrl(ai.imageUrl) ? ai.imageUrl.trim() : null;
  const aiName =
    typeof ai?.name === 'string' && ai.name.trim().length >= 2 ? ai.name.trim() : productNameHint;
  const aiCurrency = priceEvidence.parsedCurrency;

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
    extractionSource: 'ai_currency_v2',
  });
  const aiBrand =
    typeof ai?.brand === 'string' && ai.brand.trim().length >= 2 ? ai.brand.trim() : undefined;
  const aiDesc =
    typeof ai?.description === 'string' && ai.description.trim().length >= 8
      ? ai.description.trim().slice(0, 500)
      : undefined;
  const aiSpecs =
    ai?.specifications && typeof ai.specifications === 'object' && !Array.isArray(ai.specifications)
      ? Object.fromEntries(
          Object.entries(ai.specifications)
            .filter(([, v]) => typeof v === 'string' && v.trim())
            .map(([k, v]) => [String(k).slice(0, 64), String(v).trim().slice(0, 120)]),
        )
      : undefined;
  return toPreview(canonicalUrl, aiName, aiPrice, aiCurrency ?? undefined, aiImage, {
    brand: aiBrand,
    description: aiDesc,
    specifications: aiSpecs,
    priceSource: 'ai',
  });
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

  const memo = getLiveProductPreview(canonicalUrl);
  if (memo && isRichProductPreview(memo)) return memo;

  const cached = await loadFreshCanonical(admin, canonicalUrl, ctx);
  if (cached) {
    if (shouldUseCanonicalCacheHit(cached, ctx.acceptPartialCache)) {
      return cached;
    }
    ingestLog('info', 'product_link_preview.cache_partial_skipped', {
      canonicalUrl: canonicalUrl.slice(0, 120),
    });
  }

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
    if (tavilyAfterThrow) return rememberAndReturn(canonicalUrl, tavilyAfterThrow);
    return rememberAndReturn(
      canonicalUrl,
      toPreview(canonicalUrl, hostShort, '—', undefined, undefined),
    );
  }

  ingestLog('info', 'offer.extraction.raw', {
    ...ctx,
    extractionSource: 'merchant_html',
    rawPriceText: scrape.price === '—' ? null : scrape.price,
    parsedAmount: scrape.parsedAmount ?? null,
    parsedCurrency: scrape.currency ?? null,
    detectedCurrencySource: scrape.detectedCurrencySource ?? 'none',
    merchantDomain: scrape.parsed.hostname.replace(/^www\./i, ''),
    pageLocale: scrape.pageLocale ?? null,
    priceBackedBySource: scrape.price !== '—',
  });

  if (scrapeSuccess(scrape.price, scrape.currency, scrape.image)) {
    await upsertCanonicalProduct(admin, {
      canonicalUrl,
      name: scrape.name,
      price: scrape.price,
      currency: scrape.currency ?? null,
      image: scrape.image ?? null,
      extractionSource: 'scrape_currency_v2',
    });
    return rememberAndReturn(
      canonicalUrl,
      toPreview(canonicalUrl, scrape.name, scrape.price, scrape.currency, scrape.image, {
        description: metaDescription(scrape.html),
        priceSource: 'scrape',
      }),
    );
  }

  const tavilyOut = await runTavilyCommerceFallback(admin, ctx, canonicalUrl, scrape.name);
  if (tavilyOut) {
    return rememberAndReturn(canonicalUrl, tavilyOut);
  }

  ingestLog('info', 'product_link_preview.graceful_degraded', {
    ...ctx,
    fetchOk: scrape.fetchOk,
    triedTavily: !!getEnv('TAVILY_API_KEY'),
  });

  return rememberAndReturn(
    canonicalUrl,
    toPreview(
      canonicalUrl,
      scrape.name,
      scrape.price === '—' ? '—' : scrape.price,
      scrape.currency,
      scrape.image,
      {
        description: metaDescription(scrape.html),
        priceSource: scrape.price === '—' ? undefined : 'scrape',
      },
    ),
  );
}
