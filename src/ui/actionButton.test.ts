import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = process.cwd();

function readActionButton(): string {
  return readFileSync(join(ROOT, 'components/ui/ActionButton.tsx'), 'utf8');
}

describe('ActionButton outlinePrimary', () => {
  it('adds outlinePrimary without changing existing variant chrome', () => {
    const src = readActionButton();
    assert.match(
      src,
      /export type ActionButtonVariant = 'primary' \| 'secondary' \| 'quiet' \| 'filled' \| 'outlinePrimary'/,
    );

    assert.match(src, /const isOutlinePrimary = variant === 'outlinePrimary'/);
    assert.match(src, /const isPrimary = variant === 'primary'/);
    assert.match(src, /const isFilled = variant === 'filled'/);
    assert.match(src, /const isQuiet = variant === 'quiet'/);

    assert.match(src, /isFilled\s*\n\s*\? tokens\.color\.onPrimary/);
    assert.match(src, /isPrimary\s*\n\s*\? tokens\.color\.onPrimarySurface/);
    assert.match(src, /isQuiet\s*\n\s*\? tokens\.color\.primary/);
    assert.match(src, /: tokens\.color\.text/);

    assert.match(
      src,
      /paddingVertical: isQuiet \? tokens\.space\.xs : isCompact \? tokens\.space\.xxs \+ 2 : tokens\.space\.sm/,
    );
    assert.match(src, /paddingHorizontal: isCompact \? tokens\.space\.sm : tokens\.space\.md/);
    assert.match(src, /width: isCompact \|\| isFilled \|\| isOutlinePrimary \? '100%' : undefined/);
    assert.match(src, /radius === 'md'/);
    assert.match(src, /isCompact\s*\n\s*\? tokens\.radius\.pill\s*\n\s*: tokens\.radius\.md/);
    assert.match(src, /opacity: controlOpacity\(phase, tokens\.motion\.pressOpacity\)/);
    assert.match(src, /\.\.\.\(isFilled \? titaniumRaisedShadow\(tokens\) : null\)/);

    assert.match(src, /isFilled\s*\n\s*\? tokens\.color\.primary/);
    assert.match(src, /isPrimary\s*\n\s*\? tokens\.color\.primarySurface/);
    assert.match(src, /isQuiet\s*\n\s*\? 'transparent'/);
    assert.match(src, /: tokens\.color\.surfaceSubtle/);
    assert.match(src, /isQuiet \|\| isFilled \? 0 : StyleSheet\.hairlineWidth/);
    assert.match(src, /isPrimary\s*\n\s*\? tokens\.color\.primarySurface\s*\n\s*: tokens\.color\.border/);
  });

  it('styles outlinePrimary as a 1px primary outline on a transparent fill', () => {
    const src = readActionButton();
    assert.match(src, /isOutlinePrimary\s*\n\s*\? tokens\.color\.primary/);
    assert.match(src, /backgroundColor: isOutlinePrimary\s*\n\s*\? 'transparent'/);
    assert.match(src, /borderWidth: isOutlinePrimary \? 1/);
    assert.match(src, /borderColor: isOutlinePrimary\s*\n\s*\? tokens\.color\.primary/);
  });

  it('keeps compact as a density option without changing default chrome', () => {
    const src = readActionButton();
    assert.match(src, /export type ActionButtonSize = 'default' \| 'compact'/);
    assert.match(src, /size = 'default'/);
    assert.match(src, /const COMPACT_HEIGHT = 32/);
    assert.match(src, /fontSize: isCompact \? tokens\.fontSize\.caption : tokens\.fontSize\.bodyStrong/);
  });
});
