import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = process.cwd();

describe('useDiscoverCreators', () => {
  it('keys load identity by excluded user, not by profile tabs', () => {
    const hook = readFileSync(join(ROOT, 'src/hooks/useDiscoverCreators.ts'), 'utf8');
    assert.match(hook, /export function discoverCreatorsIdentityKey/);
    assert.match(hook, /loadedKeyRef\.current === identity/);
    assert.match(hook, /void load\(false\)/);
    assert.doesNotMatch(hook, /collections|saved|activeTab/);
  });
});
