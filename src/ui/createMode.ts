/**
 * Phase 1 Create entry mode contract.
 * Authority: docs/creator-ecosystem-architecture-audit.md (Phase 1),
 * docs/creator-ecosystem-phase-0-contracts.md
 *
 * In-memory / query-param only — no DB persistence.
 */

import { CREATE_COPY } from '@/src/ui/createCopy';

export const CREATE_MODES = ['my_content', 'curate_public', 'products_only'] as const;

export type CreateMode = (typeof CREATE_MODES)[number];

export const DEFAULT_CREATE_MODE: CreateMode = 'my_content';

export const CREATE_MODE_LABELS: Record<CreateMode, string> = {
  my_content: 'My content',
  curate_public: 'Curate public',
  products_only: 'Products',
};

export const CREATE_MODE_DESCRIPTIONS: Record<CreateMode, string> = {
  my_content: 'Build a Collection from your Reel or Short.',
  curate_public: 'Curate a public Reel or Short into a Collection.',
  products_only: 'Start with product links and a source video.',
};

export function isCreateMode(value: unknown): value is CreateMode {
  return typeof value === 'string' && (CREATE_MODES as readonly string[]).includes(value);
}

/** Parse query/deep-link values; falls back to default when missing or invalid. */
export function parseCreateMode(raw: unknown, fallback: CreateMode = DEFAULT_CREATE_MODE): CreateMode {
  if (Array.isArray(raw)) {
    return parseCreateMode(raw[0], fallback);
  }
  if (isCreateMode(raw)) return raw;
  return fallback;
}

export type CreateModeStudioCopy = {
  headline: string;
  subhead: string;
  contentUrlLabel: string;
  contentUrlPlaceholder: string;
};

/** Mode-aware studio body copy for URL-based modes (and products framing). */
export function createModeStudioCopy(mode: CreateMode): CreateModeStudioCopy {
  if (mode === 'curate_public') {
    return {
      headline: CREATE_COPY.modeCurateHeadline,
      subhead: CREATE_COPY.modeCurateSubhead,
      contentUrlLabel: CREATE_COPY.modeCurateUrlLabel,
      contentUrlPlaceholder: CREATE_COPY.contentUrlPlaceholder,
    };
  }
  if (mode === 'products_only') {
    return {
      headline: CREATE_COPY.modeProductsHeadline,
      subhead: CREATE_COPY.modeProductsSubhead,
      contentUrlLabel: CREATE_COPY.contentUrlLabel,
      contentUrlPlaceholder: CREATE_COPY.contentUrlPlaceholder,
    };
  }
  return {
    headline: CREATE_COPY.modeMyContentHeadline,
    subhead: CREATE_COPY.modeMyContentSubhead,
    contentUrlLabel: CREATE_COPY.modeMyContentUrlLabel,
    contentUrlPlaceholder: CREATE_COPY.contentUrlPlaceholder,
  };
}

/** Expo Router path for Products only → manual screen (keeps mode in query). */
export function createProductsOnlyManualHref(): string {
  return '/(tabs)/create/manual?mode=products_only';
}

/** Studio home href with optional mode query for restore / deep-link. */
export function createStudioHref(mode: CreateMode = DEFAULT_CREATE_MODE): string {
  if (mode === DEFAULT_CREATE_MODE) return '/(tabs)/create';
  return `/(tabs)/create?mode=${encodeURIComponent(mode)}`;
}
