import type { DiscoveredProductRecord, InsertDiscoveredProductRow } from './domain/types';

export type DiscoveredProductRepository = {
  findById(id: string): Promise<DiscoveredProductRecord | null>;
  findByIdentityKey(identityKey: string): Promise<DiscoveredProductRecord | null>;
  insert(row: InsertDiscoveredProductRow): Promise<DiscoveredProductRecord>;
};
