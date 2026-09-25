import type { DiscoveredProductDraft } from '../product-intelligence/domain/types';
import type {
  DiscoveredProductRepository,
  UpdateDiscoveredProductPatch,
} from './DiscoveredProductRepository';
import type { DiscoveredProductRecord } from './domain/types';

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '23505' || Boolean(e.message?.toLowerCase().includes('duplicate'));
}

/** Same http(s) gate used across PI / enrichment image persistence. */
function httpImageUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * Global discovered-product identity. Never writes catalog_products.
 */
export class DiscoveredProductService {
  constructor(private readonly repo: DiscoveredProductRepository) {}

  async getById(id: string): Promise<DiscoveredProductRecord | null> {
    return this.repo.findById(id);
  }

  /**
   * When reusing an identity, backfill imageUrl only if the stored row has none
   * and the draft carries a valid HTTP image. Never overwrites an existing image.
   */
  private async maybeBackfillImage(
    existing: DiscoveredProductRecord,
    draft: DiscoveredProductDraft,
  ): Promise<DiscoveredProductRecord> {
    if (existing.imageUrl) return existing;
    const imageUrl = httpImageUrl(draft.imageUrl);
    if (!imageUrl) return existing;
    const updated = await this.repo.update(existing.id, { imageUrl });
    return updated ?? existing;
  }

  async getOrCreate(
    draft: DiscoveredProductDraft,
    processorVersion: string | null = null,
  ): Promise<{ record: DiscoveredProductRecord; created: boolean }> {
    const existing = await this.repo.findByIdentityKey(draft.identityKey);
    if (existing) {
      const record = await this.maybeBackfillImage(existing, draft);
      return { record, created: false };
    }

    try {
      const record = await this.repo.insert({
        identityKey: draft.identityKey,
        name: draft.name,
        brand: draft.brand,
        model: draft.model,
        category: draft.category,
        imageUrl: draft.imageUrl,
        price: draft.price,
        currency: draft.currency,
        merchant: draft.merchant,
        merchantUrl: draft.merchantUrl,
        metadata: draft.metadata,
        matchConfidence: draft.matchConfidence,
        completeness: draft.completeness,
        processorVersion,
      });
      return { record, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.repo.findByIdentityKey(draft.identityKey);
      if (!winner) throw err;
      const record = await this.maybeBackfillImage(winner, draft);
      return { record, created: false };
    }
  }

  /** In-place merchant enrichment after Bag insertion. Never creates catalog rows. */
  async applyEnrichment(
    id: string,
    draft: DiscoveredProductDraft,
    processorVersion: string | null = null,
  ): Promise<DiscoveredProductRecord | null> {
    const patch: UpdateDiscoveredProductPatch = {
      name: draft.name,
      brand: draft.brand,
      model: draft.model,
      category: draft.category,
      imageUrl: draft.imageUrl,
      price: draft.price,
      currency: draft.currency,
      merchant: draft.merchant,
      merchantUrl: draft.merchantUrl,
      metadata: {
        ...draft.metadata,
        enrichmentStatus: 'ready',
      },
      matchConfidence: draft.matchConfidence,
      completeness: draft.completeness,
      processorVersion,
    };
    return this.repo.update(id, patch);
  }
}
