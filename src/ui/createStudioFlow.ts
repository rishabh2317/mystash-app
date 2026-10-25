/**
 * Single-page Creator Studio journey: 01 Video → 02 Products → 03 Publish.
 * Pure helpers — no API or schema changes.
 */

import { CREATE_COPY } from './createCopy';
import { contentPlatformLabel } from './createEditorReadiness';

export const STUDIO_STEPS = ['video', 'products', 'publish'] as const;

export type StudioStepId = (typeof STUDIO_STEPS)[number];

export type StudioStepVisual = 'completed' | 'current' | 'upcoming';

export type StudioProgressContext = {
  hasVideo: boolean;
  hasProducts: boolean;
};

export const STUDIO_STEP_COPY: Record<StudioStepId, { index: string; label: string }> = {
  video: { index: '01', label: CREATE_COPY.stepVideo },
  products: { index: '02', label: CREATE_COPY.stepProducts },
  publish: { index: '03', label: CREATE_COPY.stepPublish },
};

export function studioStepUnlocked(step: StudioStepId, ctx: StudioProgressContext): boolean {
  if (step === 'video') return true;
  if (step === 'products') return ctx.hasVideo;
  return ctx.hasVideo && ctx.hasProducts;
}

export function studioStepComplete(step: StudioStepId, ctx: StudioProgressContext): boolean {
  if (step === 'video') return ctx.hasVideo;
  if (step === 'products') return ctx.hasProducts;
  return false;
}

export function studioStepVisual(
  step: StudioStepId,
  active: StudioStepId,
  ctx: StudioProgressContext,
): StudioStepVisual {
  if (step === active) return 'current';
  if (studioStepComplete(step, ctx)) return 'completed';
  return 'upcoming';
}

export function studioConnectorComplete(from: StudioStepId, ctx: StudioProgressContext): boolean {
  return studioStepComplete(from, ctx);
}

/** Which stage should own attention after progress changes (auto-advance). */
export function studioSuggestedFocus(ctx: StudioProgressContext): StudioStepId {
  if (ctx.hasProducts) return 'publish';
  if (ctx.hasVideo) return 'products';
  return 'video';
}

export function studioStageExpanded(step: StudioStepId, focus: StudioStepId): boolean {
  return step === focus;
}

export function studioProductsSummaryLabel(count: number): string {
  if (count < 1) return CREATE_COPY.productsNotStarted;
  if (count === 1) return '1 product';
  return `${count} products`;
}

/** Compact relative time from existing draft `updatedAt`. */
export function studioRelativeTime(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const delta = Math.max(0, nowMs - t);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return 'Just now';
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  const days = Math.floor(delta / day);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
}

/** Probe is scrollY + sticky header height. First section whose top is at/above the probe wins. */
export function studioActiveStepFromScroll(
  probeY: number,
  sectionYs: Partial<Record<StudioStepId, number>>,
): StudioStepId {
  let current: StudioStepId = 'video';
  for (const id of STUDIO_STEPS) {
    const y = sectionYs[id];
    if (typeof y === 'number' && probeY >= y) current = id;
  }
  return current;
}

export function normalizeProductHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export type StudioProductSource = 'ai' | 'link';

export function studioProductSourceLabel(source: StudioProductSource | undefined): string {
  if (source === 'link') return CREATE_COPY.productSourceLink;
  return CREATE_COPY.productSourceAi;
}

export function studioPlatformLabel(platform: string | undefined): string {
  return contentPlatformLabel(platform);
}

/** Same rows the Draft Editor lists (`draft.products` with ids). */
export function studioExtractedProducts<T extends { id?: string }>(products: T[] | undefined): Array<T & { id: string }> {
  return (products ?? []).filter((p): p is T & { id: string } => Boolean(p.id));
}

/**
 * Studio cannot show "unchecked but visible" like the editor toggle list.
 * Include extracted rows by default so ready_for_review never looks empty when
 * products exist (including UNVERIFIED / degraded pipeline source).
 */
export function studioDefaultIncludeExtracted(draft: {
  products?: { id?: string }[];
}): boolean {
  return studioExtractedProducts(draft.products).length > 0;
}

export function studioIncludedExtractedProducts<T extends { id: string }>(
  products: T[],
  selected: Record<string, boolean>,
): T[] {
  return products.filter((p) => selected[p.id] === true);
}

/** Editor empty banner is `products.length === 0` after processing — not "none selected". */
export function studioShowsNoProductsFound(input: {
  hasDraft: boolean;
  processing: boolean;
  extracting: boolean;
  extractedCount: number;
}): boolean {
  return input.hasDraft && !input.processing && !input.extracting && input.extractedCount === 0;
}
