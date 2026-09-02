import type {
  ProductAiReviewGeneratedPayload,
  ProductAiReviewPoint,
  ProductAiReviewSource,
} from './types';

export type ReviewValidationError =
  | 'empty_payload'
  | 'missing_summary'
  | 'no_pros_or_cons'
  | 'too_many_pros'
  | 'too_many_cons'
  | 'invalid_source'
  | 'unsupported_source_reference'
  | 'empty_point';

export type ReviewValidationResult =
  | { ok: true; payload: ProductAiReviewGeneratedPayload }
  | { ok: false; error: ReviewValidationError };

function parsePoint(raw: unknown, allowedSourceIds: Set<string>): ProductAiReviewPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof (raw as { text?: unknown }).text === 'string'
    ? (raw as { text: string }).text.trim()
    : '';
  if (!text) return null;
  const evidenceRaw = (raw as { evidence?: unknown }).evidence;
  const evidence: ProductAiReviewPoint['evidence'] = [];
  if (Array.isArray(evidenceRaw)) {
    for (const row of evidenceRaw) {
      if (!row || typeof row !== 'object') continue;
      const sourceId =
        typeof (row as { sourceId?: unknown }).sourceId === 'string'
          ? (row as { sourceId: string }).sourceId.trim()
          : '';
      const claim =
        typeof (row as { claim?: unknown }).claim === 'string'
          ? (row as { claim: string }).claim.trim()
          : '';
      if (!sourceId || !claim || !allowedSourceIds.has(sourceId)) continue;
      evidence.push({ sourceId, claim });
    }
  }
  return { text, evidence };
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function parseSource(raw: unknown): ProductAiReviewSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id.trim() : '';
  const title =
    typeof (raw as { title?: unknown }).title === 'string'
      ? (raw as { title: string }).title.trim()
      : '';
  const url = typeof (raw as { url?: unknown }).url === 'string' ? (raw as { url: string }).url.trim() : '';
  if (!id || !title || !url.startsWith('http')) return null;
  const domain =
    typeof (raw as { domain?: unknown }).domain === 'string' && (raw as { domain: string }).domain.trim()
      ? (raw as { domain: string }).domain.trim()
      : domainFromUrl(url);
  if (!domain) return null;
  const publishedAtRaw = (raw as { publishedAt?: unknown }).publishedAt;
  const publishedAt =
    publishedAtRaw === null
      ? null
      : typeof publishedAtRaw === 'string' && publishedAtRaw.trim()
        ? publishedAtRaw.trim()
        : null;
  return { id, title, url, domain, publishedAt };
}

export function validateReviewOutput(
  raw: unknown,
  groundingUrls: ReadonlySet<string>,
): ReviewValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'empty_payload' };

  const summary =
    typeof (raw as { summary?: unknown }).summary === 'string'
      ? (raw as { summary: string }).summary.trim()
      : '';
  if (!summary) return { ok: false, error: 'missing_summary' };

  const sourcesRaw = (raw as { sources?: unknown }).sources;
  const sources: ProductAiReviewSource[] = [];
  if (Array.isArray(sourcesRaw)) {
    for (const row of sourcesRaw) {
      const parsed = parseSource(row);
      if (!parsed) continue;
      if (!groundingUrls.has(parsed.url)) continue;
      sources.push(parsed);
    }
  }
  if (sources.length === 0) return { ok: false, error: 'invalid_source' };

  const allowedSourceIds = new Set(sources.map((s) => s.id));

  const prosRaw = (raw as { pros?: unknown }).pros;
  const consRaw = (raw as { cons?: unknown }).cons;
  const pros: ProductAiReviewPoint[] = [];
  const cons: ProductAiReviewPoint[] = [];

  if (Array.isArray(prosRaw)) {
    for (const row of prosRaw) {
      const point = parsePoint(row, allowedSourceIds);
      if (point) pros.push(point);
    }
  }
  if (Array.isArray(consRaw)) {
    for (const row of consRaw) {
      const point = parsePoint(row, allowedSourceIds);
      if (point) cons.push(point);
    }
  }

  if (pros.length === 0 && cons.length === 0) return { ok: false, error: 'no_pros_or_cons' };
  if (pros.length > 3) return { ok: false, error: 'too_many_pros' };
  if (cons.length > 3) return { ok: false, error: 'too_many_cons' };

  const generatedAt =
    typeof (raw as { generatedAt?: unknown }).generatedAt === 'string'
      ? (raw as { generatedAt: string }).generatedAt
      : new Date().toISOString();
  const evidenceLastCheckedAt =
    typeof (raw as { evidenceLastCheckedAt?: unknown }).evidenceLastCheckedAt === 'string'
      ? (raw as { evidenceLastCheckedAt: string }).evidenceLastCheckedAt
      : generatedAt;

  return {
    ok: true,
    payload: {
      summary,
      pros,
      cons,
      sources,
      generatedAt,
      evidenceLastCheckedAt,
    },
  };
}
