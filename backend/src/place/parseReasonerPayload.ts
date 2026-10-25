import type { ProductCandidate } from '../domain/types';

export type ExtractedPlaceMention = {
  name: string;
  category: string | null;
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  mentionedAddress: string | null;
  confidence: number | null;
  evidence: Record<string, unknown>;
  sources: string[];
};

const EVIDENCE_SOURCES = new Set(['VISION', 'OCR', 'LOGO', 'SCENE', 'TRANSCRIPT', 'METADATA']);

function readJson(raw: string): Record<string, unknown> | null {
  let body = raw.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence?.[1]) body = fence[1].trim();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function evidenceOf(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const summary = value.trim();
    return summary ? { summary } : {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const summary = textOrNull((value as { summary?: unknown }).summary);
  return summary ? { summary } : {};
}

function sourcesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && EVIDENCE_SOURCES.has(item));
}

export function parsePlaceMentions(payload: Record<string, unknown> | null): ExtractedPlaceMention[] {
  if (!payload || !Array.isArray(payload.places)) return [];
  const out: ExtractedPlaceMention[] = [];
  for (const item of payload.places) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name = textOrNull(row.name);
    if (!name) continue;
    const confidence =
      typeof row.confidence === 'number' && Number.isFinite(row.confidence) ? row.confidence : null;
    out.push({
      name,
      category: textOrNull(row.category),
      locality: textOrNull(row.locality),
      city: textOrNull(row.city),
      region: textOrNull(row.region),
      country: textOrNull(row.country),
      mentionedAddress: textOrNull(row.mentionedAddress),
      confidence,
      evidence: evidenceOf(row.evidence),
      sources: sourcesOf(row.sources),
    });
  }
  return out;
}

/**
 * Product parsing stays the existing object filter. Places are a sibling array.
 * Provider ids, coordinates, and ratings on a place object are ignored.
 */
export function splitReasonerPayload(raw: string): {
  products: ProductCandidate[];
  places: ExtractedPlaceMention[];
} {
  const payload = readJson(raw);
  const products = Array.isArray(payload?.products)
    ? (payload.products.filter((item) => item && typeof item === 'object') as ProductCandidate[])
    : [];
  return { products, places: parsePlaceMentions(payload) };
}
