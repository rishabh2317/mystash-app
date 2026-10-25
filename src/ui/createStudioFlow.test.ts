import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CREATE_COPY } from './createCopy';
import {
  STUDIO_STEP_COPY,
  STUDIO_STEPS,
  normalizeProductHttpUrl,
  studioActiveStepFromScroll,
  studioConnectorComplete,
  studioProductSourceLabel,
  studioProductsSummaryLabel,
  studioRelativeTime,
  studioStageExpanded,
  studioDefaultIncludeExtracted,
  studioExtractedProducts,
  studioIncludedExtractedProducts,
  studioShowsNoProductsFound,
  studioStepComplete,
  studioStepUnlocked,
  studioStepVisual,
  studioSuggestedFocus,
} from './createStudioFlow';

describe('Creator Studio single-page journey', () => {
  it('orders Video → Products → Publish', () => {
    assert.deepEqual([...STUDIO_STEPS], ['video', 'products', 'publish']);
    assert.equal(STUDIO_STEP_COPY.video.index, '01');
    assert.equal(STUDIO_STEP_COPY.products.index, '02');
    assert.equal(STUDIO_STEP_COPY.publish.index, '03');
    assert.equal(STUDIO_STEP_COPY.video.label, CREATE_COPY.stepVideo);
  });

  it('unlocks products only after a video, publish only after products', () => {
    const empty = { hasVideo: false, hasProducts: false };
    assert.equal(studioStepUnlocked('video', empty), true);
    assert.equal(studioStepUnlocked('products', empty), false);
    assert.equal(studioStepUnlocked('publish', empty), false);

    const videoOnly = { hasVideo: true, hasProducts: false };
    assert.equal(studioStepUnlocked('products', videoOnly), true);
    assert.equal(studioStepUnlocked('publish', videoOnly), false);
    assert.equal(studioStepComplete('video', videoOnly), true);
    assert.equal(studioStepComplete('products', videoOnly), false);

    const ready = { hasVideo: true, hasProducts: true };
    assert.equal(studioStepUnlocked('publish', ready), true);
    assert.equal(studioConnectorComplete('video', ready), true);
    assert.equal(studioConnectorComplete('products', ready), true);
  });

  it('marks current teal, completed with check, upcoming muted', () => {
    const ctx = { hasVideo: true, hasProducts: false };
    assert.equal(studioStepVisual('video', 'products', ctx), 'completed');
    assert.equal(studioStepVisual('products', 'products', ctx), 'current');
    assert.equal(studioStepVisual('publish', 'products', ctx), 'upcoming');
    assert.equal(studioStepVisual('video', 'video', ctx), 'current');
  });

  it('updates the active step from scroll position', () => {
    const ys = { video: 0, products: 400, publish: 800 };
    assert.equal(studioActiveStepFromScroll(0, ys), 'video');
    assert.equal(studioActiveStepFromScroll(400, ys), 'products');
    assert.equal(studioActiveStepFromScroll(801, ys), 'publish');
    assert.equal(studioActiveStepFromScroll(10, {}), 'video');
  });

  it('normalizes product URLs and labels sources without new APIs', () => {
    assert.equal(normalizeProductHttpUrl(' https://shop.example/p#frag '), 'https://shop.example/p');
    assert.equal(normalizeProductHttpUrl('ftp://x'), null);
    assert.equal(normalizeProductHttpUrl('not a url'), null);
    assert.equal(studioProductSourceLabel('ai'), CREATE_COPY.productSourceAi);
    assert.equal(studioProductSourceLabel('link'), CREATE_COPY.productSourceLink);
    assert.equal(CREATE_COPY.chooseYourVideo, 'Choose your video');
    assert.equal(CREATE_COPY.studioDraftsTitle, 'My Drafts');
    assert.equal(CREATE_COPY.libraryStepTitle, 'Synced videos');
    assert.equal(CREATE_COPY.continueToPublish, 'Continue to Publish');
    assert.equal(CREATE_COPY.editorPublish, 'Publish Collection');
    assert.equal(CREATE_COPY.discardCollection, 'Discard');
    assert.match(CREATE_COPY.productSourceInventoryTitle, /Mystash inventory/i);
  });

  it('auto-advances focus and collapses non-active stages', () => {
    assert.equal(studioSuggestedFocus({ hasVideo: false, hasProducts: false }), 'video');
    assert.equal(studioSuggestedFocus({ hasVideo: true, hasProducts: false }), 'products');
    assert.equal(studioSuggestedFocus({ hasVideo: true, hasProducts: true }), 'publish');
    assert.equal(studioStageExpanded('video', 'video'), true);
    assert.equal(studioStageExpanded('products', 'video'), false);
    assert.equal(studioStageExpanded('publish', 'products'), false);
    assert.equal(studioProductsSummaryLabel(0), CREATE_COPY.productsNotStarted);
    assert.equal(studioProductsSummaryLabel(3), '3 products');
  });

  it('formats draft updatedAt without new fields', () => {
    const now = Date.parse('2026-10-05T12:00:00.000Z');
    assert.equal(studioRelativeTime('2026-10-05T11:59:30.000Z', now), 'Just now');
    assert.equal(studioRelativeTime('2026-10-05T11:10:00.000Z', now), '50m ago');
    assert.equal(studioRelativeTime('not-a-date'), '');
  });

  it('renders extracted products for ready_for_review even when extractionStatus is not ok', () => {
    const one = [{ id: 'p1', name: 'Sneaker' }];
    assert.equal(studioExtractedProducts(one).length, 1);
    assert.equal(studioDefaultIncludeExtracted({ products: one }), true);
    assert.equal(
      studioShowsNoProductsFound({
        hasDraft: true,
        processing: false,
        extracting: false,
        extractedCount: 1,
      }),
      false,
    );
    const selected = { p1: true };
    assert.equal(studioIncludedExtractedProducts(studioExtractedProducts(one), selected).length, 1);
  });

  it('renders every extracted product for a multi-product ingest', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const extracted = studioExtractedProducts(rows);
    assert.equal(extracted.length, 3);
    const selected = { a: true, b: true, c: true };
    assert.equal(studioIncludedExtractedProducts(extracted, selected).length, 3);
  });

  it('shows empty state only when extraction finished with zero draft rows', () => {
    assert.equal(
      studioShowsNoProductsFound({
        hasDraft: true,
        processing: false,
        extracting: false,
        extractedCount: 0,
      }),
      true,
    );
    assert.equal(
      studioShowsNoProductsFound({
        hasDraft: true,
        processing: true,
        extracting: false,
        extractedCount: 0,
      }),
      false,
    );
  });

  it('hydrates duplicate-ingest product rows onto the current draft', () => {
    const duplicateBody = {
      ingestId: 'existing',
      status: 'ready_for_review' as const,
      extractionStatus: 'degraded' as const,
      extractionSource: 'queued',
      products: [{ id: 'ext-1', name: 'Hat' }],
    };
    assert.equal(studioDefaultIncludeExtracted(duplicateBody), true);
    assert.equal(studioExtractedProducts(duplicateBody.products)[0]?.id, 'ext-1');
    assert.equal(
      studioShowsNoProductsFound({
        hasDraft: true,
        processing: false,
        extracting: false,
        extractedCount: studioExtractedProducts(duplicateBody.products).length,
      }),
      false,
    );
  });

  it('preserves extracted products when Step 02 is collapsed and reopened', () => {
    const products = studioExtractedProducts([{ id: 'keep' }, { id: 'drop' }]);
    let selected = { keep: true, drop: true };
    assert.equal(studioStageExpanded('products', 'publish'), false);
    assert.equal(studioIncludedExtractedProducts(products, selected).length, 2);
    selected = { ...selected, drop: false };
    const visible = studioIncludedExtractedProducts(products, selected);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.id, 'keep');
    assert.equal(studioExtractedProducts(products).length, 2);
  });
});
