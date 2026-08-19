import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertTagStatusTransition, canTransitionTagStatus } from './tagLifecycle';
import {
  isPrimaryTag,
  isPublishSurfaceTag,
  mapLegacyTagSource,
  type CollectionProductTag,
} from './types';

describe('tagLifecycle', () => {
  it('allows proposed → accepted → published', () => {
    assert.equal(canTransitionTagStatus('proposed', 'accepted'), true);
    assert.equal(canTransitionTagStatus('accepted', 'published'), true);
    assert.throws(() => assertTagStatusTransition('deleted', 'accepted'));
  });
});

describe('tag helpers', () => {
  it('maps legacy tagSource and publish surface', () => {
    assert.equal(mapLegacyTagSource('manual'), 'CREATOR_MANUAL');
    assert.equal(mapLegacyTagSource('ai'), 'AI_DETECTED');
    const tag = {
      recommendationStrength: 'PRIMARY',
      isPrimary: true,
      visibility: 'visible',
      includeInPublish: true,
      tagStatus: 'accepted',
      deletedAt: null,
    } as Pick<
      CollectionProductTag,
      | 'recommendationStrength'
      | 'isPrimary'
      | 'visibility'
      | 'includeInPublish'
      | 'tagStatus'
      | 'deletedAt'
    >;
    assert.equal(isPrimaryTag(tag), true);
    assert.equal(isPublishSurfaceTag(tag), true);
    assert.equal(
      isPublishSurfaceTag({ ...tag, includeInPublish: false }),
      false,
    );
  });
});
