export type DiscoveredProductRecord = {
  id: string;
  identityKey: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  merchant: string | null;
  merchantUrl: string | null;
  metadata: Record<string, unknown>;
  matchConfidence: number | null;
  completeness: number | null;
  internalStatus: 'ACTIVE' | 'HIDDEN';
  catalogProductId: string | null;
  processorVersion: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

export type InsertDiscoveredProductRow = Omit<
  DiscoveredProductRecord,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'internalStatus' | 'catalogProductId'
> & {
  id?: string;
  internalStatus?: 'ACTIVE' | 'HIDDEN';
  catalogProductId?: string | null;
};
