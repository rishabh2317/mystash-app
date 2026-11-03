import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFindHistoryController } from './findHistoryController';
import { createFindDetailController } from './findDetailController';
import { findFixture, findDetailFixture } from '@/src/ui/findTestFixtures';
import { FindApiError } from '@/src/services/findClient';
import type { FindItem, FindOwnedPage } from '@/src/services/findClient';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const counts = { all: 1205, processing: 10, completed: 1190, attention: 5, saved: 999 };
const page = (items: FindItem[], cursor: string | null = null, ownerId = 'owner'): FindOwnedPage => ({ items, nextCursor: cursor, counts, ownerId });
function timers() { let index = 0; const jobs = new Map<number, () => void>(); return { jobs, schedule(fn: () => void) { jobs.set(++index,fn); return index; }, cancel(id: unknown) { jobs.delete(id as number); } }; }
test('history keeps older pages, authoritative counts, reclassification and its existing cursor during polling', async () => {
  const head = findFixture(1,'processing'), old = findFixture(99,'processing'), timer = timers(); let complete = false;
  const controller = createFindHistoryController({ list: async options => options?.cursor ? page([old], 'older') : page([head], 'first'),
    batch: async () => ({ items: [head,old], unavailableIds: [] }), refreshLoaded: async rows => rows.map(item => complete && item.id === old.id ? { ...item, outcome: { ...item.outcome, category: 'completed', extractionActive: false, stashSync: 'complete' } } : item) }, timer);
  controller.configure('owner','processing'); controller.setActive(true); await flush();
  assert.equal(controller.getState().counts?.all,1205); await controller.loadMore();
  assert.equal(controller.getState().items.length,2); complete = true; await controller.refresh(false);
  assert.deepEqual(controller.getState().items.map(item => item.id),[head.id]); assert.equal(controller.getState().cursor,'older');
  controller.setActive(false); assert.equal(timer.jobs.size,0);
});
test('filter changes and account switches fence late responses and clear private records immediately', async () => {
  const first = deferred<FindOwnedPage>(); let calls = 0;
  const controller = createFindHistoryController({ list: async () => ++calls === 1 ? first.promise : page([findFixture(2)],null,'other'), batch: async () => ({ items: [],unavailableIds: [] }), refreshLoaded: async rows => rows }, timers());
  controller.configure('owner','completed'); controller.setActive(true); controller.configure('other','completed'); await flush();
  first.resolve(page([findFixture(1)])); await flush();
  assert.equal(controller.getState().owner,'other'); assert.deepEqual(controller.getState().items.map(item => item.id),[findFixture(2).id]);
  controller.configure(null,'completed'); assert.deepEqual(controller.getState().items,[]); assert.equal(controller.getState().counts,null);
});
test('a newer refresh wins over an in-flight page and duplicate page requests are bounded', async () => {
  const more = deferred<FindOwnedPage>(); let pages = 0;
  const controller = createFindHistoryController({ list: async options => options?.cursor ? (pages++,more.promise) : page([findFixture(1)],'cursor'), batch: async () => ({ items: [findFixture(1)],unavailableIds: [] }), refreshLoaded: async rows => rows }, timers());
  controller.configure('owner','completed'); controller.setActive(true); await flush();
  const loading = controller.loadMore(); void controller.loadMore(); await controller.refresh();
  more.resolve(page([findFixture(99)])); await loading;
  assert.equal(pages,1); assert.equal(controller.getState().items.length,1); assert.equal(controller.getState().loadingMore,false);
});
test('focus refresh updates terminal records hidden or removed on another device without losing other pages', async () => {
  const a = findFixture(1), b = findFixture(20), timer = timers(); let hide = false;
  const controller = createFindHistoryController({ list: async options => options?.cursor ? page([b],null) : page([a],'next'), batch: async ids => ({ items: hide ? [a] : [a,b], unavailableIds: hide ? ids.filter(id => id === b.id) : [] }), refreshLoaded: async rows => rows }, timer);
  controller.configure('owner','completed'); controller.setActive(true); await flush(); await controller.loadMore();
  controller.setActive(false); hide = true; controller.setActive(true); await flush();
  assert.deepEqual(controller.getState().items.map(item => item.id),[a.id]);
});
test('refresh errors preserve history and report a recoverable error instead of false emptiness', async () => {
  let offline = false;
  const controller = createFindHistoryController({ list: async () => { if (offline) throw new Error('offline'); return page([findFixture()]); }, batch: async () => ({ items: [findFixture()],unavailableIds: [] }), refreshLoaded: async rows => rows }, timers());
  controller.configure('owner','completed'); controller.setActive(true); await flush(); offline = true; await controller.refresh();
  assert.equal(controller.getState().items.length,1); assert.match(controller.getState().error!,/connection/);
});
test('detail serializes actions, reloads authoritative memberships, and keeps an uncertain outcome visible', async () => {
  let data = findDetailFixture(), changed = 0; const write = deferred<void>();
  const controller = createFindDetailController({ detail: async () => data },timers(),() => { changed++; });
  controller.configure('owner',data.id); controller.setActive(true); await flush();
  const save = controller.run('product',async () => { await write.promise; data = { ...data,products: data.products.map(p => ({ ...p,saved: false,removed: true })) }; });
  assert.equal(await controller.run('double',async () => { throw Error('should not run'); }),false);
  write.resolve(); assert.equal(await save,true); assert.equal(controller.getState().data?.products[0].saved,false); assert.equal(changed,1);
  assert.equal(await controller.run('restore',async () => { throw new FindApiError('changed',409); }),false); assert.match(controller.getState().actionError!,/changed/);
});
test('detail responses and mutation acknowledgements never cross blur or account boundaries', async () => {
  const first = deferred<ReturnType<typeof findDetailFixture>>(); let calls = 0;
  const controller = createFindDetailController({ detail: async () => ++calls === 1 ? first.promise : findDetailFixture() },timers());
  controller.configure('owner','one'); controller.setActive(true); controller.setActive(false); first.resolve(findDetailFixture()); await flush();
  assert.equal(controller.getState().data,null); controller.configure(null,'one'); assert.equal(controller.getState().loaded,false);
});
test('a missing deep-link identity ends loading without starting a request', async () => {
  const controller = createFindDetailController({ detail: async () => { throw Error('should not request'); } },timers());
  controller.configure('owner',''); controller.setActive(true); await flush();
  assert.equal(controller.getState().loaded,true); assert.equal(controller.getState().notFound,true);
});

test('URL capture validates input, sends one owner-bound request, and confirms only durable acceptance', async () => {
  const { createFindCaptureController } = await import('./findCaptureController');
  const pending = deferred<{ importId: string; created: boolean }>(); let calls = 0;
  const controller = createFindCaptureController(async (text,owner) => { calls++; assert.equal(owner,'owner'); assert.match(text,/youtube/); return pending.promise; });
  controller.configure('owner'); controller.setActive(true); controller.setInput('not a link'); await controller.submit(); assert.equal(calls,0); assert.ok(controller.getState().error);
  controller.setInput('https://www.youtube.com/shorts/abcdefghijk'); const sending = controller.submit(); await controller.submit(); assert.equal(calls,1);
  pending.resolve({ importId: findFixture().id,created: false }); await sending;
  assert.equal(controller.getState().ack?.created,false); assert.equal(controller.getState().input,'');
});
test('offline capture keeps its text and account/foreground changes cannot claim a stale acknowledgement', async () => {
  const { createFindCaptureController } = await import('./findCaptureController');
  const pending = deferred<{ importId: string; created: boolean }>();
  const controller = createFindCaptureController(async () => pending.promise); controller.configure('A'); controller.setActive(true);
  controller.setInput('https://example.com/product'); const send = controller.submit(); controller.configure('B');
  pending.resolve({ importId: findFixture().id,created: true }); await send;
  assert.equal(controller.getState().ack,null); assert.equal(controller.getState().input,'');
  const offline = createFindCaptureController(async () => { throw Error('offline'); }); offline.configure('A'); offline.setActive(true);
  offline.setInput('https://example.com/product'); await offline.submit(); assert.equal(offline.getState().input,'https://example.com/product'); assert.equal(offline.getState().ack,null);
});
test('durably queued URL acknowledgement remains distinct from server acceptance and repeated taps enqueue once',async()=>{
  const {createFindCaptureController}=await import('./findCaptureController');let calls=0;
  const controller=createFindCaptureController(async()=>{calls++;return{captureId:findFixture().id,created:true};});controller.configure('owner');controller.setActive(true);controller.setInput('https://example.com/product');
  await Promise.all([controller.submit(),controller.submit()]);assert.equal(calls,1);assert.equal(controller.getState().ack?.local,true);assert.equal(controller.getState().input,'');
});
