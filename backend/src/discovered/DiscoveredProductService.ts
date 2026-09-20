import type { DiscoveredProductDraft } from '../product-intelligence/domain/types';
import type { DiscoveredProductRepository } from './DiscoveredProductRepository';
import type { DiscoveredProductRecord } from './domain/types';

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '23505' || Boolean(e.message?.toLowerCase().includes('duplicate'));
}

/**
 * Global discovered-product identity. Never writes catalog_products.
 */
export class DiscoveredProductService {
  constructor(private readonly repo: DiscoveredProductRepository) {}

  async getById(id: string): Promise<DiscoveredProductRecord | null> {
    return this.repo.findById(id);
  }

  async getOrCreate(
    draft: DiscoveredProductDraft,
    processorVersion: string | null = null,
  ): Promise<{ record: DiscoveredProductRecord; created: boolean }> {
    const existing = await this.repo.findByIdentityKey(draft.identityKey);
    if (existing) return { record: existing, created: false };

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
      return { record: winner, created: false };
    }
  }
}
