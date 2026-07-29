import type { AiDraftInput, NormalizedProduct } from '../domain/types';

const BRAND_ALIASES: Record<string, string> = {
  apple: 'Apple',
  samsung: 'Samsung',
  nike: 'Nike',
  adidas: 'Adidas',
  sony: 'Sony',
  google: 'Google',
  microsoft: 'Microsoft',
};

const NAME_ALIASES: Record<string, string> = {
  macbook: 'MacBook',
  iphone: 'iPhone',
  ipad: 'iPad',
  airpods: 'AirPods',
};

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripPunct(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s+.-]/gu, ' ');
}

function dedupeWords(s: string): string {
  const parts = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1]!.toLowerCase() === p.toLowerCase()) continue;
    out.push(p);
  }
  return out.join(' ');
}

/** Title-case with known product token aliases. */
function titleCaseProduct(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (NAME_ALIASES[lower]) return NAME_ALIASES[lower]!;
      if (/^[a-z]/.test(w) && w.length <= 3 && /[0-9]/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

export function toCanonicalSlug(parts: string[]): string {
  const raw = parts.filter(Boolean).join(' ').toLowerCase();
  const slug = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'product';
}

export class ProductNormalizer {
  normalize(draft: AiDraftInput): NormalizedProduct {
    const rawName = collapseWs(stripPunct(draft.name || ''));
    const name = titleCaseProduct(dedupeWords(rawName));
    let brand =
      draft.brand == null || String(draft.brand).trim() === ''
        ? null
        : titleCaseProduct(collapseWs(String(draft.brand)));
    if (brand) {
      const bKey = brand.toLowerCase();
      if (BRAND_ALIASES[bKey]) brand = BRAND_ALIASES[bKey]!;
    }
    // Infer brand from leading token aliases
    if (!brand) {
      const first = name.split(/\s+/)[0]?.toLowerCase();
      if (first && BRAND_ALIASES[first]) brand = BRAND_ALIASES[first]!;
    }

    const model =
      draft.model == null || String(draft.model).trim() === ''
        ? null
        : collapseWs(String(draft.model));

    const category = (draft.category || 'unknown').toString().trim().toLowerCase() || 'unknown';
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const normalizedBrand = brand ? brand.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : null;

    const aliases = new Set<string>();
    aliases.add(normalizedName);
    aliases.add(rawName.toLowerCase());
    if (brand && model) aliases.add(`${brand} ${model}`.toLowerCase());

    const slugBase = toCanonicalSlug([brand ?? '', name, model ?? '']);

    return {
      name,
      brand,
      model,
      category,
      normalizedName,
      normalizedBrand,
      canonicalSlugBase: slugBase,
      aliases: [...aliases].filter(Boolean),
      aiConfidence: Math.max(0, Math.min(1, Number(draft.confidence) || 0)),
      merchantUrlHint: draft.merchantUrl?.startsWith('http') ? draft.merchantUrl : null,
      imageHint: draft.image ?? null,
      priceHint: draft.price ?? null,
      currencyHint: draft.currency ?? null,
    };
  }
}
