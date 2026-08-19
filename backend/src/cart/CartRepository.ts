import type { CartItemRecord } from './domain/types';

export type CartRepository = {
  listByUser(userId: string): Promise<CartItemRecord[]>;
  findByUserAndProduct(
    userId: string,
    catalogProductId: string,
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
  /**
   * Remap all lines from source catalog id → target.
   * On unique collision (user already has target), delete the source row.
   */
  remapCatalogProduct(
    sourceId: string,
    targetId: string,
  ): Promise<{ remapped: number; collisionsResolved: number }>;
};
