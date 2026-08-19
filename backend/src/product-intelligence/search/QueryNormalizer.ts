import { canonicalizeProductIdentityText } from '../normalizer/ProductIdentityCanonicalizer';

const NOISE_WORDS = new Set([
  'announcement',
  'announced',
  'asmr',
  'review',
  'reviews',
  'rating',
  'ratings',
  'best',
  'top',
  'official',
  'product',
  'products',
  'titled',
  'title',
  'video',
  'youtube',
  'instagram',
  'item',
  'latest',
  'new',
  'newest',
  'exclusive',
  'full',
  'honest',
  'detailed',
  'ultimate',
  'viral',
  'sponsored',
  'promo',
  'promotional',
  'launch',
  'launched',
  'introducing',
  'unboxing',
  'short',
  'shorts',
  'watch',
  'seen',
  'using',
  'wearing',
  'the',
  'and',
  'with',
  'from',
  'this',
  'that',
  'for',
]);

export function normalizeQueryTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const cleaned = canonicalizeProductIdentityText(value)
    .replace(/[^a-zA-Z0-9+\- ]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        (token.length >= 2 || /^\d+$/.test(token)) &&
        !NOISE_WORDS.has(token.toLowerCase()),
    );

  const seen = new Set<string>();
  return cleaned.filter((token) => {
    const key = token.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeQueryText(
  value: string | null | undefined,
  maxTokens = 6,
): string {
  return normalizeQueryTokens(value).slice(0, maxTokens).join(' ');
}
