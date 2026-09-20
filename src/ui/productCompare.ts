import type { ProductPageOffer, ProductPageReviews, ProductPageView } from '@/src/types/productPage';
import { formatProductPrice } from '@/src/ui/collectionSections';
import { productPagePath, productPageRatingLabel } from '@/src/ui/productPage';

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

export const COMPARE_COPY = {
  title: 'Compare',
  hint: 'Add 2–4 products to see how they differ.',
  add: 'Add a product',
  searchPlaceholder: 'Search for another product',
  selected: 'In this comparison',
  remove: 'Remove',
  viewProduct: 'View product',
  missing: 'Not available',
  price: 'Price',
  merchant: 'Listed by',
  category: 'Category',
  reviews: 'Reviews',
  maxReached: 'You can compare up to 4 products.',
  needMore: 'Add at least one more product to compare.',
  loadError: 'Couldn’t load this comparison',
  emptySearch: 'No matching products',
  alreadyAdded: 'Already in this comparison',
} as const;

export type CompareColumn = {
  productId: string;
  title: string;
  brand: string | null;
  heroImage: string | null;
  priceLabel: string | null;
  productPath: string;
};

export type CompareRow = {
  id: string;
  label: string;
  values: (string | null)[];
};

export type ProductComparison = {
  products: CompareColumn[];
  rows: CompareRow[];
};

type SpecAlias = {
  id: string;
  label: string;
  aliases: string[];
};

/**
 * Aliases observed in catalog/discovered `metadata.specifications`
 * (Color, Storage, RAM, Chip, Display, Driver, Platform, Weight, Size, Frame)
 * plus common merchant labels for the same facts.
 */
const SPEC_ALIASES: SpecAlias[] = [
  { id: 'battery', label: 'Battery', aliases: ['battery', 'battery life', 'playback', 'playback time', 'runtime'] },
  { id: 'anc', label: 'Noise cancellation', aliases: ['anc', 'noise cancellation', 'noise cancelling', 'active noise'] },
  { id: 'weight', label: 'Weight', aliases: ['weight'] },
  { id: 'codec', label: 'Codec', aliases: ['codec', 'codecs', 'ldac', 'aptx'] },
  { id: 'driver', label: 'Driver', aliases: ['driver', 'drivers'] },
  { id: 'processor', label: 'Processor', aliases: ['processor', 'chip', 'cpu', 'soc'] },
  { id: 'ram', label: 'RAM', aliases: ['ram', 'memory'] },
  { id: 'storage', label: 'Storage', aliases: ['storage', 'ssd'] },
  { id: 'display', label: 'Display', aliases: ['display', 'screen', 'screen size'] },
  { id: 'camera', label: 'Camera', aliases: ['camera', 'cameras'] },
  { id: 'charging', label: 'Charging', aliases: ['charging', 'fast charge', 'fast charging'] },
  { id: 'graphics', label: 'Graphics', aliases: ['graphics', 'gpu'] },
  { id: 'platform', label: 'Platform', aliases: ['platform'] },
  { id: 'resolution', label: 'Resolution', aliases: ['resolution'] },
  { id: 'controller', label: 'Controller', aliases: ['controller', 'controllers'] },
  { id: 'connectivity', label: 'Connectivity', aliases: ['connectivity', 'bluetooth', 'wireless'] },
  { id: 'color', label: 'Color', aliases: ['color', 'colour'] },
  { id: 'size', label: 'Size', aliases: ['size'] },
];

const FAMILY_ORDER: { match: RegExp; attrs: string[] }[] = [
  {
    match: /headphone|earbud|earphone|headset|audio/,
    attrs: ['battery', 'anc', 'weight', 'codec', 'driver', 'connectivity'],
  },
  {
    match: /laptop|notebook|macbook|ultrabook/,
    attrs: ['processor', 'ram', 'storage', 'display', 'weight', 'graphics', 'battery'],
  },
  {
    match: /phone|smartphone|mobile|iphone/,
    attrs: ['display', 'processor', 'camera', 'battery', 'charging', 'storage'],
  },
  {
    match: /console|playstation|xbox|switch|gaming/,
    attrs: ['storage', 'resolution', 'platform', 'controller'],
  },
];

export function comparePath(ids: string[]): string {
  const unique = parseCompareIds(ids.join(','));
  return unique.length ? `/compare?ids=${unique.map(encodeURIComponent).join(',')}` : '/compare';
}

export function parseCompareIds(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw) ? raw.flatMap((item) => item.split(',')) : (raw ?? '').split(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= COMPARE_MAX) break;
  }
  return out;
}

export function canAddCompareId(ids: string[], nextId: string): boolean {
  const id = nextId.trim();
  if (!id) return false;
  if (ids.includes(id)) return false;
  return ids.length < COMPARE_MAX;
}

export function hasComparableFacts(
  page: Pick<ProductPageView, 'price' | 'offers' | 'specifications' | 'reviews'>,
): boolean {
  if (page.price?.trim()) return true;
  if (page.offers.some((offer) => Boolean(offer.price?.trim()))) return true;
  if (Object.keys(page.specifications).length > 0) return true;
  if (page.reviews?.overview?.trim()) return true;
  if (page.reviews?.likes.length) return true;
  if (page.reviews?.concerns.length) return true;
  return false;
}

export function comparePriceLines(
  page: Pick<ProductPageView, 'price' | 'currency' | 'offers'>,
): string | null {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const offer of page.offers) {
    const line = formatOfferLine(offer);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  if (lines.length) return lines.join('\n');
  return formatProductPrice({
    id: 'price',
    catalogProductId: null,
    title: '',
    brand: null,
    merchant: null,
    heroImage: null,
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'UNRESOLVED',
    availability: null,
    price: page.price,
    currency: page.currency,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  });
}

export function compareHeaderPrice(
  page: Pick<ProductPageView, 'price' | 'currency' | 'offers'>,
): string | null {
  const priced = page.offers.filter((offer) => offer.price?.trim());
  if (priced.length > 1) return null;
  return comparePriceLines(page);
}

export function compareMerchantLabel(
  page: Pick<ProductPageView, 'merchant' | 'offers'>,
): string | null {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const offer of page.offers) {
    const name = offer.merchant?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length) return names.join(', ');
  return page.merchant?.trim() || null;
}

export function compareReviewSummary(reviews: ProductPageReviews | null): string | null {
  if (!reviews) return null;
  const rating = productPageRatingLabel(reviews);
  const overview = reviews.overview?.trim() || null;
  if (rating && overview) return `${rating}\n${overview}`;
  if (rating) return rating;
  return overview;
}

export function buildProductComparison(pages: ProductPageView[]): ProductComparison {
  const products = pages.map((page) => ({
    productId: page.productId,
    title: page.title,
    brand: page.brand,
    heroImage: page.heroImage,
    priceLabel: compareHeaderPrice(page),
    productPath: productPagePath(page.productId),
  }));

  const rows: CompareRow[] = [];
  pushRow(rows, 'price', COMPARE_COPY.price, pages.map(comparePriceLines));
  pushRow(rows, 'merchant', COMPARE_COPY.merchant, pages.map(compareMerchantLabel));
  pushRow(rows, 'category', COMPARE_COPY.category, pages.map((page) => page.category?.trim() || null));
  pushRow(rows, 'reviews', COMPARE_COPY.reviews, pages.map((page) => compareReviewSummary(page.reviews)));

  const usedKeys = new Set<string>();
  for (const attrId of preferredAttributeIds(pages)) {
    const alias = SPEC_ALIASES.find((item) => item.id === attrId);
    if (!alias) continue;
    const values = pages.map((page) => {
      const match = matchSpec(page.specifications, alias.aliases, usedKeys);
      return match?.value ?? null;
    });
    if (values.some(Boolean)) {
      for (const page of pages) {
        const match = matchSpec(page.specifications, alias.aliases, new Set());
        if (match) usedKeys.add(normalizeKey(match.key));
      }
      rows.push({ id: alias.id, label: alias.label, values });
    }
  }

  const leftover = leftoverSpecKeys(pages, usedKeys);
  for (const key of leftover) {
    rows.push({
      id: `spec:${key}`,
      label: key,
      values: pages.map((page) => {
        const exact = page.specifications[key]?.trim();
        if (exact) return exact;
        const found = Object.entries(page.specifications).find(
          ([name]) => normalizeKey(name) === normalizeKey(key),
        );
        return found?.[1]?.trim() || null;
      }),
    });
  }

  return { products, rows };
}

function pushRow(rows: CompareRow[], id: string, label: string, values: (string | null)[]): void {
  if (!values.some(Boolean)) return;
  rows.push({ id, label, values });
}

function preferredAttributeIds(pages: ProductPageView[]): string[] {
  const matched: string[] = [];
  const seen = new Set<string>();
  const add = (attrs: string[]) => {
    for (const attr of attrs) {
      if (seen.has(attr)) continue;
      seen.add(attr);
      matched.push(attr);
    }
  };

  for (const page of pages) {
    const text = `${page.category ?? ''} ${page.title}`.toLowerCase();
    for (const family of FAMILY_ORDER) {
      if (family.match.test(text)) add(family.attrs);
    }
  }
  if (matched.length) {
    add(['color', 'size']);
    return matched;
  }

  const keys = pages.flatMap((page) => Object.keys(page.specifications)).map(normalizeKey);
  const has = (pattern: RegExp) => keys.some((key) => pattern.test(key));
  if (has(/ram|chip|processor|cpu/) && has(/storage|display|ssd/)) {
    return ['processor', 'ram', 'storage', 'display', 'weight', 'graphics', 'battery', 'color', 'size'];
  }
  if (has(/anc|driver|codec/)) {
    return ['battery', 'anc', 'weight', 'codec', 'driver', 'connectivity', 'color', 'size'];
  }
  if (has(/camera/) && has(/battery|charging|storage/)) {
    return ['display', 'processor', 'camera', 'battery', 'charging', 'storage', 'color', 'size'];
  }
  if (has(/platform|controller|resolution/)) {
    return ['storage', 'resolution', 'platform', 'controller', 'color', 'size'];
  }
  return SPEC_ALIASES.map((item) => item.id);
}

function matchSpec(
  specs: Record<string, string>,
  aliases: string[],
  usedKeys: Set<string>,
): { key: string; value: string } | null {
  const entries = Object.entries(specs);
  for (const alias of aliases) {
    const wanted = normalizeKey(alias);
    if (!wanted) continue;
    for (const [key, value] of entries) {
      const normalized = normalizeKey(key);
      if (!normalized || usedKeys.has(normalized) || !value.trim()) continue;
      if (normalized === wanted || tokenContains(normalized, wanted)) {
        return { key, value: value.trim() };
      }
    }
  }
  return null;
}

function leftoverSpecKeys(pages: ProductPageView[], usedKeys: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const key of Object.keys(page.specifications)) {
      const normalized = normalizeKey(key);
      if (!normalized || usedKeys.has(normalized) || seen.has(normalized)) continue;
      if (!page.specifications[key]?.trim()) continue;
      seen.add(normalized);
      out.push(key);
    }
  }
  return out;
}

function formatOfferLine(offer: ProductPageOffer): string | null {
  const price = formatProductPrice({
    id: offer.id,
    catalogProductId: null,
    title: '',
    brand: null,
    merchant: null,
    heroImage: null,
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'UNRESOLVED',
    availability: null,
    price: offer.price,
    currency: offer.currency,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  });
  if (!price) return null;
  const merchant = offer.merchant?.trim();
  return merchant ? `${merchant} · ${price}` : price;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenContains(haystack: string, needle: string): boolean {
  const hay = ` ${haystack} `;
  const need = ` ${needle} `;
  return hay.includes(need);
}
