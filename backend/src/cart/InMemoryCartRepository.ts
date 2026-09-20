import { randomUUID } from 'node:crypto';
import type { CartRepository } from './CartRepository';
import type { CartItemRecord, CartSourceSurface } from './domain/types';

function now(): string {
  return new Date().toISOString();
}

export class InMemoryCartRepository implements CartRepository {
  items = new Map<string, CartItemRecord>(); // id → record

  private userProductKey(userId: string, catalogProductId: string): string {
    return `${userId}|c|${catalogProductId}`;
  }

  private userDiscoveredKey(userId: string, discoveredProductId: string): string {
    return `${userId}|d|${discoveredProductId}`;
  }

  private byUserProduct = new Map<string, string>();
  private byUserDiscovered = new Map<string, string>();

  async listByUser(userId: string): Promise<CartItemRecord[]> {
    return [...this.items.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
  }

  async findByUserAndProduct(
    userId: string,
    catalogProductId: string,
  ): Promise<CartItemRecord | null> {
    const id = this.byUserProduct.get(this.userProductKey(userId, catalogProductId));
    if (!id) return null;
    return this.items.get(id) ?? null;
  }

  async findByUserAndDiscovered(
    userId: string,
    discoveredProductId: string,
  ): Promise<CartItemRecord | null> {
    const id = this.byUserDiscovered.get(this.userDiscoveredKey(userId, discoveredProductId));
    if (!id) return null;
    return this.items.get(id) ?? null;
  }

  async insert(
    row: Omit<CartItemRecord, 'id' | 'addedAt' | 'updatedAt' | 'schemaVersion'> & {
      id?: string;
      addedAt?: string;
      updatedAt?: string;
      schemaVersion?: number;
    },
  ): Promise<CartItemRecord> {
    if (row.catalogProductId) {
      const key = this.userProductKey(row.userId, row.catalogProductId);
      if (this.byUserProduct.has(key)) {
        const err = new Error('duplicate cart item') as Error & { code?: string };
        err.code = '23505';
        throw err;
      }
    }
    if (row.discoveredProductId) {
      const key = this.userDiscoveredKey(row.userId, row.discoveredProductId);
      if (this.byUserDiscovered.has(key)) {
        const err = new Error('duplicate cart item') as Error & { code?: string };
        err.code = '23505';
        throw err;
      }
    }
    const ts = now();
    const record: CartItemRecord = {
      id: row.id ?? randomUUID(),
      userId: row.userId,
      catalogProductId: row.catalogProductId ?? null,
      discoveredProductId: row.discoveredProductId ?? null,
      addedAt: row.addedAt ?? ts,
      updatedAt: row.updatedAt ?? ts,
      sourceCollectionId: row.sourceCollectionId,
      sourceCreatorId: row.sourceCreatorId,
      sourceCollectionProductTagId: row.sourceCollectionProductTagId,
      sourceSurface: (row.sourceSurface as CartSourceSurface | null) ?? null,
      sourceContentSourceId: row.sourceContentSourceId ?? null,
      sourceUserImportId: row.sourceUserImportId ?? null,
      schemaVersion: row.schemaVersion ?? 1,
    };
    this.items.set(record.id, record);
    if (record.catalogProductId) {
      this.byUserProduct.set(this.userProductKey(record.userId, record.catalogProductId), record.id);
    }
    if (record.discoveredProductId) {
      this.byUserDiscovered.set(
        this.userDiscoveredKey(record.userId, record.discoveredProductId),
        record.id,
      );
    }
    return { ...record };
  }

  async deleteByUserAndProduct(userId: string, catalogProductId: string): Promise<boolean> {
    const key = this.userProductKey(userId, catalogProductId);
    const id = this.byUserProduct.get(key);
    if (!id) return false;
    const record = this.items.get(id);
    this.byUserProduct.delete(key);
    if (record?.discoveredProductId) {
      this.byUserDiscovered.delete(this.userDiscoveredKey(userId, record.discoveredProductId));
    }
    this.items.delete(id);
    return true;
  }

  async deleteByUserAndDiscovered(userId: string, discoveredProductId: string): Promise<boolean> {
    const key = this.userDiscoveredKey(userId, discoveredProductId);
    const id = this.byUserDiscovered.get(key);
    if (!id) return false;
    const record = this.items.get(id);
    this.byUserDiscovered.delete(key);
    if (record?.catalogProductId) {
      this.byUserProduct.delete(this.userProductKey(userId, record.catalogProductId));
    }
    this.items.delete(id);
    return true;
  }

  async remapCatalogProduct(
    sourceId: string,
    targetId: string,
  ): Promise<{ remapped: number; collisionsResolved: number }> {
    if (sourceId === targetId) return { remapped: 0, collisionsResolved: 0 };
    let remapped = 0;
    let collisionsResolved = 0;
    const toUpdate: CartItemRecord[] = [];

    for (const record of this.items.values()) {
      if (record.catalogProductId === sourceId) {
        toUpdate.push(record);
      }
    }

    for (const record of toUpdate) {
      const sourceKey = this.userProductKey(record.userId, sourceId);
      const targetKey = this.userProductKey(record.userId, targetId);
      const existingTargetId = this.byUserProduct.get(targetKey);

      if (existingTargetId && existingTargetId !== record.id) {
        this.byUserProduct.delete(sourceKey);
        this.items.delete(record.id);
        collisionsResolved += 1;
        continue;
      }

      this.byUserProduct.delete(sourceKey);
      const next: CartItemRecord = {
        ...record,
        catalogProductId: targetId,
        updatedAt: now(),
      };
      this.items.set(next.id, next);
      this.byUserProduct.set(targetKey, next.id);
      remapped += 1;
    }

    return { remapped, collisionsResolved };
  }
}
