import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = process.cwd();

describe('ActionChoiceRow', () => {
  it('is an outlined action surface using shared chrome, not a filled card', () => {
    const src = readFileSync(join(ROOT, 'components/ui/ActionChoiceRow.tsx'), 'utf8');
    assert.match(src, /outlineCardChrome\(tokens\)/);
    assert.match(src, /borderWidth: StyleSheet\.hairlineWidth/);
    assert.match(src, /borderRadius: tokens\.radius\.md/);
    assert.match(src, /chevron-forward-outline/);
    assert.match(src, /typeStyle\(tokens, 'tileTitle'\)/);
    assert.match(src, /controlOpacity/);
    assert.doesNotMatch(src, /shadow/);
    assert.doesNotMatch(src, /elevation/);
  });
});
