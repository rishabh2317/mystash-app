import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IngestDraftPayload } from '../types/curation';
import {
  activeIngestProgressLabel,
  mapManualProductLinkStages,
  mapStudioSubmitStages,
  mapVideoExtractionStages,
  resolveVideoExtractionProgressStageIndex,
  usesNumericIngestProgress,
} from './ingestProgressStages';

function draft(partial: Partial<IngestDraftPayload>): IngestDraftPayload {
  return {
    ingestId: 'ing-1',
    sourceUrl: 'https://youtube.com/shorts/abc',
    platform: 'youtube',
    products: [],
    status: 'processing',
    ...partial,
  };
}

describe('ingestProgressStages', () => {
  it('maps video extraction to content → finding → verifying → preparing', () => {
    const early = mapVideoExtractionStages(
      draft({ sourceUrl: '', pipelineMeta: undefined, products: [] }),
    );
    assert.equal(early[0]?.state, 'active');
    assert.equal(early[0]?.label, 'Content');
    assert.equal(early[1]?.state, 'pending');

    const finding = mapVideoExtractionStages(
      draft({
        pipelineMeta: { stagesCompleted: ['s1_context', 'reason_s1'] },
        products: [],
      }),
    );
    assert.equal(finding[1]?.state, 'active');
    assert.equal(finding[1]?.label, 'Finding products');
    assert.equal(finding[0]?.state, 'complete');

    const verifying = mapVideoExtractionStages(
      draft({
        products: [
          {
            id: 'p1',
            name: 'Shoe',
            price: '—',
            provider: 'x',
            affiliateUrl: '',
            resolutionStatus: 'UNRESOLVED',
          },
        ],
      }),
    );
    assert.equal(verifying[2]?.state, 'active');
    assert.equal(verifying[2]?.label, 'Verifying products');

    const preparing = mapVideoExtractionStages(
      draft({
        products: [
          {
            id: 'p1',
            name: 'Shoe',
            price: '—',
            provider: 'x',
            affiliateUrl: '',
            catalogProductId: 'cat-1',
            resolutionStatus: 'VERIFIED',
          },
        ],
        extractionPending: true,
      }),
    );
    assert.equal(preparing[3]?.state, 'active');
    assert.equal(preparing[3]?.label, 'Preparing your collection');
  });

  it('uses manual product-link stages without video extraction labels', () => {
    const stages = mapManualProductLinkStages(0);
    assert.deepEqual(
      stages.map((s) => s.label),
      ['Adding products', 'Checking product details', 'Preparing products'],
    );
    assert.equal(stages[0]?.state, 'active');
    assert.equal(activeIngestProgressLabel(stages), 'Adding products');
  });

  it('uses studio submit stages for URL handoff', () => {
    const start = mapStudioSubmitStages(0);
    assert.equal(start[0]?.state, 'active');
    assert.equal(start[0]?.label, 'Starting your Collection');

    const opening = mapStudioSubmitStages(1);
    assert.equal(opening[0]?.state, 'complete');
    assert.equal(opening[1]?.state, 'active');
    assert.equal(opening[1]?.label, 'Opening Collection editor');
  });

  it('never exposes numeric percentage progress', () => {
    assert.equal(usesNumericIngestProgress(mapVideoExtractionStages(draft({}))), false);
  });

  it('resolveVideoExtractionProgressStageIndex advances with backend stage markers', () => {
    assert.equal(resolveVideoExtractionProgressStageIndex(draft({ sourceUrl: '', products: [] })), 0);
    assert.equal(
      resolveVideoExtractionProgressStageIndex(
        draft({ pipelineMeta: { stagesCompleted: ['s1_context'] }, products: [] }),
      ),
      1,
    );
  });
});
