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

export function prepareQuery(raw: string): PreparedQuery {
  const normalized = normalizeQuery(raw);
  const corrected = applySpellCorrection(normalized);
  const expanded = expandSynonyms(corrected);
  return { raw, normalized, corrected, expanded };
}
