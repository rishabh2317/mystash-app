import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectionPath, creatorPath } from './sharePaths';

describe('sharePaths', () => {
  it('builds canonical collection and creator paths', () => {
    assert.equal(
      collectionPath('550e8400-e29b-41d4-a716-446655440000'),
      '/collection/550e8400-e29b-41d4-a716-446655440000',
    );
    assert.equal(creatorPath('@alice'), '/creator/alice');
    assert.equal(creatorPath('bob'), '/creator/bob');
  });
});
