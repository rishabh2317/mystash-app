import type { ProductAiReviewResult } from '@/src/types/productAiReview';

/**
 * Temporary Collection preview fixture.
 *
 * Flip `AI_REVIEW_PREVIEW_FIXTURE_ENABLED` off once the live AI Review API is
 * serving `available` summaries again. This is display-only — it does not
 * write to the backend or change product data.
 */
export const AI_REVIEW_PREVIEW_FIXTURE_ENABLED = true;

/** Full happy-path payload so the card and sheet can be visually reviewed. */
export function productAiReviewPreviewFixture(
  catalogProductId: string,
): Extract<ProductAiReviewResult, { status: 'available' }> {
  const id = catalogProductId.trim();
  return {
    status: 'available',
    summary: {
      catalogProductId: id,
      overview:
        'A well-reviewed pick for all-day wear: reviewers consistently praise comfort and everyday sound, with a few trade-offs in noisy environments.',
      pros: [
        'Comfortable for long listening sessions',
        'Clear, balanced sound for podcasts and music',
        'Secure, lightweight fit during movement',
        'Straightforward pairing and everyday controls',
      ],
      cons: [
        'Less isolating in loud environments',
        'Bass is lighter than closed-cup alternatives',
        'No active noise cancellation',
      ],
      sources: [
        { name: 'TechRadar', url: 'https://www.techradar.com' },
        { name: 'CNET', url: 'https://www.cnet.com' },
        { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter' },
        { name: 'RTINGS', url: 'https://www.rtings.com' },
      ],
      updatedAt: '2026-09-02T12:00:00.000Z',
      evidenceLastCheckedAt: '2026-09-02T12:00:00.000Z',
    },
  };
}
