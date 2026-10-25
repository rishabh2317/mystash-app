import { normalizeProductIdentityTokens } from '../normalizer/ProductIdentityCanonicalizer';

export type ProductIdentityExpectation = {
  brand?: string | null;
  name?: string | null;
  model?: string | null;
  category?: string | null;
};

export type ProductIdentityCandidate = {
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  merchantUrl?: string | null;
  category?: string | null;
};

export type ProductIdentityCompatibility = {
  ok: boolean;
  reason:
    | null
    | 'brand_unsupported'
    | 'brand_conflict'
    | 'model_missing'
    | 'model_conflict'
    | 'color_conflict'
    | 'type_conflict';
};

/**
 * Words that describe a product but are not a brand. Used only to avoid
 * treating "satin" or "dress" as a competing brand. Not a brand directory.
 */
const GENERIC = new Set([
  'a', 'an', 'and', 'the', 'for', 'with', 'from', 'in', 'of', 'on', 'to', 'by',
  'new', 'buy', 'shop', 'official', 'best', 'sale', 'free', 'pack', 'set', 'pair',
  'pairs', 'size', 'sizes', 'small', 'medium', 'large', 'plus', 'petite', 'tall',
  'original', 'genuine', 'authentic', 'unlocked', 'charging', 'warranty', 'wireless',
  'bluetooth', 'portable', 'replacement', 'compatible', 'certified', 'renewed',
  'refurbished', 'bundle', 'women', 'womens', 'woman', 'men', 'mens', 'man',
  'ladies', 'lady', 'unisex', 'kids', 'girl', 'girls', 'boy', 'boys', 'solid',
  'printed', 'print', 'striped', 'stripe', 'floral', 'casual', 'formal', 'party',
  'midi', 'mini', 'maxi', 'sheath', 'bodycon', 'sleeveless', 'slim', 'fitted',
  'flare', 'aline', 'cowl', 'neck', 'collar', 'sleeve', 'sleeves', 'short', 'long',
  'knee', 'ankle', 'length', 'running', 'carbon', 'frame', 'cotton', 'satin',
  'silk', 'leather', 'wool', 'denim', 'linen', 'polyester', 'chiffon', 'velvet',
  'nylon', 'suede', 'canvas', 'mesh', 'rubber', 'metal', 'steel', 'titanium',
  'ceramic', 'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'walmart', 'ebay',
  'target', 'bestbuy', 'amzn', 'www', 'com', 'html', 'php', 'dp', 'gp', 'pd',
  'item', 'product', 'products', 'review', 'reviews', 'brand', 'site',
]);

const COLORS = new Set([
  'black', 'white', 'olive', 'green', 'blue', 'red', 'navy', 'beige', 'brown',
  'gray', 'grey', 'pink', 'purple', 'yellow', 'orange', 'gold', 'silver',
  'maroon', 'burgundy', 'cream', 'ivory', 'khaki', 'tan', 'teal', 'coral',
  'rust', 'charcoal', 'nude',
]);

/** Head-noun product types. Plurals collapse. Sheath vs midi stays "dress". */
const PRODUCT_TYPES: Record<string, string> = {
  dress: 'dress',
  dresses: 'dress',
  gown: 'dress',
  jean: 'jeans',
  jeans: 'jeans',
  jogger: 'joggers',
  joggers: 'joggers',
  sneaker: 'shoe',
  sneakers: 'shoe',
  shoe: 'shoe',
  shoes: 'shoe',
  boot: 'shoe',
  boots: 'shoe',
  sandal: 'shoe',
  sandals: 'shoe',
  headphone: 'headphones',
  headphones: 'headphones',
  earbud: 'earbuds',
  earbuds: 'earbuds',
  phone: 'phone',
  smartphone: 'phone',
  iphone: 'phone',
  laptop: 'laptop',
  macbook: 'laptop',
  tablet: 'tablet',
  watch: 'watch',
  bag: 'bag',
  handbag: 'bag',
  jacket: 'jacket',
  coat: 'coat',
  sweater: 'sweater',
  hoodie: 'hoodie',
  camera: 'camera',
  speaker: 'speaker',
  perfume: 'perfume',
  lipstick: 'lipstick',
  bike: 'bike',
  bicycle: 'bike',
};

function tokensOf(value: string | null | undefined): string[] {
  return normalizeProductIdentityTokens(value).map((token) => token.toLowerCase());
}

/** Brand, color, material, and product-type words are not a product line. */
export function isIdentityFillerToken(token: string): boolean {
  const key = token.toLowerCase();
  return GENERIC.has(key) || COLORS.has(key) || Boolean(PRODUCT_TYPES[key]);
}

function isModelLike(token: string): boolean {
  return /\d/.test(token);
}

function brandTokensOf(brand: string | null | undefined): string[] {
  return tokensOf(brand).filter((token) => token.length >= 2 && !GENERIC.has(token) && !COLORS.has(token));
}

const COMPANY_SUFFIX = new Set([
  'labs', 'lab', 'inc', 'llc', 'co', 'company', 'corp', 'corporation', 'store', 'brand', 'official',
]);

/**
 * Site-section words. They are not brands. Used only on URL paths so a
 * newsroom or press page is not a competing brand, while a slug that
 * actually names NEUDIS still conflicts.
 */
const PATH_SECTION = new Set([
  'newsroom', 'news', 'press', 'releases', 'release', 'blog', 'blogs',
  'stories', 'story', 'media', 'about',
]);

function brandSupportedByText(text: string | null | undefined, brandTokens: string[]): boolean {
  if (!brandTokens.length) return false;
  if (textHasAll(text, brandTokens)) return true;
  const joined = brandTokens.join('');
  if (joined.length < 4) return false;
  return tokensOf(text).some((token) => {
    if (token.length < 4) return false;
    if (token === joined) return true;
    if (joined.startsWith(token) && COMPANY_SUFFIX.has(joined.slice(token.length))) return true;
    if (token.startsWith(joined) && COMPANY_SUFFIX.has(token.slice(joined.length))) return true;
    return false;
  });
}

function hostSupportsBrand(url: string | null | undefined, brandTokens: string[]): boolean {
  if (!url || !brandTokens.length) return false;
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  } catch {
    return false;
  }
  const slug = brandTokens.join('');
  return slug.length >= 2 && host.includes(slug);
}

function textHasAll(text: string | null | undefined, needed: string[]): boolean {
  if (!needed.length) return false;
  const tokens = new Set(tokensOf(text));
  return needed.every((token) => tokens.has(token));
}

/** Amazon-style `/{title-slug}/dp/{asin}` slug. The ASIN itself is not a brand. */
function slugTokens(url: string | null | undefined): string[] {
  if (!url) return [];
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    while (parts.length && /^(site|shop|buy|en|us|uk|in|gb|eu|global|www)$/i.test(parts[0] ?? '')) {
      parts.shift();
    }
    const stop = parts.findIndex((part) => /^(dp|gp|product|products|p|pd|item|buy|d)$/i.test(part));
    const brandParts = stop > 0 ? parts.slice(0, stop) : parts;
    return brandParts
      .flatMap((part) => tokensOf(decodeURIComponent(part)))
      .filter((token) => !PATH_SECTION.has(token));
  } catch {
    return [];
  }
}

/**
 * First brand-like token that is not the requested brand and not part of the
 * requested name/model. Later slug words ("unlocked", "charging") are ignored
 * once an expected token has already led.
 */
function allowedTokenPrefix(token: string, allowed: Set<string>): boolean {
  if (token.length < 3) return false;
  for (const known of allowed) {
    if (known.length > token.length && known.startsWith(token)) return true;
  }
  return false;
}

function leadingForeignBrand(tokens: string[], allowed: Set<string>): string | null {
  for (const token of tokens) {
    if (token.length < 3 || GENERIC.has(token) || COLORS.has(token) || isModelLike(token)) continue;
    if (PRODUCT_TYPES[token]) continue;
    if (allowed.has(token) || allowedTokenPrefix(token, allowed)) return null;
    return token;
  }
  return null;
}

function colorsIn(value: string | null | undefined): Set<string> {
  const found = new Set<string>();
  for (const token of tokensOf(value)) {
    if (!COLORS.has(token)) continue;
    found.add(token === 'grey' ? 'gray' : token);
  }
  return found;
}

function typesIn(value: string | null | undefined): Set<string> {
  const found = new Set<string>();
  for (const token of tokensOf(value)) {
    const type = PRODUCT_TYPES[token];
    if (type) found.add(type);
  }
  return found;
}

function setsConflict(left: Set<string>, right: Set<string>): boolean {
  if (!left.size || !right.size) return false;
  for (const token of left) if (right.has(token)) return false;
  return true;
}

function modelStem(token: string): string {
  return token.replace(/\d+/g, '#');
}

function meaningfulModelTokens(model: string, brand: string | null | undefined): string[] {
  const brandTokens = new Set(brandTokensOf(brand));
  return tokensOf(model).filter(
    (token) => token.length >= 2 && !GENERIC.has(token) && !COLORS.has(token) && !brandTokens.has(token),
  );
}

function impliedModelTokens(name: string | null | undefined): string[] {
  return tokensOf(name).filter((token) => /\d/.test(token) && /[a-z]/i.test(token));
}

function urlPathTokens(url: string | null | undefined): string[] {
  if (!url) return [];
  try {
    return tokensOf(decodeURIComponent(new URL(url).pathname));
  } catch {
    return [];
  }
}

/**
 * Hard identity gate. Quality scores are not an input.
 * A missing requested brand, model, color, or type is not a failure by itself;
 * a present request that the candidate contradicts is.
 */
export type ProductIdentityGateOptions = {
  /**
   * Discovery titles often omit the brand. Ranking rejects an explicit other
   * brand, then enrichment re-checks that title, extracted brand, or host
   * actually supports the requested brand.
   */
  requireBrandSupport?: boolean;
};

export function assessProductIdentityCompatibility(
  expected: ProductIdentityExpectation,
  candidate: ProductIdentityCandidate,
  options?: ProductIdentityGateOptions,
): ProductIdentityCompatibility {
  const pass = (): ProductIdentityCompatibility => ({ ok: true, reason: null });
  const fail = (reason: ProductIdentityCompatibility['reason']): ProductIdentityCompatibility => ({
    ok: false,
    reason,
  });

  const requestedBrand = brandTokensOf(expected.brand);
  const allowed = new Set<string>([
    ...requestedBrand,
    ...tokensOf(expected.name),
    ...tokensOf(expected.model),
  ]);
  const title = candidate.title ?? '';
  const foreign =
    leadingForeignBrand(tokensOf(title), allowed) ??
    leadingForeignBrand(slugTokens(candidate.merchantUrl), allowed);

  const requestedName = tokensOf(expected.name);
  // A page that names a brand is not a conflict until the request names a brand or product.
  if (foreign && (requestedBrand.length > 0 || requestedName.length > 0)) return fail('brand_conflict');
  if (requestedBrand.length) {
    const supported =
      brandSupportedByText(title, requestedBrand) ||
      brandSupportedByText(candidate.brand, requestedBrand) ||
      hostSupportsBrand(candidate.merchantUrl, requestedBrand);
    if (candidate.brand?.trim() && !brandSupportedByText(candidate.brand, requestedBrand)) {
      return fail('brand_conflict');
    }
    if (!supported && options?.requireBrandSupport !== false) return fail('brand_unsupported');
  }

  const explicitModel = expected.model?.trim()
    ? meaningfulModelTokens(expected.model, expected.brand)
    : [];
  const impliedModel = explicitModel.length ? [] : impliedModelTokens(expected.name);
  const requestedModel = explicitModel.length ? explicitModel : impliedModel;
  if (requestedModel.length) {
    const candidateModelTokens = [
      ...tokensOf(title),
      ...tokensOf(candidate.model),
      ...urlPathTokens(candidate.merchantUrl),
    ];
    const candidateModelSet = new Set(candidateModelTokens);
    if (explicitModel.length && explicitModel.some((token) => !candidateModelSet.has(token))) {
      return fail('model_missing');
    }
    const requestedSet = new Set(requestedModel);
    for (const token of candidateModelTokens) {
      if (!isModelLike(token) || requestedSet.has(token) || allowed.has(token)) continue;
      for (const required of requestedModel) {
        if (!isModelLike(required)) continue;
        const stem = modelStem(required);
        if (stem === modelStem(token) && stem.includes('#') && /[a-z]/i.test(stem)) {
          return fail('model_conflict');
        }
      }
    }
  }

  const expectedColors = new Set<string>([
    ...colorsIn(expected.name),
    ...colorsIn(expected.model),
  ]);
  const candidateColors = colorsIn(title);
  if (setsConflict(expectedColors, candidateColors)) return fail('color_conflict');

  const expectedTypes = new Set<string>([
    ...typesIn(expected.name),
    ...typesIn(expected.model),
    ...typesIn(expected.category),
  ]);
  const candidateTypes = new Set<string>([
    ...typesIn(title),
    ...typesIn(candidate.category),
    ...typesIn(slugTokens(candidate.merchantUrl).join(' ')),
  ]);
  if (setsConflict(expectedTypes, candidateTypes)) return fail('type_conflict');

  return pass();
}

export function isProductIdentityCompatible(
  expected: ProductIdentityExpectation,
  candidate: ProductIdentityCandidate,
  options?: ProductIdentityGateOptions,
): boolean {
  return assessProductIdentityCompatibility(expected, candidate, options).ok;
}

/**
 * Do not stamp the requested brand onto a page that already names another brand
 * in its title or product-url slug. A missing brand may still use the hint.
 */
export function merchantBrandAfterHint(input: {
  extractedBrand?: string | null;
  title?: string | null;
  brandHint?: string | null;
  productName?: string | null;
  merchantUrl?: string | null;
}): string | null {
  const extracted = input.extractedBrand?.trim() || null;
  if (extracted) return extracted;
  const hint = input.brandHint?.trim() || null;
  if (!hint) return null;
  const hintTokens = brandTokensOf(hint);
  const allowed = new Set<string>([...hintTokens, ...tokensOf(input.productName)]);
  const foreign =
    leadingForeignBrand(tokensOf(input.title), allowed) ??
    leadingForeignBrand(slugTokens(input.merchantUrl), allowed);
  if (foreign) return null;
  return hint;
}
