import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { InMemoryPlaceRepository } from './InMemoryPlaceRepository';
import { PlaceService } from './PlaceService';
import { createPlaceListHandler } from './routes';

const USER = '11111111-1111-4111-8111-111111111111';
const SOURCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IMPORT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type Captured = { status: number; body: unknown };

function fakeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

function fakeReq(authorization: string | null): Request {
  return { headers: authorization ? { authorization } : {} } as unknown as Request;
}

describe('GET /places', () => {
  it('returns 403 for an unverified email session', async () => {
    const { UnverifiedEmailError } = await import('../auth/emailVerification');
    const handler = createPlaceListHandler({
      service: { listForUser: async () => ({ items: [], itemCount: 0 }) },
      authenticate: async () => {
        throw new UnverifiedEmailError();
      },
    });
    const { res, captured } = fakeRes();
    await handler(fakeReq('Bearer token'), res);
    assert.equal(captured.status, 403);
    assert.equal((captured.body as { code?: string }).code, 'EMAIL_NOT_VERIFIED');
  });

  it('returns 401 without authorization', async () => {
    const handler = createPlaceListHandler({
      service: { listForUser: async () => ({ items: [], itemCount: 0 }) },
      authenticate: async () => ({ userId: USER }),
    });
    const { res, captured } = fakeRes();
    await handler(fakeReq(null), res);
    assert.equal(captured.status, 401);
  });

  it('returns resolved and unresolved items for the authenticated user', async () => {
    const repo = new InMemoryPlaceRepository();
    const place = await repo.insertPlace({
      provider: 'google',
      providerPlaceId: 'ChIJ-potato',
      name: 'Potato Head',
      locality: 'Seminyak',
    });
    const resolved = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Potato Head',
      unresolvedReason: 'pending_resolution',
      locality: 'Seminyak',
    });
    await repo.markHypothesisResolved(resolved.id, place.id);
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: resolved.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });
    const lead = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Cafe de Flore',
      unresolvedReason: 'name_not_distinctive',
    });
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: lead.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });

    const handler = createPlaceListHandler({
      service: new PlaceService(repo),
      authenticate: async () => ({ userId: USER }),
    });
    const { res, captured } = fakeRes();
    await handler(fakeReq('Bearer test'), res);
    assert.equal(captured.status, 200);
    const body = captured.body as { items: Array<{ kind: string; destination: { kind: string } }>; itemCount: number };
    assert.equal(body.itemCount, 2);
    assert.ok(body.items.every((item) => item.destination.kind === 'google_search'));
    assert.ok(body.items.some((item) => item.kind === 'resolved'));
    assert.ok(body.items.some((item) => item.kind === 'unresolved'));
  });
});
