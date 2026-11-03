import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import ts from 'typescript';

import { CREATE_COPY } from './createCopy';
import { resolvePublishSuccessCollectionId } from './createPublishRitual';

const entries = [
  { path: 'app/(tabs)/create/index.tsx', handler: 'onPublish' },
  { path: 'app/(tabs)/create/review.tsx', handler: 'confirmPublish' },
];

// Execute the actual screen handlers with deferred, local API fixtures. No RN
// runtime, session, network, or alternate implementation of publication logic.
function initializer(path: string, name: string): string {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) body = node.initializer!.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(body, `${name} must be exercised`);
  return body;
}

function expression(body: string, scope: Record<string, any>): (...args: any[]) => any {
  const code = ts.transpileModule(`const handler = ${body};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('scope', `with (scope) { ${code}; return handler; }`)(scope);
}

function bind(path: string, name: string, scope: Record<string, any>) {
  return expression(initializer(path, name), scope);
}

function fixture() {
  const events: string[] = [];
  const scope: Record<string, any> = {
    draft: { ingestId: 'draft', videoTitle: 'Collection', thumbnail: 'https://fixture.invalid/cover.jpg', products: [{ id: 'product' }] },
    selectedProducts: { product: true }, selectedIds: ['product'], readiness: { ready: true },
    canPublish: true, processing: false, busy: false, storyTitle: 'Collection', publishPhase: 'idle',
    publishSummary: { title: 'Collection' }, user: { id: 'owner' }, publishOwner: { current: 'owner' },
    publishEpoch: { current: 1 }, publishLock: { current: false }, CREATE_COPY,
    resolvePublishSuccessCollectionId, useCallback: (callback: unknown) => callback,
    selectedProductsCanPublish: () => true, normalizeIngestError: (e: Error) => e.message,
    setPublishPhase: (phase: string) => { scope.publishPhase = phase; events.push(phase); },
    setBusy: (busy: boolean) => { scope.busy = busy; },
    setFormError: (error: string) => { scope.error = error; },
    setPublishError: (error: string) => { scope.error = error; },
    updateIngestVideoTitle: async () => { events.push('title'); },
    removeCurationDraft: (id: string) => { assert.equal(id, 'draft'); events.push('remove'); },
    setResumeDrafts: (update: (rows: { id: string }[]) => unknown) => {
      assert.deepEqual(update([{ id: 'draft' }, { id: 'other' }]), [{ id: 'other' }]);
    },
    setDraft: () => { events.push('clear'); }, requestFeedReload: () => { events.push('reload'); },
    setPublishedCollectionId: (id: string) => { scope.collectionId = id; },
    setPublishedTitle: (title: string) => { scope.title = title; },
    setPublishedProductCount: (count: number) => { scope.count = count; },
    setPublishedCoverUrl: (url: string) => { scope.cover = url; },
    maybePromptForPush: async () => {},
  };
  return { scope, events };
}

for (const { path, handler } of entries) {
  it(`${path}: confirmation and cancellation make no publication request`, () => {
    const { scope } = fixture();
    scope.publishIngestSelection = () => assert.fail('confirmation must not call the API');
    bind(path, 'openPublishConfirm', scope)();
    assert.equal(scope.publishPhase, 'confirm');
    bind(path, 'closePublishConfirm', scope)();
    assert.equal(scope.publishPhase, 'idle');
    scope.publishPhase = 'publishing';
    bind(path, 'closePublishConfirm', scope)();
    assert.equal(scope.publishPhase, 'publishing');
  });

  it(`${path}: waits for backend confirmation, coalesces double taps, then cleans the draft once`, async () => {
    const { scope, events } = fixture();
    let finish!: (value: unknown) => void;
    let calls = 0;
    scope.publishIngestSelection = async (id: string, ids: string[]) => {
      assert.equal(id, 'draft'); assert.deepEqual(ids, ['product']); calls++;
      return new Promise((resolve) => { finish = resolve; });
    };
    scope.publishPhase = 'confirm';
    const publish = bind(path, handler, scope);
    const pending = publish();
    await publish();
    assert.equal(calls, 1);
    assert.equal(scope.publishPhase, 'publishing');
    assert.ok(!events.includes('remove'));
    finish({ ok: true, collectionId: 'collection' });
    await pending;
    assert.equal(scope.publishPhase, 'success');
    assert.equal(scope.collectionId, 'collection'); assert.equal(scope.count, 1);
    assert.equal(scope.cover, 'https://fixture.invalid/cover.jpg');
    assert.equal(events.filter((e) => e === 'remove').length, 1);
    assert.equal(scope.publishLock.current, false); assert.equal(scope.busy, false);
    await publish(); assert.equal(calls, 1);
  });

  for (const failure of ['response', 'network']) {
    it(`${path}: ${failure} failure preserves the draft and allows a confirmed retry`, async () => {
      const { scope, events } = fixture();
      scope.publishPhase = 'confirm';
      scope.publishIngestSelection = async () => {
        if (failure === 'network') throw new Error('offline');
        return { ok: false, error: 'retry' };
      };
      const publish = bind(path, handler, scope);
      await publish();
      assert.equal(scope.publishPhase, 'idle'); assert.ok(scope.error);
      assert.ok(!events.includes('remove') && !events.includes('clear'));
      scope.publishIngestSelection = async () => ({ ok: true, collectionId: 'same-draft-collection' });
      bind(path, 'openPublishConfirm', scope)();
      await publish();
      assert.equal(scope.publishPhase, 'success'); assert.equal(scope.collectionId, 'same-draft-collection');
    });
  }

  it(`${path}: an account change fences a late publication response`, async () => {
    const { scope, events } = fixture();
    let finish!: (value: unknown) => void;
    scope.publishPhase = 'confirm';
    scope.publishIngestSelection = () => new Promise((resolve) => { finish = resolve; });
    const pending = bind(path, handler, scope)();
    scope.publishOwner.current = 'another-owner'; scope.publishEpoch.current++;
    finish({ ok: true, collectionId: 'old-owner-collection' }); await pending;
    assert.ok(!events.includes('success') && !events.includes('remove'));
  });
}

it('both entry points render the existing confirmation and the single cover-based success component', () => {
  for (const { path } of entries) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /onPress=\{openPublishConfirm\}/);
    assert.match(source, /<PublishConfirmSheet\s+visible=\{publishPhase === 'confirm' \|\| publishPhase === 'publishing'\}/);
    assert.match(source, /summary=\{publishSummary\}/);
    assert.match(source, /onCancel=\{closePublishConfirm\}/);
    assert.match(source, /<PublishSuccessScreen\s+visible=\{publishPhase === 'success' && focused\}\s+coverUrl=\{publishedCoverUrl\}/);
    assert.doesNotMatch(source, /layout="editor"|layout="studio"/);
  }
  const success = readFileSync('components/create/PublishSuccessScreen.tsx', 'utf8');
  assert.equal((success.match(/<Modal /g) ?? []).length, 1);
  assert.doesNotMatch(success, /layout\??:|layout ===|canvasSoftEnd/);
  assert.ok(success.indexOf('label={CREATE_COPY.publishSuccessViewCollection}') < success.indexOf('label={CREATE_COPY.publishSuccessViewFeed}'));
  assert.match(success, /onRequestClose=\{onViewFeed\}/);
});

it('success exits reset the Create session and navigate identically from both entry points', () => {
  for (const collectionId of ['collection', null]) {
    const results: unknown[] = [];
    for (const { path } of entries) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const callbacks = new Map<string, string>();
      function visit(node: ts.Node) {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'PublishSuccessScreen') {
          for (const attr of node.attributes.properties) {
            if (ts.isJsxAttribute(attr) && attr.name.getText(source).startsWith('on') && attr.initializer &&
              ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
              callbacks.set(attr.name.getText(source), attr.initializer.expression.getText(source));
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      assert.equal(callbacks.size, 3);
      const navigations: string[] = [];
      const router = {};
      const scope = {
        router, publishedCollectionId: collectionId,
        completeCreateFlow: () => navigations.push('reset'),
        exitCreateFlowAfterSuccess: (r: unknown) => { assert.equal(r, router); navigations.push('feed'); },
        exitCreateFlowToCollection: (r: unknown, id: string) => {
          assert.equal(r, router); assert.equal(id, collectionId); navigations.push('collection');
        },
        exitCreateFlowToCreateAnother: (r: unknown) => { assert.equal(r, router); navigations.push('create'); },
      };
      for (const name of ['onViewFeed', 'onViewCollection', 'onCreateAnother']) expression(callbacks.get(name)!, scope)();
      assert.deepEqual(navigations, ['reset', 'feed', 'reset', collectionId ? 'collection' : 'feed', 'reset', 'create']);
      results.push(navigations);
    }
    assert.deepEqual(results[0], results[1]);
  }
});
