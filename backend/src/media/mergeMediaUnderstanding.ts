import type { MediaUnderstandingResult } from '../domain/types';

/** Merge Stage 2 MU with incremental Stage 3 facts (prefer higher scene confidence). */
export function mergeMediaUnderstanding(
  prior: MediaUnderstandingResult | null,
  next: MediaUnderstandingResult,
): MediaUnderstandingResult {
  if (!prior) return next;
  const scene =
    (next.scene?.confidence ?? 0) >= (prior.scene?.confidence ?? 0) ? next.scene : prior.scene;
  return {
    objects: [...prior.objects, ...next.objects],
    logos: [...prior.logos, ...next.logos],
    scene,
    activities: [...prior.activities, ...next.activities],
    ocr: [...prior.ocr, ...next.ocr],
    frames: [...prior.frames, ...next.frames],
    providerMeta: { ...prior.providerMeta, ...next.providerMeta },
  };
}
