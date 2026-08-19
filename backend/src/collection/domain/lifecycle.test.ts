import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canTransition } from './lifecycle';

describe('collection lifecycle', () => {
  it('allows draft → processing → ready_for_review → published', () => {
    assert.equal(canTransition('draft', 'processing'), true);
    assert.equal(canTransition('processing', 'ready_for_review'), true);
    assert.equal(canTransition('ready_for_review', 'published'), true);
  });

  it('allows published content edits as published → published', () => {
    assert.equal(canTransition('published', 'published'), true);
  });

  it('rejects deleted → published', () => {
    assert.equal(canTransition('deleted', 'published'), false);
  });

  it('allows archived → unpublished restore', () => {
    assert.equal(canTransition('archived', 'unpublished'), true);
  });
});
