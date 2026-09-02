import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SupabaseCollectionRepository } from './SupabaseCollectionRepository';

/** Minimal thenable PostgREST builder for asserting embed hints + row mapping. */
function mockProductTagQuery(result: { data: unknown[]; error: null }) {
  let selectArg = '';
  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'is', 'or', 'not', 'order', 'limit', 'gt'] as const) {
    builder[method] = () => builder;
  }
  builder.select = (sql: string) => {
    selectArg = sql;
    return builder;
  };
  builder.then = (
    onFulfilled?: (value: typeof result) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return { builder, getSelect: () => selectArg };
}

describe('SupabaseCollectionRepository.listPublishedCreatorProductTagRows', () => {
  it('uses collection_id embed hint to avoid primary_product_tag_id ambiguity', async () => {
    const { builder, getSelect } = mockProductTagQuery({ data: [], error: null });
    const admin = {
      from(table: string) {
        assert.equal(table, 'collection_product_tags');
        return builder;
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseCollectionRepository(admin);
    await repo.listPublishedCreatorProductTagRows('11111111-1111-1111-1111-111111111111', {
      limit: 10,
    });

    const select = getSelect();
    assert.match(select, /collections!collection_id!inner/);
    assert.doesNotMatch(select, /collections!inner\s*\(/);
  });

  it('maps embedded collection attribution from the collection_id relationship', async () => {
    const tagRow = {
      catalog_product_id: 'prod-aaa',
      name_snapshot: 'Alpha Shoe',
      image_snapshot: 'https://example.com/a.jpg',
      brand_snapshot: 'Brand A',
      resolution_status: 'VERIFIED',
      collection_id: 'col-a',
      collections: {
        id: 'col-a',
        title: 'Summer Picks',
        creator_id: '11111111-1111-1111-1111-111111111111',
        status: 'published',
        visibility: 'public',
        moderation_state: 'clear',
        deleted_at: null,
      },
    };
    const { builder } = mockProductTagQuery({ data: [tagRow], error: null });
    const admin = {
      from: () => builder,
    } as unknown as SupabaseClient;

    const repo = new SupabaseCollectionRepository(admin);
    const rows = await repo.listPublishedCreatorProductTagRows(
      '11111111-1111-1111-1111-111111111111',
      { limit: 5 },
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.catalogProductId, 'prod-aaa');
    assert.equal(rows[0]!.collectionId, 'col-a');
    assert.equal(rows[0]!.collectionTitle, 'Summer Picks');
    assert.equal(rows[0]!.resolutionStatus, 'VERIFIED');
  });

  it('falls back to collection_id column when embed is an array', async () => {
    const tagRow = {
      catalog_product_id: 'prod-bbb',
      name_snapshot: 'Beta Bag',
      image_snapshot: null,
      brand_snapshot: null,
      resolution_status: 'UNVERIFIED',
      collection_id: 'col-b',
      collections: [
        {
          id: 'col-b',
          title: 'Winter Edit',
        },
      ],
    };
    const { builder } = mockProductTagQuery({ data: [tagRow], error: null });
    const admin = {
      from: () => builder,
    } as unknown as SupabaseClient;

    const repo = new SupabaseCollectionRepository(admin);
    const rows = await repo.listPublishedCreatorProductTagRows(
      '11111111-1111-1111-1111-111111111111',
      { limit: 5, afterCatalogProductId: 'prod-aaa' },
    );

    assert.equal(rows[0]!.collectionId, 'col-b');
    assert.equal(rows[0]!.collectionTitle, 'Winter Edit');
  });
});
