import type { DiscoveredProductRecord, InsertDiscoveredProductRow } from './domain/types';

export type DiscoveredProductRepository = {
  findById(id: string): Promise<DiscoveredProductRecord | null>;
  findByIdentityKey(identityKey: string): Promise<DiscoveredProductRecord | null>;
  insert(row: InsertDiscoveredProductRow): Promise<DiscoveredProductRecord>;
  update(id: string, patch: UpdateDiscoveredProductPatch): Promise<DiscoveredProductRecord | null>;
};

export type UpdateDiscoveredProductPatch = {
  name?: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  price?: string | null;
  currency?: string | null;
  merchant?: string | null;
  merchantUrl?: string | null;
  metadata?: Record<string, unknown>;
  matchConfidence?: number | null;
  completeness?: number | null;
  processorVersion?: string | null;
};
