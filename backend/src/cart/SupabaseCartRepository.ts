import type { SupabaseClient } from '@supabase/supabase-js';
import type { CartRepository } from './CartRepository';
import type { CartItemRecord, CartSourceSurface } from './domain/types';

type CartItemRow = {
  id: string;
  user_id: string;
  catalog_product_id: string | null;
  discovered_product_id: string | null;
  added_at: string;
  updated_at: string;
  source_collection_id: string | null;
  source_creator_id: string | null;
  source_collection_product_tag_id: string | null;
  source_surface: string | null;
  source_content_source_id: string | null;
  source_user_import_id: string | null;
  schema_version: number;
  removed_at?: string | null;
  explicit_action_at?: string | null;
};

function mapRow(row: CartItemRow): CartItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    catalogProductId: row.catalog_product_id,
    discoveredProductId: row.discovered_product_id,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    sourceCollectionId: row.source_collection_id,
    sourceCreatorId: row.source_creator_id,
    sourceCollectionProductTagId: row.source_collection_product_tag_id,
    sourceSurface: (row.source_surface as CartSourceSurface | null) ?? null,
    sourceContentSourceId: row.source_content_source_id,
    sourceUserImportId: row.source_user_import_id,
    schemaVersion: row.schema_version,
    removedAt: row.removed_at ?? null, explicitActionAt: row.explicit_action_at ?? null,
  };
}

export class SupabaseCartRepository implements CartRepository {
  readonly putMembership: CartRepository['putMembership'];
  constructor(private readonly admin: SupabaseClient) {
    this.putMembership = async (row, automatic) => {
      const { data, error } = await this.admin.rpc('find_cart_put', {
        p_user: row.userId, p_catalog: row.catalogProductId, p_discovered: row.discoveredProductId, p_automatic: automatic,
        p_source: { source_surface: row.sourceSurface, source_collection_id: row.sourceCollectionId,
          source_creator_id: row.sourceCreatorId, source_collection_product_tag_id: row.sourceCollectionProductTagId,
          source_content_source_id: row.sourceContentSourceId, source_user_import_id: row.sourceUserImportId },
      });
      if (error || !data) throw new Error('Stash membership could not be saved');
      return { item: mapRow(data.item), created: data.created === true, suppressed: data.suppressed === true };
    };
  }

  async listByUser(userId: string): Promise<CartItemRecord[]> {
    const rows: CartItemRecord[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      let query = this.admin.from('cart_items').select('*').eq('user_id', userId);
      query = query.is('removed_at', null);
      const { data, error } = await query
        .order('added_at', { ascending: false }).order('id').range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as CartItemRow[];
      rows.push(...page.map(mapRow));
      if (page.length < pageSize) return rows;
    }
  }

  async findByUserAndProduct(
    userId: string,
    catalogProductId: string,
  ): Promise<CartItemRecord | null> {
    const { data, error } = await this.admin
      .from('cart_items')
      .select('*')
      .eq('user_id', userId)
      .eq('catalog_product_id', catalogProductId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as CartItemRow) : null;
  }

  async findByUserAndDiscovered(
    userId: string,
    discoveredProductId: string,
  ): Promise<CartItemRecord | null> {
    const { data, error } = await this.admin
      .from('cart_items')
      .select('*')
      .eq('user_id', userId)
      .eq('discovered_product_id', discoveredProductId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as CartItemRow) : null;
  }

  async insert(
    row: Omit<CartItemRecord, 'id' | 'addedAt' | 'updatedAt' | 'schemaVersion'> & {
      id?: string;
      addedAt?: string;
      updatedAt?: string;
      schemaVersion?: number;
    },
  ): Promise<CartItemRecord> {
    return (await this.putMembership(row, false)).item;
  }

  async deleteByUserAndProduct(userId: string, catalogProductId: string): Promise<boolean> {
    const { data, error } = await this.admin.rpc('find_cart_remove', { p_user: userId, p_catalog: catalogProductId, p_discovered: null });
    if (error) throw new Error('Stash membership could not be removed');
    return data === true;
  }

  async deleteByUserAndDiscovered(userId: string, discoveredProductId: string): Promise<boolean> {
    const { data, error } = await this.admin.rpc('find_cart_remove', { p_user: userId, p_catalog: null, p_discovered: discoveredProductId });
    if (error) throw new Error('Stash membership could not be removed');
    return data === true;
  }

  async remapCatalogProduct(
    sourceId: string,
    targetId: string,
  ): Promise<{ remapped: number; collisionsResolved: number }> {
    if (sourceId === targetId) return { remapped: 0, collisionsResolved: 0 };
    const { data, error } = await this.admin.rpc('find_cart_remap', { p_source: sourceId, p_target: targetId });
    if (error || !data) throw new Error('Stash identities could not be merged');
    return data;
  }
}
