/**
 * Creator Ecosystem — Phase 0 architecture contracts (types only).
 *
 * Authority: docs/creator-ecosystem-phase-0-contracts.md
 * Audit: docs/creator-ecosystem-architecture-audit.md
 *
 * Phase 0 freezes vocabulary and boundaries. It does NOT:
 * - change Create / ingest / publish / Bag / Home behavior
 * - write affiliate provenance
 * - add OAuth
 *
 * Phase 7 activates CAMPAIGN and BRAND_FEED writers. AFFILIATE_URL stays reserved.
 */

import type { ContentSourceIdentity } from '../content-source/domain/types';
import type {
  CollectionMedia,
  CollectionProductTag,
  SelectionSource,
} from '../collection/domain/types';
import type { CreatorStatus } from '../user/domain/types';

/** @see docs/creator-ecosystem-phase-0-contracts.md §1 */
export type ContentIdentity = ContentSourceIdentity;

/** @see docs/creator-ecosystem-phase-0-contracts.md §2 */
export type ContentAttachment = CollectionMedia;

/**
 * Publishable product identity SoT = catalog_products.
 * discovered_products = staging; canonical_products = URL preview cache only.
 * @see docs/creator-ecosystem-phase-0-contracts.md §3
 */
export type ProductIdentityKind = 'catalog' | 'discovered' | 'canonical_preview';

/** @see docs/creator-ecosystem-phase-0-contracts.md §4 */
export type CollectionProductAttachment = CollectionProductTag;

/**
 * Live writers today — mirrors collection_product_tags.selection_source CHECK.
 * Do not write reserved provenance values through this field until Phase 4+.
 */
export type ActiveProductProvenanceSource = SelectionSource;

/**
 * Full attachment provenance vocabulary (Phase 0 contract).
 * Reserved values must not be persisted until SelectionSource + DB CHECK are extended
 * and a deliberate writer ships (Phase 4+).
 *
 * @see docs/creator-ecosystem-phase-0-contracts.md §5
 */
export type ProductProvenanceSource =
  | ActiveProductProvenanceSource
  | 'AFFILIATE_URL'
  | 'CAMPAIGN'
  | 'BRAND_FEED';

export const ACTIVE_PRODUCT_PROVENANCE_SOURCES: readonly ActiveProductProvenanceSource[] = [
  'AI_DETECTED',
  'AI_RECOMMENDED',
  'CREATOR_MANUAL',
  'CREATOR_ACCEPTED_AI',
  'IMPORT',
  'SYSTEM',
] as const;

/** Phase 7 writers. AFFILIATE_URL stays reserved. */
export const CAMPAIGN_PRODUCT_PROVENANCE_SOURCES = ['CAMPAIGN', 'BRAND_FEED'] as const;

export type CampaignProductProvenance = (typeof CAMPAIGN_PRODUCT_PROVENANCE_SOURCES)[number];

export const RESERVED_PRODUCT_PROVENANCE_SOURCES = ['AFFILIATE_URL'] as const satisfies readonly Exclude<
  ProductProvenanceSource,
  ActiveProductProvenanceSource | CampaignProductProvenance
>[];

export const PRODUCT_PROVENANCE_SOURCES: readonly ProductProvenanceSource[] = [
  ...ACTIVE_PRODUCT_PROVENANCE_SOURCES,
  ...CAMPAIGN_PRODUCT_PROVENANCE_SOURCES,
  ...RESERVED_PRODUCT_PROVENANCE_SOURCES,
];

/**
 * Orthogonal commercial overlay — not product identity.
 * Type contract only in Phase 0 (no column / runtime wiring).
 *
 * @see docs/creator-ecosystem-phase-0-contracts.md §5.3
 */
export type CommercialSource = 'NONE' | 'AFFILIATE' | 'CAMPAIGN' | 'BRAND_FEED';

export const COMMERCIAL_SOURCES: readonly CommercialSource[] = [
  'NONE',
  'AFFILIATE',
  'CAMPAIGN',
  'BRAND_FEED',
] as const;

/** Creator capability axis on users — not a separate creator table. */
export type CreatorCapabilityStatus = CreatorStatus;

/**
 * Curator is a behavior (public content → Collection), not a user role/table.
 * @see docs/creator-ecosystem-phase-0-contracts.md §6
 */
export type ContentCurationMode = 'creator_owned' | 'curator_public';

export function isActiveProductProvenanceSource(
  value: string,
): value is ActiveProductProvenanceSource {
  return (ACTIVE_PRODUCT_PROVENANCE_SOURCES as readonly string[]).includes(value);
}

export function isCampaignProductProvenance(
  value: string,
): value is CampaignProductProvenance {
  return (CAMPAIGN_PRODUCT_PROVENANCE_SOURCES as readonly string[]).includes(value);
}

export function isReservedProductProvenanceSource(
  value: string,
): value is (typeof RESERVED_PRODUCT_PROVENANCE_SOURCES)[number] {
  return (RESERVED_PRODUCT_PROVENANCE_SOURCES as readonly string[]).includes(value);
}

export function isProductProvenanceSource(value: string): value is ProductProvenanceSource {
  return (
    isActiveProductProvenanceSource(value) ||
    isCampaignProductProvenance(value) ||
    isReservedProductProvenanceSource(value)
  );
}

/**
 * Writers may persist live selection sources plus Phase 7 campaign provenance.
 * AFFILIATE_URL stays reserved.
 */
export function assertWritableProductProvenance(
  value: ProductProvenanceSource,
): asserts value is ActiveProductProvenanceSource | CampaignProductProvenance {
  if (!isActiveProductProvenanceSource(value) && !isCampaignProductProvenance(value)) {
    throw new Error(`Product provenance "${value}" is reserved; affiliate writers are not enabled`);
  }
}
