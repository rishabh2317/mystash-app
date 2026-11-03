/** Offline API -> query service -> disposable PostgreSQL integration. No Supabase/network. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Express, Request, Response } from 'express';
import { FindQueryService } from './queryService';
import { registerFindHandlers, type FindRouteDependencies } from './routes';
import { readFindMemberships } from './membershipQuery';
import { createShareReviewService } from '../share/reviewService';
const socket = process.env.FIND_TEST_PG_SOCKET;
if (!socket?.startsWith('/private/tmp/mystash-find-foundations-')) throw new Error('A self-owned disposable fixture socket is required');
const run = promisify(execFile);
const allowed = new Set(['find_query','find_detail','find_result_action','find_outcome_memberships']);
function literal(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `ARRAY[${value.map(literal).join(',')}]::uuid[]`;
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  throw new Error('Unsupported fixture argument');
}
const db = { rpc(name: string, args: Record<string, unknown>) {
  assert.ok(allowed.has(name));
  const operation = async () => {
    const parameters = Object.entries(args).map(([key, value]) => {
      assert.match(key, /^p_[a-z_]+$/); return `${key} => ${literal(value)}`;
    }).join(',');
    const call = `public.${name}(${parameters})`;
    const sql = name === 'find_outcome_memberships' ? `SELECT coalesce(jsonb_agg(m),'[]') FROM ${call} m;` : `SELECT ${call};`;
    try {
      const { stdout } = await run('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
        '-h', socket!, '-p','55443','-U','postgres','-c',sql], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PGDATABASE: 'postgres', PGOPTIONS: '' } });
      return { data: JSON.parse(stdout), error: null };
    } catch (error) {
      const message = (error as { stderr?: string }).stderr ?? '';
      return { data: null, error: { code: message.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1] ?? 'storage' } };
    }
  };
  return { abortSignal: operation };
} } as unknown as SupabaseClient;
const user = '55555555-5555-4555-8555-555555555555', imported = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const routes = new Map<string, (req: Request, res: Response) => Promise<void>>();
const app = Object.fromEntries(['get','post','patch','delete'].map(method => [method, (path: string, handler: (req: Request, res: Response) => Promise<void>) => routes.set(`${method} ${path}`, handler)])) as unknown as Express;
const deps: FindRouteDependencies = { authenticate: async req => req.headers.authorization === 'owner' ? { userId: user }
  : req.headers.authorization === 'other' ? { userId: '22222222-2222-4222-8222-222222222222' } : null,
  queries: new FindQueryService(db), imports: { retry: async () => { throw new Error('No extraction in this integration'); }, delete: async () => { throw new Error('No history deletion in this integration'); } },
  intents: { updateIntent: async () => { throw new Error('No intent writes in this integration'); } },
  suggestions: createShareReviewService(db), suggestionsEnabled: () => false, intentEnabled: () => false };
registerFindHandlers(app, deps);
async function request(key: string, options: { auth?: string; query?: unknown; params?: unknown; body?: unknown } = {}) {
  let status = 200, body: any;
  const response = { status(n: number) { status = n; return response; }, json(value: unknown) { body = value; return response; }, setHeader() {} } as unknown as Response;
  await routes.get(key)!({ headers: { authorization: options.auth ?? 'owner' }, query: options.query ?? {}, params: options.params ?? { findId: imported }, body: options.body } as unknown as Request, response);
  return { status, body };
}
async function main() {
  const first = await request('get /finds', { query: { limit: '17' } });
  assert.equal(first.status, 200); assert.equal(first.body.items.length, 17); assert.equal(first.body.counts.all, 1206);
  const next = await request('get /finds', { query: { limit: '17', cursor: first.body.nextCursor } });
  assert.equal(next.status, 200); assert.ok(next.body.items.every((item: { id: string }) => !first.body.items.some((old: { id: string }) => old.id === item.id)));
  const detail = await request('get /finds/:findId');
  assert.equal(detail.status, 200); assert.equal(detail.body.products.length, 1006);
  assert.deepEqual(detail.body.capabilities, { suggestions: false, intent: false });
  assert.equal((await request('get /finds/:findId', { auth: 'other' })).status, 404);
  assert.equal((await request('get /finds', { auth: 'signed-out' })).status, 401);
  const product = detail.body.products[0];
  const params = { findId: imported, resultId: product.id };
  assert.equal((await request('post /finds/:findId/products/:resultId/restore', { params, body: { expectedIdentity: product.identityKey } })).status, 200);
  const restored = await request('get /finds/:findId');
  assert.equal(restored.body.outcome.savedProducts, 1); assert.equal(restored.body.outcome.foundProducts, 2);
  assert.equal((await request('get /finds/counts')).body.saved, 1);
  assert.equal((await request('delete /finds/:findId/products/:resultId', { params, body: { expectedIdentity: product.identityKey } })).status, 200);
  const membership = (await readFindMemberships(db, user, [imported])).get(imported)!;
  assert.equal(membership.selectedProducts.length, 1);
  assert.deepEqual(membership.outcome, (await request('get /finds/:findId')).body.outcome);
  const selected = detail.body.savedSuggestions[0];
  const suggestionParams = { findId: imported, resultId: selected.sourceProductId, candidateKey: selected.candidateKey };
  assert.equal((await request('post /finds/:findId/suggestions/:resultId/:candidateKey/restore', { params: suggestionParams, body: { expectedIdentity: selected.identityKey } })).status, 200);
  assert.equal((await request('delete /finds/:findId/suggestions/:resultId/:candidateKey', { params: suggestionParams, body: { expectedIdentity: selected.identityKey } })).status, 200);
  const batch = await request('post /finds/batch', { body: { ids: [imported, next.body.items[0].id] } });
  assert.equal(batch.status, 200); assert.equal(batch.body.items.length, 2);
  assert.equal((await request('post /finds/batch', { auth: 'other', body: { ids: [imported] } })).body.items.length, 0);
  assert.equal((await request('get /finds/:findId/suggestions')).status, 503);
  assert.equal((await request('get /finds', { query: { filter: ['all'] } })).status, 400);
  process.stdout.write('PASS API/query/PostgreSQL integration: pagination, counts, detail, result actions, batch, ownership and legacy outcome parity\n');
}
void main().catch(error => { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1; });
