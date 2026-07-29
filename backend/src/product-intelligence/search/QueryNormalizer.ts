const NOISE_WORDS = new Set([
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
  const cleaned = value
    .replace(/[^a-zA-Z0-9+\- ]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !NOISE_WORDS.has(token.toLowerCase()));

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
