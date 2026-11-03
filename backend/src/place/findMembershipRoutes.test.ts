import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { InMemoryPlaceRepository } from './InMemoryPlaceRepository';
import { createPlaceMembershipHandler } from './routes';

test('cleanup endpoints use the verified owner rather than request identity', async () => {
  const repo = new InMemoryPlaceRepository();
  const h = await repo.upsertHypothesis({ contentSourceId: 'source', extractedName: 'Fixture cafe', unresolvedReason: 'ambiguous' });
  const save = await repo.insertLead({ userId: 'owner', contentSourceId: 'source', contentSourcePlaceId: h.id, userImportId: 'import' });
  const req = { params: { saveId: save.id }, headers: {}, body: { userId: 'owner' } } as unknown as Request;
  const result = { status: 200, body: undefined as unknown };
  const res = { status(value: number) { result.status = value; return res; }, json(value: unknown) { result.body = value; return res; } } as unknown as Response;
  await createPlaceMembershipHandler({ repository: repo, authenticate: async () => null, restore: false })(req, res);
  assert.equal(result.status, 401);
  await createPlaceMembershipHandler({ repository: repo, authenticate: async () => ({ userId: 'other' }), restore: false })(req, res);
  assert.equal(result.status, 404); assert.equal((await repo.listSavesByUser('owner')).length, 1);
  result.status = 200;
  await createPlaceMembershipHandler({ repository: repo, authenticate: async () => ({ userId: 'owner' }), restore: false })(req, res);
  assert.equal(result.status, 200); assert.equal((await repo.listSavesByUser('owner')).length, 0);
  await createPlaceMembershipHandler({ repository: repo, authenticate: async () => ({ userId: 'owner' }), restore: true })(req, res);
  assert.equal((await repo.listSavesByUser('owner')).length, 1);
});
