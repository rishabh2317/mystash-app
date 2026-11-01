import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CollectionService } from './CollectionService';
import { InMemoryCollectionRepository } from './InMemoryCollectionRepository';

const id = '123e4567-e89b-42d3-a456-426614174000';
async function fixture() {
  const repo = new InMemoryCollectionRepository();
  const setup = new CollectionService(repo);
  const a = await setup.createDraft({ user: { id, user_metadata: { username: 'creator' } }, originType: 'url_ingest', title: 'A' });
  const b = await setup.createDraft({ user: { id }, originType: 'url_ingest', title: 'B' });
  for (const c of [a, b]) await repo.updateCollection(c.id, { creatorAvatar: 'https://fixture.invalid/old.jpg', status: 'published',
    visibility: 'public', moderationState: 'clear', publishedAt: '2026-10-01T00:00:00Z' });
  let calls = 0;
  let photo: string | null = 'https://fixture.invalid/current.jpg';
  let fail = false;
  const svc = new CollectionService(repo, { async assertCanCreateCollections() {}, async getCreatorSnapshot(userId) {
    assert.equal(userId, id); calls++;
    if (fail) throw new Error('unavailable');
    return { creatorName: 'Current name', creatorUsername: 'creator', creatorAvatar: photo,
      creatorVerified: false, creatorSnapshotUpdatedAt: '2026-10-30T00:00:00Z' };
  } });
  return { repo, svc, a, b, calls: () => calls, removePhoto: () => { photo = null; }, fail: () => { fail = true; } };
}
it('hydrates current avatars without rewriting publication snapshots or editorial identity', async () => {
  const { repo, svc, a } = await fixture();
  const stored = await repo.getCollection(a.id);
  const view = await svc.getAggregate(a.id);
  assert.equal(view?.collection.creatorAvatar, 'https://fixture.invalid/current.jpg');
  assert.equal(view?.collection.creatorName, stored?.creatorName);
  assert.deepEqual(await repo.getCollection(a.id), stored);
  assert.equal((await svc.getBySlug(a.slug))?.collection.creatorAvatar, 'https://fixture.invalid/current.jpg');
  assert.equal(await svc.getAggregate('missing'), null);
});
it('uses one lookup per creator page and preserves pagination', async () => {
  const f = await fixture();
  const page = await f.svc.listPublishedPublicByCreator(id, { limit: 1 });
  assert.equal(f.calls(), 1); assert.ok(page.nextCursor); assert.equal(page.collections.length, 1);
  assert.equal(page.collections[0].creator.avatarUrl, 'https://fixture.invalid/current.jpg');
  const next = await f.svc.listPublishedPublicByCreator(id, { limit: 1, cursor: page.nextCursor });
  assert.equal(next.collections.length, 1); assert.notEqual(next.collections[0].id, page.collections[0].id);
});
it('honors avatar removal and tolerates an unavailable profile lookup', async () => {
  const f = await fixture(); f.removePhoto();
  assert.equal((await f.svc.getAggregate(f.a.id))?.collection.creatorAvatar, null);
  f.fail();
  assert.equal((await f.svc.getAggregate(f.a.id))?.collection.creatorAvatar, 'https://fixture.invalid/old.jpg');
});
it('keeps each distinct publication snapshot if the current profile lookup fails', async () => {
  const f = await fixture();
  await f.repo.updateCollection(f.b.id, { creatorAvatar: 'https://fixture.invalid/other-old.jpg' });
  f.fail();
  const page = await f.svc.listPublishedPublicByCreator(id);
  assert.equal(f.calls(), 1);
  assert.equal(page.collections.find(c => c.id === f.a.id)?.creator.avatarUrl, 'https://fixture.invalid/old.jpg');
  assert.equal(page.collections.find(c => c.id === f.b.id)?.creator.avatarUrl, 'https://fixture.invalid/other-old.jpg');
});
