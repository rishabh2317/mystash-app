import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Express, Request, Response } from 'express';
import { registerFindHandlers, type FindRouteDependencies } from './routes';
import { ShareError } from '../share/contracts';
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const routes = new Map<string, (req: Request, res: Response) => Promise<void>>(), calls: unknown[][] = [];
  const app = Object.fromEntries(['get','post','patch','delete'].map(method => [method, (path: string, handler: (req: Request, res: Response) => Promise<void>) => routes.set(`${method} ${path}`, handler)])) as unknown as Express;
  const track = (name: string, result: unknown = {}) => async (...args: unknown[]) => { calls.push([name, ...args]); return result; };
  const deps = { authenticate: async () => ({ userId: id }),
    queries: { list: track('list'), counts: track('counts'), batch: track('batch'), detail: track('detail'), resultAction: track('result') },
    imports: { retry: track('retry'), delete: track('delete') }, intents: { updateIntent: track('intent', 2) },
    suggestions: { detail: track('suggestions'), decide: track('decide') }, suggestionsEnabled: () => false, intentEnabled: () => true,
  } as unknown as FindRouteDependencies;
  registerFindHandlers(app, deps);
  async function request(key: string, body?: unknown, params: Record<string,string> = { findId: id, resultId: id }) {
    const result = { status: 200, body: undefined as unknown, cache: '' };
    const res = { status(n: number) { result.status = n; return res; }, json(value: unknown) { result.body = value; return res; },
      setHeader(_name: string, value: string) { result.cache = value; } } as unknown as Response;
    await routes.get(key)!({ headers: { authorization: 'Bearer fixture' }, params, query: {}, body } as unknown as Request, res);
    return result;
  }
  return { request, deps, calls, routes };
}
test('Find reads and result actions work with suggestions disabled; only suggestion actions are gated', async () => {
  const f = fixture();
  for (const key of ['get /finds','get /finds/counts','get /finds/:findId','post /finds/batch',
    'delete /finds/:findId/products/:resultId','post /finds/:findId/places/:resultId/restore']) {
    const r = await f.request(key, key.endsWith('/batch') ? { ids: [id] } : undefined);
    assert.equal(r.status, 200); assert.equal(r.cache, 'private, no-store');
  }
  assert.equal((await f.request('get /finds/:findId/suggestions')).status, 503);
  assert.ok(f.calls.every(call => call[1] === id));
  assert.ok([...f.routes.keys()].indexOf('get /finds/counts') < [...f.routes.keys()].indexOf('get /finds/:findId'));
});
test('every Find endpoint authenticates before invoking services', async () => {
  const f = fixture(); f.deps.authenticate = async () => null;
  for (const key of f.routes.keys()) assert.equal((await f.request(key)).status, 401);
  assert.equal(f.calls.length, 0);
});
test('mutations reject client owner/automatic fields and malformed IDs', async () => {
  const f = fixture();
  assert.equal((await f.request('post /finds/batch', { ids: [id], userId: id })).status, 400);
  assert.equal((await f.request('post /finds/:findId/products/:resultId/restore', { automatic: true })).status, 400);
  assert.equal((await f.request('get /finds/:findId', undefined, { findId: 'bad' })).status, 404);
  assert.equal(f.calls.length, 0);
});
test('retry kind and intent revisions are forwarded to existing services with the verified owner', async () => {
  const f = fixture();
  assert.equal((await f.request('post /finds/:findId/retry', { kind: 'saving' })).status, 200);
  assert.deepEqual(f.calls[0], ['retry', id, id, 'saving']);
  assert.equal((await f.request('post /finds/:findId/retry', { kind: 'review' })).status, 400);
  assert.equal((await f.request('patch /finds/:findId/intent', { intent: { kind: 'place', note: 'cafes' }, expectedRevision: 1 })).status, 200);
  assert.deepEqual(f.calls[1], ['intent', id, id, { kind: 'place', note: 'cafes' }, 1]);
  f.deps.intents.updateIntent = async () => { throw new ShareError('revision_conflict', 409); };
  assert.equal((await f.request('patch /finds/:findId/intent', { intent: { kind: null, note: null }, expectedRevision: 1 })).status, 409);
});
