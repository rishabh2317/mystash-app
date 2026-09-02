import type {
  ProductAiReviewResult,
  ProductAiReviewSource,
  ProductAiReviewSummary,
} from '@/src/types/productAiReview';

type UnavailableReason = Extract<ProductAiReviewResult, { status: 'unavailable' }>['reason'];

function apiBase(): string | null {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  return base || null;
}

function parseSources(raw: unknown): ProductAiReviewSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductAiReviewSource[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const name = typeof (row as { name?: unknown }).name === 'string' ? (row as { name: string }).name.trim() : '';
    const url = typeof (row as { url?: unknown }).url === 'string' ? (row as { url: string }).url.trim() : '';
    if (!name || !url.startsWith('http')) continue;
    out.push({ name, url });
  }
  return out;
}

function parseAvailableSummary(raw: Record<string, unknown>, catalogProductId: string): ProductAiReviewSummary | null {
  const overview =
    typeof raw.summary === 'string' && raw.summary.trim().length > 0 ? raw.summary.trim() : null;
  const pros = Array.isArray(raw.pros)
    ? raw.pros.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim())
    : [];
  const cons = Array.isArray(raw.cons)
    ? raw.cons.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim())
    : [];
  const sources = parseSources(raw.sources);
  if (!overview && pros.length === 0 && cons.length === 0) return null;
  return {
    catalogProductId,
    overview,
    pros,
    cons,
    sources,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    evidenceLastCheckedAt:
      typeof raw.evidenceLastCheckedAt === 'string' ? raw.evidenceLastCheckedAt : null,
  };
}

const UNAVAILABLE_MESSAGES: Record<UnavailableReason, string> = {
  missing_product_id: 'This product is not ready for AI Review yet.',
  not_yet_available: 'AI Review summaries are not available for this product yet.',
  fetch_failed: 'Could not load AI Review right now.',
  network_error: 'Could not reach Mystash to load AI Review.',
  invalid_response: 'AI Review data was incomplete.',
  insufficient_evidence: 'Not enough independent review evidence was found for this product.',
  validation_failed: 'AI Review could not be validated from current web sources.',
  server_error: 'Could not load AI Review right now.',
  config_missing: 'AI Review is not configured yet.',
  api_error: 'Could not generate AI Review right now.',
  timeout: 'AI Review took too long to prepare.',
};

function unavailable(
  catalogProductId: string,
  reason: UnavailableReason,
  message?: string,
  retryEligible?: boolean,
): ProductAiReviewResult {
  return {
    status: 'unavailable',
    catalogProductId,
    reason,
    message: message?.trim() || UNAVAILABLE_MESSAGES[reason],
    retryEligible,
  };
}

function isUnavailableReason(value: string): value is UnavailableReason {
  return value in UNAVAILABLE_MESSAGES;
}

/**
 * Fetches AI Review summary from backend when available.
 * Does not synthesize pros/cons client-side.
 */
export async function fetchProductAiReview(catalogProductId: string): Promise<ProductAiReviewResult> {
  const id = catalogProductId.trim();
  if (!id) return unavailable('', 'missing_product_id');

  const base = apiBase();
  if (!base) return unavailable(id, 'network_error');

  try {
    const res = await fetch(`${base}/products/${encodeURIComponent(id)}/ai-review`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (res.status === 404) return unavailable(id, 'not_yet_available');
    if (!res.ok) return unavailable(id, 'fetch_failed');

    const body = (await res.json()) as Record<string, unknown>;
    const status = typeof body.status === 'string' ? body.status : '';

    if (status === 'generating') {
      return {
        status: 'generating',
        catalogProductId: id,
        message:
          typeof body.message === 'string' && body.message.trim()
            ? body.message.trim()
            : 'AI Review is being prepared from current web sources.',
      };
    }

    if (status === 'unavailable') {
      const reasonRaw = typeof body.reason === 'string' ? body.reason : 'not_yet_available';
      const reason = isUnavailableReason(reasonRaw) ? reasonRaw : 'not_yet_available';
      const message = typeof body.message === 'string' ? body.message : undefined;
      const retryEligible =
        typeof body.retryEligible === 'boolean' ? body.retryEligible : undefined;
      return unavailable(id, reason, message, retryEligible);
    }

    if (status === 'available') {
      const summary = parseAvailableSummary(body, id);
      if (!summary) return unavailable(id, 'invalid_response');
      return { status: 'available', summary };
    }

    // Legacy flat body without explicit status
    const legacy = parseAvailableSummary(body, id);
    if (!legacy) return unavailable(id, 'invalid_response');
    return { status: 'available', summary: legacy };
  } catch {
    return unavailable(id, 'network_error');
  }
}
