import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PostgresQaSearchIndex } from './PostgresQaSearchIndex';
import { buildProductSearchDocument } from '../documents';

const docs = [1, 2, 3].map(n => buildProductSearchDocument({
  catalogProductId: `00000000-0000-0000-0000-00000000000${n}`,
  name: `Samsung Galaxy S2${n}`, searchEligible: true,
}));

test('PostgreSQL QA adapter sends entity and filters before keyset pagination', async () => {
  const calls: Record<string, unknown>[] = [];
  const db = { rpc: async (_name: string, args: Record<string, unknown>) => {
    calls.push(args);
    const after = args.p_after_id as string | null;
    const available = docs.filter(d => !after || d.id > after);
    return { data: available.slice(0, args.p_limit as number).map(d => ({
      entity_type: 'product', id: d.id, score: 5, document: d,
    })), error: null };
  } } as unknown as SupabaseClient;
  const index = new PostgresQaSearchIndex(db);
  const first = await index.lexicalPage({ q: 'samsung', exact: 'samsung', entityType: 'product',
    filters: { category: 'Phone' }, limit: 2 });
  assert.deepEqual(first.candidates.map(c => c.id), docs.slice(0, 2).map(d => d.id));
  assert.equal(first.hasMore, true);
  assert.deepEqual(calls[0]?.p_filters, { category: 'Phone' });
  assert.equal(calls[0]?.p_entity_type, 'product');
  const second = await index.lexicalPage({ q: 'samsung', exact: 'samsung', entityType: 'product',
    filters: { category: 'Phone' }, limit: 2, after: first.after });
  assert.deepEqual(second.candidates.map(c => c.id), [docs[2]!.id]);
  assert.equal(second.hasMore, false);
  assert.deepEqual(calls[1]?.p_after_id, docs[1]!.id);
});

test('PostgreSQL QA adapter propagates database errors and does not trust index writes', async () => {
  const db = { rpc: async () => ({ data: null, error: { code: '42501' } }) } as unknown as SupabaseClient;
  const index = new PostgresQaSearchIndex(db);
  await index.upsert(docs[0]!);
  await index.delete('product', docs[0]!.id);
  await assert.rejects(() => index.lexicalSearch({ q: 'galaxy', limit: 5 }), /42501/);
  await assert.rejects(() => index.ping(), /42501/);
});
