const NON_PRICE_WORDS =
  /\b(minutes?|mins?|hours?|hrs?|seconds?|secs?|read|review|latest|soon|stock|available|availability|more|free|unknown)\b/i;
const ALLOWED_PRICE_WORDS = new Set([
  'usd',
  'inr',
  'gbp',
  'eur',
  'aud',
  'cad',
  'jpy',
  'aed',
  'sgd',
  'cny',
  'hkd',
  'nzd',
  'chf',
  'sek',
  'nok',
  'dkk',
  'zar',
  'brl',
  'mxn',
  'krw',
  'thb',
  'idr',
  'myr',
  'php',
  'sar',
  'qar',
  'kwd',
  'from',
  'starting',
  'at',
  'mrp',
  'price',
  'now',
  'us',
]);
const VALID_CURRENCY_CODES = new Set([
  'USD',
  'INR',
  'GBP',
  'EUR',
  'AUD',
  'CAD',
  'JPY',
  'AED',
  'SGD',
  'CNY',
  'HKD',
  'NZD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'ZAR',
  'BRL',
  'MXN',
  'KRW',
  'THB',
  'IDR',
  'MYR',
  'PHP',
  'SAR',
  'QAR',
  'KWD',
]);

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function validPriceValue(
  value: string | null | undefined,
  currency?: string | null,
): string | null {
  const price = text(value);
  if (!price || !/\d/.test(price) || NON_PRICE_WORDS.test(price)) return null;

  const words = price.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.some((word) => !ALLOWED_PRICE_WORDS.has(word))) return null;

  const numeric = Number(price.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const hasCurrencySignal =
    /[$₹£€¥]/.test(price) ||
    words.some((word) => VALID_CURRENCY_CODES.has(word.toUpperCase())) ||
    VALID_CURRENCY_CODES.has(text(currency)?.toUpperCase() ?? '');
  if (!hasCurrencySignal) return null;

  return price;
}

export type CompletenessInput = {
  title?: string | null;
  brand?: string | null;
  image?: string | null;
  gallery?: string[] | null;
  description?: string | null;
  price?: string | null;
  currency?: string | null;
  availability?: string | null;
  specifications?: Record<string, string> | null;
};

/** Weighted completeness: important metadata cannot be masked by many minor fields. */
export function computeWeightedMetadataCompleteness(meta: CompletenessInput): number {
  let score = 0;
  if (text(meta.title) && text(meta.title)!.length >= 4) score += 25;
  const validGallery = (meta.gallery ?? []).filter((url) => /^https?:\/\//i.test(url));
  if (validGallery.length > 0 || (meta.image && /^https?:\/\//i.test(meta.image))) score += 20;
  if (meta.specifications && Object.keys(meta.specifications).length > 0) score += 20;
  if (text(meta.description) && text(meta.description)!.length >= 20) score += 15;
  if (validPriceValue(meta.price, meta.currency)) score += 10;
  if (text(meta.brand) && text(meta.brand)!.length >= 2) score += 5;
  if (text(meta.availability)) score += 5;
  return score;
}
