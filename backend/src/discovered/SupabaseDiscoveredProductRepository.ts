import type { SupabaseClient } from '@supabase/supabase-js';
import type { DiscoveredProductRepository } from './DiscoveredProductRepository';
import type { DiscoveredProductRecord, InsertDiscoveredProductRow } from './domain/types';

type Row = {
  id: string;
  identity_key: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  image_url: string | null;
  price: string | null;
  currency: string | null;
  merchant: string | null;
  merchant_url: string | null;
  metadata: unknown;
  match_confidence: number | null;
  completeness: number | null;
  internal_status: string;
  catalog_product_id: string | null;
  processor_version: string | null;
  created_at: string;
  updated_at: string;
  schema_version: number;
};

function mapRow(row: Row): DiscoveredProductRecord {
  return {
    id: row.id,
    identityKey: row.identity_key,
    name: row.name,
    brand: row.brand,
    model: row.model,
    category: row.category,
    imageUrl: row.image_url,
    price: row.price,
    currency: row.currency,
    merchant: row.merchant,
    merchantUrl: row.merchant_url,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    matchConfidence: row.match_confidence,
    completeness: row.completeness,
    internalStatus: row.internal_status === 'HIDDEN' ? 'HIDDEN' : 'ACTIVE',
    catalogProductId: row.catalog_product_id,
    processorVersion: row.processor_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schemaVersion: row.schema_version,
  };
}

export class SupabaseDiscoveredProductRepository implements DiscoveredProductRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async findById(id: string): Promise<DiscoveredProductRecord | null> {
    const { data, error } = await this.admin
      .from('discovered_products')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as Row) : null;
  }

  async findByIdentityKey(identityKey: string): Promise<DiscoveredProductRecord | null> {
    const { data, error } = await this.admin
      .from('discovered_products')
      .select('*')
      .eq('identity_key', identityKey)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as Row) : null;
  }

  async insert(row: InsertDiscoveredProductRow): Promise<DiscoveredProductRecord> {
    const { data, error } = await this.admin
      .from('discovered_products')
      .insert({
        identity_key: row.identityKey,
        name: row.name,
        brand: row.brand,
        model: row.model,
        category: row.category,
        image_url: row.imageUrl,
        price: row.price,
        currency: row.currency,
        merchant: row.merchant,
        merchant_url: row.merchantUrl,
        metadata: row.metadata,
        match_confidence: row.matchConfidence,
        completeness: row.completeness,
        internal_status: row.internalStatus ?? 'ACTIVE',
        processor_version: row.processorVersion,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data as Row);
  }
}
