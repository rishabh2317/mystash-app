/** Curated synonym map — deterministic expansion, no LLM. */
const SYNONYMS: Record<string, string[]> = {
  headphones: ['earphones', 'headset', 'buds'],
  earphones: ['headphones', 'buds', 'earbuds'],
  sneakers: ['shoes', 'trainers'],
  shoes: ['sneakers', 'footwear'],
  gifts: ['presents', 'gift ideas'],
  outfits: ['looks', 'fits', 'style'],
  gadgets: ['devices', 'tech', 'electronics'],
  backpack: ['bag', 'rucksack'],
  ladakh: ['leh', 'himalaya trip'],
};

const SPELL: Record<string, string> = {
  headfones: 'headphones',
  sneekers: 'sneakers',
  iphonee: 'iphone',
  nkie: 'nike',
  gadets: 'gadgets',
  outfites: 'outfits',
};

export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function applySpellCorrection(normalized: string): string {
  return normalized
    .split(/\s+/)
    .map((t) => SPELL[t] ?? t)
    .join(' ');
}

export function expandSynonyms(normalized: string): string {
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const extra: string[] = [];
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) extra.push(...syns);
  }
  if (extra.length === 0) return normalized;
  return `${normalized} ${extra.join(' ')}`;
}

export type PreparedQuery = {
  raw: string;
  normalized: string;
  corrected: string;
  expanded: string;
};

export type QueryConstraints = {
  priceMin?: number;
  priceMax?: number;
  /** Query text with budget phrases removed for intent + lexical match. */
  searchText: string;
};

const UNDER_RE =
  /\b(?:under|below|less\s+than|upto|up\s+to|max(?:imum)?)\s+(?:₹|rs\.?|inr|\$|usd)?\s*([\d,]+(?:\.\d+)?)(k|K)?\b/gi;
const OVER_RE =
  /\b(?:over|above|more\s+than|min(?:imum)?|from)\s+(?:₹|rs\.?|inr|\$|usd)?\s*([\d,]+(?:\.\d+)?)(k|K)?\b/gi;

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const m = cleaned.match(/^([\d.]+)\s*(k)?$/i);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  return m[2] ? base * 1000 : base;
}

/**
 * Extract deterministic price constraints from natural-language budget phrases.
 * Strips matched phrases from the returned searchText.
 */
export function extractQueryConstraints(normalized: string): QueryConstraints {
  let searchText = normalized;
  let priceMin: number | undefined;
  let priceMax: number | undefined;

  for (const match of normalized.matchAll(UNDER_RE)) {
    const raw = `${match[1] ?? ''}${match[2] ?? ''}`;
    const amount = parseAmount(raw);
    if (amount != null) priceMax = priceMax == null ? amount : Math.min(priceMax, amount);
    searchText = searchText.replace(match[0], ' ');
  }
  for (const match of normalized.matchAll(OVER_RE)) {
    const raw = `${match[1] ?? ''}${match[2] ?? ''}`;
    const amount = parseAmount(raw);
    if (amount != null) priceMin = priceMin == null ? amount : Math.max(priceMin, amount);
    searchText = searchText.replace(match[0], ' ');
  }

  searchText = searchText.replace(/\s+/g, ' ').trim();
  const out: QueryConstraints = { searchText };
  if (priceMin != null) out.priceMin = priceMin;
  if (priceMax != null) out.priceMax = priceMax;
  return out;
}

export function prepareQuery(raw: string): PreparedQuery {
  const normalized = normalizeQuery(raw);
  const corrected = applySpellCorrection(normalized);
  const expanded = expandSynonyms(corrected);
  return { raw, normalized, corrected, expanded };
}

/** Spell-correct + strip budget phrases for intent detection and primary query text. */
export function prepareSearchQuery(raw: string): PreparedQuery & QueryConstraints {
  const normalized = normalizeQuery(raw);
  const corrected = applySpellCorrection(normalized);
  const constraints = extractQueryConstraints(corrected);
  const searchCorrected = constraints.searchText || corrected;
  const expanded = expandSynonyms(searchCorrected);
  return {
    raw,
    normalized,
    corrected: searchCorrected,
    expanded,
    ...constraints,
  };
}
