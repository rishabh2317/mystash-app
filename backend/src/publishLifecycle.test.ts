import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertPersistedCollectionLink, assertPublishCollectionAccess, createPublishGuard, finalizedPublishResponse, finalizePublication, publishCollectionOnce } from './publishLifecycle';

it('one draft mutation runs per API process, and duplicate releases cannot unlock a successor', () => {
  const begin = createPublishGuard();
  const finish = begin('owner:draft')!;
  assert.equal(begin('owner:draft'), null);
  assert.ok(begin('other:draft'));
  finish();
  const next = begin('owner:draft')!;
  finish();
  assert.equal(begin('owner:draft'), null);
  next();
  assert.ok(begin('owner:draft'));
});

it('a retry of a published ingest returns the original Collection/video IDs without another mutation', () => {
  assert.deepEqual(finalizedPublishResponse({ status: 'published', collection_id: 'collection', video_id: 'video' }, false), {
    status: 200, body: { ok: true, collectionId: 'collection', videoId: 'video', message: 'Already finalized' },
  });
  assert.equal(finalizedPublishResponse({ status: 'ready_for_review' }, false), null);
});

it('a discarded ingest cannot produce a successful publication acknowledgement', () => {
  assert.equal(finalizedPublishResponse({ status: 'rejected' }, false)?.status, 409);
  assert.equal(finalizedPublishResponse({ status: 'rejected' }, true)?.status, 200);
});

it('requires the final persisted ingest status before publication can be acknowledged', async () => {
  let operation = '';
  let error: unknown = { message: 'database write failed' };
  const admin = { rpc: async (name: string) => {
    operation = name;
    return { data: error ? null : { videoId: 'video', collectionId: 'collection', products: [] }, error };
  } } as unknown as SupabaseClient;
  await assert.rejects(finalizePublication(admin, 'ingest', 'collection', {}, []), /could not be finalized/);
  error = null;
  const result = await finalizePublication(admin, 'ingest', 'collection', {}, []);
  assert.equal(result.videoId, 'video');
  assert.equal(operation, 'publication_finalize');
});

it('a partially finalized publication resumes without another Collection or publication event', async () => {
  let publications = 0, syncs = 0;
  const collection = { id: 'same-collection', status: 'published', contentRevision: 1 };
  const result = await publishCollectionOnce(['b', 'a', 'a'], {
    read: async () => ({ collection, selected: ['a', 'b'] }),
    sync: async () => { syncs++; }, publish: async () => { publications++; return collection; },
  });
  assert.equal(result, collection);
  assert.equal(result.contentRevision, 1);
  assert.equal(publications, 0);
  assert.equal(syncs, 0);
});

it('does not rewrite an already-published selection when retrying finalization', async () => {
  await assert.rejects(publishCollectionOnce(['different'], {
    read: async () => ({ collection: { status: 'published' }, selected: ['original'] }),
    sync: async () => assert.fail('must not rewrite tags'), publish: async () => assert.fail('must not republish'),
  }), /already published/);
});

it('a genuinely unpublished draft follows the existing sync and publish operations once', async () => {
  const calls: string[] = [];
  const result = await publishCollectionOnce(['a'], {
    read: async () => ({ collection: { status: 'ready_for_review' }, selected: ['a'] }),
    sync: async () => { calls.push('sync'); }, publish: async () => { calls.push('publish'); return { status: 'published' }; },
  });
  assert.equal(result.status, 'published');
  assert.deepEqual(calls, ['sync', 'publish']);
});

it('partial-finalization recovery retains ownership, deletion and moderation gates', () => {
  const collection = { creatorId: 'owner', deletedAt: null, moderationState: 'clear' };
  assert.doesNotThrow(() => assertPublishCollectionAccess(collection, 'owner'));
  assert.throws(() => assertPublishCollectionAccess(collection, 'other'), /not found/);
  assert.throws(() => assertPublishCollectionAccess({ ...collection, deletedAt: '2026-10-28' }, 'owner'), /not found/);
  assert.throws(() => assertPublishCollectionAccess({ ...collection, moderationState: 'takedown' }, 'owner'), /moderation hold/);
});

it('an unpersisted legacy Collection link cannot be published as if preparation succeeded', async () => {
  let link: string | null = null;
  const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { collection_id: link }, error: null }) }) }) }) } as unknown as SupabaseClient;
  await assert.rejects(assertPersistedCollectionLink(admin, 'ingest', 'collection'), /preparation was not saved/);
  link = 'collection';
  await assertPersistedCollectionLink(admin, 'ingest', 'collection');
});
