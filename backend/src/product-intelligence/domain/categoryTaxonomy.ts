/**
 * Map free-text extraction / merchant categories onto the Mystash allowlist.
 * Deterministic — no LLM. Unknown only when nothing defensible maps.
 */

const ALIAS_TO_CANONICAL: Record<string, string> = {
  sports: 'sports',
  sport: 'sports',
  athletic: 'sports',
  fashion: 'fashion',
  apparel: 'fashion',
  clothing: 'fashion',
  shoes: 'fashion',
  sneakers: 'fashion',
  beauty: 'beauty',
  cosmetics: 'beauty',
  skincare: 'beauty',
  electronics: 'electronics',
  electronic: 'electronics',
  tech: 'electronics',
  gadget: 'electronics',
  gadgets: 'electronics',
  headphones: 'electronics',
  headphone: 'electronics',
  earphones: 'electronics',
  earphone: 'electronics',
  earbuds: 'electronics',
  earbud: 'electronics',
  headset: 'electronics',
  audio: 'electronics',
  phone: 'electronics',
  phones: 'electronics',
  smartphone: 'electronics',
  smartphones: 'electronics',
  mobile: 'electronics',
  mobiles: 'electronics',
  iphone: 'electronics',
  laptop: 'electronics',
  laptops: 'electronics',
  notebook: 'electronics',
  notebooks: 'electronics',
  tablet: 'electronics',
  tablets: 'electronics',
  camera: 'electronics',
  cameras: 'electronics',
  tv: 'electronics',
  television: 'electronics',
  wearables: 'electronics',
  watch: 'electronics',
  watches: 'electronics',
  home: 'home',
  kitchen: 'home',
  furniture: 'home',
  housewares: 'home',
  food: 'food',
  grocery: 'food',
  snacks: 'food',
  automotive: 'automotive',
  auto: 'automotive',
  car: 'automotive',
  cars: 'automotive',
  outdoors: 'outdoors',
  outdoor: 'outdoors',
  camping: 'outdoors',
  hiking: 'outdoors',
  gaming: 'gaming',
  games: 'gaming',
  game: 'gaming',
  console: 'gaming',
  consoles: 'gaming',
  travel: 'travel',
  luggage: 'travel',
};

const CANONICAL = new Set([
  'sports',
  'fashion',
  'beauty',
  'electronics',
  'home',
  'food',
  'automotive',
  'outdoors',
  'gaming',
  'travel',
]);

export function normalizeMystashCategory(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw.toString().trim().toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ');
  if (!cleaned || cleaned === 'unknown' || cleaned === 'other' || cleaned === 'n/a') return null;

  if (CANONICAL.has(cleaned)) return cleaned;
  if (ALIAS_TO_CANONICAL[cleaned]) return ALIAS_TO_CANONICAL[cleaned]!;

  const token = cleaned.split(' ')[0] ?? '';
  if (token && ALIAS_TO_CANONICAL[token]) return ALIAS_TO_CANONICAL[token]!;
  if (token && CANONICAL.has(token)) return token;

  for (const [alias, canonical] of Object.entries(ALIAS_TO_CANONICAL)) {
    if (cleaned.includes(alias)) return canonical;
  }
  return null;
}

/** Persistable category: canonical allowlist value, or null when genuinely unknown. */
export function resolvePersistableCategory(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const mapped = normalizeMystashCategory(candidate);
    if (mapped) return mapped;
  }
  return null;
}
