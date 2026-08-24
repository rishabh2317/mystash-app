import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CREATE_DRAFT_SEGMENT_CAPS,
  createDraftSegmentActionLabel,
  createDraftSegmentForStatus,
  isCreateDraftFreshForStudio,
  segmentCreateDrafts,
} from './createDraftSegments';

function item(
  partial: Partial<{
    id: string;
    status: string;
    updatedAt: string;
    sourceUrl: string;
    videoTitle: string;
  }>,
) {
  return {
    id: partial.id ?? 'id',
    sourceUrl: partial.sourceUrl ?? 'https://youtube.com/shorts/x',
    status: partial.status ?? 'draft',
    videoTitle: partial.videoTitle,
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  };
}

describe('UX-CREATE-B.4 draft segmentation', () => {
  it('maps statuses into Continue / Processing / Needs attention', () => {
    assert.equal(createDraftSegmentForStatus('draft'), 'continue');
    assert.equal(createDraftSegmentForStatus('ready_for_review'), 'continue');
    assert.equal(createDraftSegmentForStatus('processing'), 'processing');
    assert.equal(createDraftSegmentForStatus('failed'), 'attention');
    assert.equal(createDraftSegmentForStatus('review_required'), 'attention');
    assert.equal(createDraftSegmentForStatus('published'), null);
  });

  it('caps Continue at 3, Processing at 2, Needs attention at 2', () => {
    const drafts = [
      item({ id: 'c1', status: 'ready_for_review' }),
      item({ id: 'c2', status: 'draft' }),
      item({ id: 'c3', status: 'ready_for_review' }),
      item({ id: 'c4', status: 'draft' }),
      item({ id: 'p1', status: 'processing' }),
      item({ id: 'p2', status: 'processing' }),
      item({ id: 'p3', status: 'processing' }),
      item({ id: 'a1', status: 'failed' }),
      item({ id: 'a2', status: 'review_required' }),
      item({ id: 'a3', status: 'failed' }),
    ];
    const segmented = segmentCreateDrafts(drafts);
    assert.equal(CREATE_DRAFT_SEGMENT_CAPS.continue, 3);
    assert.deepEqual(
      segmented.continueCreating.map((d) => d.id),
      ['c1', 'c2', 'c3'],
    );
    assert.deepEqual(
      segmented.processing.map((d) => d.id),
      ['p1', 'p2'],
    );
    assert.deepEqual(
      segmented.needsAttention.map((d) => d.id),
      ['a1', 'a2'],
    );
    assert.equal(segmented.isEmpty, false);
  });

  it('hides drafts older than 30 days from Studio Home', () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    const fresh = item({
      id: 'fresh',
      status: 'draft',
      updatedAt: '2026-08-01T12:00:00.000Z',
    });
    const stale = item({
      id: 'stale',
      status: 'failed',
      updatedAt: '2026-07-01T12:00:00.000Z',
    });
    assert.equal(isCreateDraftFreshForStudio(fresh.updatedAt, now), true);
    assert.equal(isCreateDraftFreshForStudio(stale.updatedAt, now), false);
    const segmented = segmentCreateDrafts([fresh, stale], { nowMs: now });
    assert.deepEqual(
      segmented.continueCreating.map((d) => d.id),
      ['fresh'],
    );
    assert.equal(segmented.needsAttention.length, 0);
  });

  it('reports empty when nothing remains after filters', () => {
    const segmented = segmentCreateDrafts([]);
    assert.equal(segmented.isEmpty, true);
    assert.equal(createDraftSegmentActionLabel('continue'), 'Resume');
    assert.equal(createDraftSegmentActionLabel('processing'), 'Open');
    assert.equal(createDraftSegmentActionLabel('attention'), 'Fix');
  });
});
