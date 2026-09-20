import type { ProductAiReviewRecord } from '../../ai-review/domain/types';
import { validHttpUrl } from '../../shopping/urlValidation';
import type { ProductPageReviews } from './types';

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Read-only projection of a READY AI review. Does not enqueue generation
 * and does not invent ratings or review counts.
 */
export function projectReadyReview(record: ProductAiReviewRecord | null | undefined): ProductPageReviews | null {
  if (!record || record.status !== 'READY') return null;
  const likes = record.pros.map((point) => point.text.trim()).filter(Boolean);
  const concerns = record.cons.map((point) => point.text.trim()).filter(Boolean);
  const overview = text(record.summary);
  if (!overview && likes.length === 0 && concerns.length === 0) return null;

  const sources = [];
  for (const source of record.sources) {
    const url = validHttpUrl(source.url);
    const name = text(source.title) ?? text(source.domain);
    if (!url || !name) continue;
    sources.push({ name, url });
  }

  return {
    overview,
    likes,
    concerns,
    sources,
    rating: null,
    reviewCount: null,
  };
}
