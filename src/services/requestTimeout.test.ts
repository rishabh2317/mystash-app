import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AbortController as NativeAbortController, AbortSignal as NativeAbortSignal } from 'abort-controller';
import { withRequestTimeout } from './requestTimeout';
import { createFindClient } from './findClient';
import { findDetailFixture } from '@/src/ui/findTestFixtures';

test('Find requests and timeouts work with the AbortController polyfill installed by React Native', async () => {
  const original = globalThis.AbortController;
  globalThis.AbortController = NativeAbortController as unknown as typeof AbortController;
  try {
    assert.equal('timeout' in NativeAbortSignal,false);
    const api = createFindClient({ baseURL: () => 'https://fixture.invalid', session: async () => ({ userId: 'owner',accessToken: 'dummy' }),
      fetch: async (_input,init) => { assert.ok(init?.signal instanceof NativeAbortSignal); return Response.json(findDetailFixture()); } });
    assert.equal((await api.detail(findDetailFixture().id)).capabilities.intent,true);
    await assert.rejects(withRequestTimeout(5,signal => new Promise((_resolve,reject) => signal.addEventListener('abort',() => reject(Error('timed out'))))),/timed out/);
  } finally { globalThis.AbortController = original; }
});
test('request errors propagate and successful calls retain their response', async () => {
  assert.equal(await withRequestTimeout(1000,async () => 'received'),'received');
  await assert.rejects(withRequestTimeout(1000,async () => { throw Error('offline'); }),/offline/);
});
