import { randomUUID } from 'node:crypto';
import type { DiscoveredProductRepository } from './DiscoveredProductRepository';
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
}
