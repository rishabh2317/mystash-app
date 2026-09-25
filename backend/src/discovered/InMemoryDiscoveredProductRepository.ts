import { randomUUID } from 'node:crypto';
import type {
  DiscoveredProductRepository,
  UpdateDiscoveredProductPatch,
} from './DiscoveredProductRepository';
import type { DiscoveredProductRecord, InsertDiscoveredProductRow } from './domain/types';

function now(): string {
  return new Date().toISOString();
}

export class InMemoryDiscoveredProductRepository implements DiscoveredProductRepository {
  products = new Map<string, DiscoveredProductRecord>();
  private byKey = new Map<string, string>();

  async findById(id: string): Promise<DiscoveredProductRecord | null> {
    const row = this.products.get(id);
    return row ? { ...row, metadata: { ...row.metadata } } : null;
  }

  async findByIdentityKey(identityKey: string): Promise<DiscoveredProductRecord | null> {
    const id = this.byKey.get(identityKey);
    if (!id) return null;
    return this.findById(id);
  }

  seed(row: InsertDiscoveredProductRow): DiscoveredProductRecord {
    if (this.byKey.has(row.identityKey)) {
      const err = new Error('duplicate discovered product') as Error & { code?: string };
      err.code = '23505';
      throw err;
    }
    const ts = now();
    const record: DiscoveredProductRecord = {
      id: row.id ?? randomUUID(),
      identityKey: row.identityKey,
      name: row.name,
      brand: row.brand,
      model: row.model,
      category: row.category,
      imageUrl: row.imageUrl,
      price: row.price,
      currency: row.currency,
      merchant: row.merchant,
      merchantUrl: row.merchantUrl,
      metadata: { ...row.metadata },
      matchConfidence: row.matchConfidence,
      completeness: row.completeness,
      internalStatus: row.internalStatus ?? 'ACTIVE',
      catalogProductId: row.catalogProductId ?? null,
      processorVersion: row.processorVersion,
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: 1,
    };
    this.products.set(record.id, record);
    this.byKey.set(record.identityKey, record.id);
    return { ...record, metadata: { ...record.metadata } };
  }

  async insert(row: InsertDiscoveredProductRow): Promise<DiscoveredProductRecord> {
    return this.seed(row);
  }

  async update(id: string, patch: UpdateDiscoveredProductPatch): Promise<DiscoveredProductRecord | null> {
    const existing = this.products.get(id);
    if (!existing) return null;
    const next: DiscoveredProductRecord = {
      ...existing,
      name: patch.name !== undefined ? patch.name : existing.name,
      brand: patch.brand !== undefined ? patch.brand : existing.brand,
      model: patch.model !== undefined ? patch.model : existing.model,
      category: patch.category !== undefined ? patch.category : existing.category,
      imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : existing.imageUrl,
      price: patch.price !== undefined ? patch.price : existing.price,
      currency: patch.currency !== undefined ? patch.currency : existing.currency,
      merchant: patch.merchant !== undefined ? patch.merchant : existing.merchant,
      merchantUrl: patch.merchantUrl !== undefined ? patch.merchantUrl : existing.merchantUrl,
      metadata: patch.metadata !== undefined ? { ...patch.metadata } : { ...existing.metadata },
      matchConfidence:
        patch.matchConfidence !== undefined ? patch.matchConfidence : existing.matchConfidence,
      completeness: patch.completeness !== undefined ? patch.completeness : existing.completeness,
      processorVersion:
        patch.processorVersion !== undefined ? patch.processorVersion : existing.processorVersion,
      updatedAt: now(),
    };
    this.products.set(id, next);
    return { ...next, metadata: { ...next.metadata } };
  }
}
