import type { SupabaseClient } from '@supabase/supabase-js';
import type { CartRepository } from './CartRepository';
import type { CartItemRecord, CartSourceSurface } from './domain/types';

type CartItemRow = {
  id: string;
  user_id: string;
  catalog_product_id: string;
  added_at: string;
  updated_at: string;
  source_collection_id: string | null;
  source_creator_id: string | null;
  source_collection_product_tag_id: string | null;
  source_surface: string | null;
  schema_version: number;
};

function mapRow(row: CartItemRow): CartItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    catalogProductId: row.catalog_product_id,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    sourceCollectionId: row.source_collection_id,
    sourceCreatorId: row.source_creator_id,
    sourceCollectionProductTagId: row.source_collection_product_tag_id,
    sourceSurface: (row.source_surface as CartSourceSurface | null) ?? null,
    schemaVersion: row.schema_version,
  };
}

export class SupabaseCartRepository implements CartRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async listByUser(userId: string): Promise<CartItemRecord[]> {
    const { data, error } = await this.admin
      .from('cart_items')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as CartItemRow[]).map(mapRow);
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

  async insert(
    row: Omit<CartItemRecord, 'id' | 'addedAt' | 'updatedAt' | 'schemaVersion'> & {
      id?: string;
      addedAt?: string;
      updatedAt?: string;
      schemaVersion?: number;
    },
  ): Promise<CartItemRecord> {
    const payload: Record<string, unknown> = {
      user_id: row.userId,
      catalog_product_id: row.catalogProductId,
      source_collection_id: row.sourceCollectionId,
      source_creator_id: row.sourceCreatorId,
      source_collection_product_tag_id: row.sourceCollectionProductTagId,
      source_surface: row.sourceSurface,
      schema_version: row.schemaVersion ?? 1,
    };
    if (row.id) payload.id = row.id;
    if (row.addedAt) payload.added_at = row.addedAt;
    if (row.updatedAt) payload.updated_at = row.updatedAt;

    const { data, error } = await this.admin
      .from('cart_items')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data as CartItemRow);
  }

  async deleteByUserAndProduct(userId: string, catalogProductId: string): Promise<boolean> {
    const { data, error } = await this.admin
      .from('cart_items')
      .delete()
      .eq('user_id', userId)
      .eq('catalog_product_id', catalogProductId)
      .select('id');
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async remapCatalogProduct(
    sourceId: string,
    targetId: string,
  ): Promise<{ remapped: number; collisionsResolved: number }> {
    if (sourceId === targetId) return { remapped: 0, collisionsResolved: 0 };

    const { data: rows, error } = await this.admin
      .from('cart_items')
      .select('*')
      .eq('catalog_product_id', sourceId);
    if (error) throw error;

    let remapped = 0;
    let collisionsResolved = 0;

    for (const row of (rows ?? []) as CartItemRow[]) {
      const { data: existingTarget, error: findErr } = await this.admin
        .from('cart_items')
        .select('id')
        .eq('user_id', row.user_id)
        .eq('catalog_product_id', targetId)
        .maybeSingle();
      if (findErr) throw findErr;

      if (existingTarget && (existingTarget as { id: string }).id !== row.id) {
        const { error: delErr } = await this.admin.from('cart_items').delete().eq('id', row.id);
        if (delErr) throw delErr;
        collisionsResolved += 1;
        continue;
      }

      const { error: updErr } = await this.admin
        .from('cart_items')
        .update({
          catalog_product_id: targetId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (updErr) throw updErr;
      remapped += 1;
    }

    return { remapped, collisionsResolved };
  }
}
