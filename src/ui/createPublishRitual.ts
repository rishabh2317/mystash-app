/**
 * UX-CREATE-B.7 — Publish confirmation → publishing → success ritual helpers.
 * Pure; does not call publish APIs.
 */

export type PublishRitualPhase = 'idle' | 'confirm' | 'publishing' | 'success';

export type PublishConfirmSummary = {
  title: string;
  productCount: number;
  thumbnailUrl?: string;
  previewLine: string;
};

export function buildPublishConfirmSummary(input: {
  title?: string | null;
  productCount: number;
  thumbnailUrl?: string | null;
  previewLine: string;
}): PublishConfirmSummary {
  const trimmed = input.title?.trim();
  return {
    title: trimmed && trimmed.length > 0 ? trimmed : 'Untitled Collection',
    productCount: Math.max(0, input.productCount),
    thumbnailUrl: input.thumbnailUrl?.trim() || undefined,
    previewLine: input.previewLine,
  };
}

export function publishProductCountLabel(count: number): string {
  if (count === 1) return '1 product';
  return `${count} products`;
}

/** After a successful publish, prefer Collection page when id is present. */
export function resolvePublishSuccessCollectionId(
  collectionId: string | null | undefined,
): string | null {
  const id = collectionId?.trim();
  return id ? id : null;
}
