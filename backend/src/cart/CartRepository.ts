import type { AddCartItemResult, CartItemRecord } from './domain/types';

export type CartRepository = {
  /** Required atomic persistence, serialized with removal. */
  putMembership: (row: Omit<CartItemRecord, 'id' | 'addedAt' | 'updatedAt' | 'schemaVersion'>, automatic: boolean) => Promise<AddCartItemResult>;
  listByUser(userId: string): Promise<CartItemRecord[]>;
  findByUserAndProduct(
    userId: string,
    catalogProductId: string,
  ): Promise<CartItemRecord | null>;
  findByUserAndDiscovered(
    userId: string,
    discoveredProductId: string,
  ): Promise<CartItemRecord | null>;
  insert(
    row: Omit<CartItemRecord, 'id' | 'addedAt' | 'updatedAt' | 'schemaVersion'> & {
      id?: string;
      addedAt?: string;
      updatedAt?: string;
      schemaVersion?: number;
    },
  ): Promise<CartItemRecord>;
  deleteByUserAndProduct(userId: string, catalogProductId: string): Promise<boolean>;
  deleteByUserAndDiscovered(userId: string, discoveredProductId: string): Promise<boolean>;
  /**
   * Remap all lines from source catalog id → target.
   * On unique collision (user already has target), delete the source row.
   */
  remapCatalogProduct(
    sourceId: string,
    targetId: string,
  ): Promise<{ remapped: number; collisionsResolved: number }>;
};
