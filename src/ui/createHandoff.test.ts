import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ingestAllowsManualProducts, ingestEditorShowsProcessing } from './createHandoff';

describe('UX-CREATE-B.2 editor handoff', () => {
  it('treats pending extraction as Editor processing, not Studio blocking', () => {
    assert.equal(
      ingestEditorShowsProcessing({ extractionPending: true, status: 'processing', products: [] }),
      true,
    );
    assert.equal(ingestEditorShowsProcessing({ status: 'processing', products: [] }), true);
  });

  it('keeps processing UI while status is processing even if products appeared', () => {
    assert.equal(
      ingestEditorShowsProcessing({ status: 'processing', products: [{ id: 'p1' }] }),
      true,
    );
    assert.equal(
      ingestEditorShowsProcessing({ status: 'ready_for_review', products: [] }),
      false,
    );
  });
});

describe('UX-CREATE-B.3 mode locking', () => {
  it('locks manual products while automatic extraction is processing', () => {
    assert.equal(ingestAllowsManualProducts({ status: 'processing' }), false);
    assert.equal(ingestAllowsManualProducts({ extractionPending: true, status: 'draft' }), false);
  });

  it('allows manual products after terminal review states including failed', () => {
    assert.equal(ingestAllowsManualProducts({ status: 'ready_for_review' }), true);
    assert.equal(ingestAllowsManualProducts({ status: 'review_required' }), true);
    assert.equal(ingestAllowsManualProducts({ status: 'failed' }), true);
    assert.equal(ingestAllowsManualProducts({ status: 'draft' }), true);
  });
});
