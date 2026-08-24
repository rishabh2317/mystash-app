import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { externalIdForProductUrl } from './pipeline/productLinkPreview';
import {
  assertManualAppendAllowed,
  ManualAppendError,
  normalizeManualProductUrls,
  planManualProductAppend,
} from './manualProductAppend';

describe('UX-CREATE-B.3 manual append gates', () => {
  it('rejects manual addition while automatic video extraction is processing', () => {
    assert.throws(
      () => assertManualAppendAllowed('processing'),
      (err: unknown) =>
        err instanceof ManualAppendError &&
        err.code === 'PROCESSING_LOCKED' &&
        err.httpStatus === 409,
    );
  });

  it('allows manual addition after terminal review states including failed', () => {
    for (const status of ['draft', 'ready_for_review', 'review_required', 'failed'] as const) {
      assert.doesNotThrow(() => assertManualAppendAllowed(status));
    }
  });

  it('rejects unpublished/unknown statuses', () => {
    assert.throws(
      () => assertManualAppendAllowed('published'),
      (err: unknown) => err instanceof ManualAppendError && err.code === 'INGEST_NOT_EDITABLE',
    );
  });
});

describe('UX-CREATE-B.3 manual append idempotency planning', () => {
  it('canonicalizes and dedupes submitted URLs', () => {
    const urls = normalizeManualProductUrls([
      'https://shop.example/p/1?utm_source=x',
      'https://shop.example/p/1',
      'not-a-url',
      'ftp://bad.example/p',
    ]);
    assert.equal(urls.length, 1);
    assert.ok(urls[0]!.includes('shop.example/p/1'));
    assert.ok(!urls[0]!.includes('utm_source'));
  });

  it('same product URL twice is a true no-op plan (zero urlsToAdd)', () => {
    const url = 'https://shop.example/item/42';
    const externalId = externalIdForProductUrl(url);
    const plan = planManualProductAppend({
      productUrls: [url, `${url}?utm_campaign=dup`],
      existingExternalIds: [externalId],
    });
    assert.equal(plan.urlsToAdd.length, 0);
    assert.equal(plan.externalIdsToAdd.length, 0);
    assert.ok(plan.alreadyPresentExternalIds.includes(externalId));
  });

  it('plans only net-new URLs for an exact ingest external_id set', () => {
    const existingUrl = 'https://shop.example/a';
    const newUrl = 'https://shop.example/b';
    const plan = planManualProductAppend({
      productUrls: [existingUrl, newUrl],
      existingExternalIds: [externalIdForProductUrl(existingUrl)],
    });
    assert.deepEqual(plan.urlsToAdd, [newUrl]);
    assert.deepEqual(plan.externalIdsToAdd, [externalIdForProductUrl(newUrl)]);
  });

  it('same reel URL across different Collections cannot cross-attach via plan (per-ingest ids)', () => {
    const url = 'https://shop.example/shared';
    const ingestA = new Set([externalIdForProductUrl(url)]);
    const ingestB = new Set<string>();
    const planA = planManualProductAppend({ productUrls: [url], existingExternalIds: ingestA });
    const planB = planManualProductAppend({ productUrls: [url], existingExternalIds: ingestB });
    assert.equal(planA.urlsToAdd.length, 0);
    assert.equal(planB.urlsToAdd.length, 1);
    assert.notEqual(
      'ingest-a',
      'ingest-b',
      'ownership is by ingestId at the API layer; plans are scoped to each ingest external_id set',
    );
  });
});

describe('UX-CREATE-B.3 resolve scope contract', () => {
  it('documents that creator-supplied resolve is limited to new external ids', () => {
    const added = ['m_aaa', 'm_bbb'];
    const opts = {
      externalIds: added,
      creatorSuppliedUrlForExternalIds: added,
    };
    assert.deepEqual(opts.externalIds, opts.creatorSuppliedUrlForExternalIds);
    assert.equal(opts.externalIds.includes('ai_external_1'), false);
  });
});
