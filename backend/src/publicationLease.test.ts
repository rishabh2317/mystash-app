import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { acquirePublicationLease } from './publicationLease';
import { createPublishGuard, finalizePublication } from './publishLifecycle';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function fixture() {
  const owners = new Map<string, string>();
  let unavailable = false;
  const calls: string[] = [];
  const admin = { rpc(name: string, params: Record<string, string>) {
    const work = async () => {
      calls.push(name);
      if (unavailable) return { data: null, error: { code: 'PGRST202' } };
      const { p_ingest_id: id, p_attempt_id: attempt } = params;
      if (name === 'publication_claim') {
        if (owners.has(id)) return { data: false, error: null };
        owners.set(id, attempt); return { data: true, error: null };
      }
      if (name === 'publication_release') {
        if (owners.get(id) === attempt) owners.delete(id);
        return { data: null, error: null };
      }
      return { data: owners.get(id) === attempt, error: null };
    };
    return { abortSignal: work };
  } } as unknown as SupabaseClient;
  return { admin, owners, calls, unavailable: () => { unavailable = true; } };
}

it('independent replicas reject a concurrent request for the same draft and release it for retry', async () => {
  const db = fixture();
  const firstReplica = createPublishGuard(), secondReplica = createPublishGuard();
  const localA = firstReplica('user:draft'), localB = secondReplica('user:draft');
  // Both process-local guards admit the request; the shared DB claim decides.
  assert.ok(localA); assert.ok(localB);
  const attempts = await Promise.allSettled([
    acquirePublicationLease(db.admin, 'draft', 'user', { attemptId: 'a', heartbeat: false }),
    acquirePublicationLease(db.admin, 'draft', 'user', { attemptId: 'b', heartbeat: false }),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
  for (const result of attempts) if (result.status === 'fulfilled') await result.value.release();
  const retry = await acquirePublicationLease(db.admin, 'draft', 'user', { attemptId: 'retry', heartbeat: false });
  await retry.release(); localA(); localB();
});

it('scopes only this request transport, preserves headers, and blocks late writes after release', async () => {
  const db = fixture();
  const headers: Headers[] = [];
  const lease = await acquirePublicationLease(db.admin, 'draft', 'user', { attemptId: 'a', heartbeat: false,
    transport: async (_input, init) => { headers.push(new Headers(init?.headers)); return new Response('{}'); } });
  await lease.fetch('https://fixture.invalid/rest/v1/collections', { method: 'POST', headers: { authorization: 'fixture' } });
  assert.equal(headers[0].get('x-mystash-publish-ingest'), 'draft');
  assert.equal(headers[0].get('x-mystash-publish-attempt'), 'a');
  assert.equal(headers[0].get('authorization'), 'fixture');
  await lease.release(); await lease.release();
  assert.throws(() => lease.fetch('https://fixture.invalid'), /already ended/);
  assert.equal(db.calls.filter((name) => name === 'publication_release').length, 1);
});

it('failed renewal stops an old request and its release cannot unlock a successor', async () => {
  const db = fixture();
  const lease = await acquirePublicationLease(db.admin, 'draft', 'user', { attemptId: 'old', heartbeat: false });
  db.owners.set('draft', 'successor');
  await lease.renew();
  assert.throws(() => lease.fetch('https://fixture.invalid'), /ownership changed/);
  await lease.release();
  assert.equal(db.owners.get('draft'), 'successor');
});

it('fails closed when the migration/database is unavailable', async () => {
  const db = fixture(); db.unavailable();
  await assert.rejects(acquirePublicationLease(db.admin, 'draft', 'user', { heartbeat: false }),
    (error: Error & { statusCode?: number }) => error.statusCode === 503);
});

it('does not confirm a malformed or stale finalization response', async () => {
  const admin = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as unknown as SupabaseClient;
  await assert.rejects(finalizePublication(admin({ collectionId: 'other', videoId: 'v', products: [] }), 'i', 'c', {}, []), /not confirmed/);
  await assert.rejects(finalizePublication(admin(null, { code: '55000' }), 'i', 'c', {}, []),
    (error: Error & { statusCode?: number }) => error.statusCode === 409);
});

it('all Publish/Discard branches use a scoped admin and enqueue only committed projection IDs', () => {
  const route = readFileSync(join(__dirname, 'publish.ts'), 'utf8');
  assert.ok(route.indexOf('acquirePublicationLease(') < route.indexOf('.from(\'ingest_requests\')'));
  assert.match(route, /createSupabaseAdmin\(lease\.fetch\)/);
  assert.ok(route.indexOf('await finalizePublication(') < route.indexOf('await enqueueProductResolve('));
  assert.ok(route.indexOf('await finalizePublication(') < route.indexOf('publishSucceededEvent({'));
  assert.match(route, /await lease\?\.release\(\)/);
  assert.doesNotMatch(route, /persistPublishedIngest|from\('video_products'\)\.delete/);
});
