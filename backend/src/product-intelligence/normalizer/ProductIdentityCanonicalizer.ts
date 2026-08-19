const CONTENT_DESCRIPTOR_WORDS = new Set([
  'asmr',
  'best',
  'comparison',
  'comparisons',
  'demo',
  'demos',
  'explained',
  'firstlook',
  'hands-on',
  'handson',
  'impression',
  'impressions',
  'instagram',
  'item',
  'latest',
  'official',
  'overview',
  'preview',
  'previews',
  'reaction',
  'reactions',
  'rating',
  'ratings',
  'review',
  'reviews',
  'seen',
  'short',
  'shorts',
  'teaser',
  'teasers',
  'title',
  'titled',
  'top',
  'trailer',
  'trailers',
  'unbox',
  'unboxed',
  'unboxing',
  'using',
  'video',
  'walkthrough',
  'walkthroughs',
  'wearing',
  'youtube',
  'product',
  'products',
  'versus',
]);

const CONTENT_DESCRIPTOR_PHRASES = [
  /\bfirst\s+look\b/giu,
  /\bhands?\s*[-–—]?\s*on\b/giu,
  /\bin\s*[-–—]?\s*depth\b/giu,
];

function comparisonKey(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Removes content-format language without touching product identity tokens
 * such as Z, 8, Pro, Ultra, FE, storage, colour, or edition variants.
 */
export function canonicalizeProductIdentityText(
  value: string | null | undefined,
): string {
  if (!value) return '';
  let canonical = value;
  for (const phrase of CONTENT_DESCRIPTOR_PHRASES) {
    canonical = canonical.replace(phrase, ' ');
  }
  return canonical
    .split(/\s+/)
    .filter((token) => {
      const key = comparisonKey(token);
      return key && !CONTENT_DESCRIPTOR_WORDS.has(key);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeProductIdentityTokens(
  value: string | null | undefined,
): string[] {
  const tokens = canonicalizeProductIdentityText(value)
    .replace(/[^a-zA-Z0-9+\- ]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  return tokens.filter((token) => {
    const key = token.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
