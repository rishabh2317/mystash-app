import { projectFindOutcome } from './outcome';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertFindSchema } from './schema';
import { readFindMemberships } from './membershipQuery';
const db = (data: unknown, error: unknown = null) => ({ rpc: () => ({ abortSignal: async () => ({ data, error }) }) }) as unknown as SupabaseClient;
test('schema preflight accepts only the exact release contract and fails closed', async () => {
  await assertFindSchema(db(3));
  await assert.rejects(assertFindSchema(db(2)), /incompatible/);
  await assert.rejects(assertFindSchema(db(0)), /incompatible/);
  await assert.rejects(assertFindSchema(db(1)), /incompatible/);
  await assert.rejects(assertFindSchema(db(null, { code: '42883' })), /incompatible/);
});
test('membership reporting requires complete counts and a database snapshot', async () => {
  const row = { import_id: 'id', saved_products: 0, saved_places: 0, missing_products: 0, missing_places: 0, found_products: 0, found_places: 0, resolved_places: 0, unverified_places: 0, selected_products: [] };
  await assert.rejects(readFindMemberships(db([row]), 'owner', ['id']), /Incompatible/);
  const report = { source: null, progress: null, syncState: null, syncAttemptId: null, startedAt: '2026-11-03T00:00:00Z' };
  const outcome = projectFindOutcome({ foundProducts: 0, foundPlaces: 0, resolvedPlaces: 0, unverifiedPlaces: 0, savedProducts: 0, savedPlaces: 0, missingProducts: 0, missingPlaces: 0, snapshot: report });
  assert.equal((await readFindMemberships(db([{ ...row, report, outcome }]), 'owner', ['id'])).size, 1);
  await assert.rejects(readFindMemberships(db([{ ...row, report, found_products: -1 }]), 'owner', ['id']), /Incompatible/);
});
