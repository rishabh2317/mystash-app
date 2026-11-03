import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import ts from 'typescript';

import { getThemeTokens } from '../theme/tokens';
import { typeStyle } from '../theme/typography';

// A reset in either publish handler dismisses the success modal via the shared
// Create session listener. Keep the reset at the user's success exit instead.
for (const [path, handler] of [
  ['app/(tabs)/create/index.tsx', 'onPublish'],
  ['app/(tabs)/create/review.tsx', 'confirmPublish'],
]) {
  it(`${handler} preserves the backend-confirmed success screen until its exit action`, () => {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found = false;
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === handler) {
        found = true;
        const body = node.initializer?.getText(source) ?? '';
        assert.match(body, /await publishIngestSelection/);
        assert.match(body, /if \(!res\.ok\)/);
        assert.match(body, /setPublishPhase\('success'\)/);
        assert.doesNotMatch(body, /completeCreateFlow\(/);
        assert.match(body, /publishLock\.current/);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(found, 'publish handler must be checked');
    const success = source.text.slice(source.text.lastIndexOf('<PublishSuccessScreen'));
    assert.match(success, /onViewFeed=.*completeCreateFlow\(\)/);
    assert.match(success, /onViewCollection=\{\(\) => \{\s*completeCreateFlow\(\)/);
    assert.match(success, /onCreateAnother=\{\(\) => \{\s*completeCreateFlow\(\)/);
  });
}

it('the compact caption role uses the same Inter face and semantic scale in both themes', () => {
  for (const theme of ['titanium', 'nebula'] as const) {
    const tokens = getThemeTokens(theme);
    const caption = typeStyle(tokens, 'caption');
    assert.equal(caption.fontFamily, tokens.fontFamily.regular);
    assert.equal(caption.fontSize, tokens.fontSize.caption);
    assert.equal(caption.lineHeight, tokens.lineHeight.caption);
    assert.equal(caption.color, tokens.color.textMuted);
    assert.equal(caption.fontWeight, undefined);
  }
});

it('Create notices and confirmation keep the shared font and opaque modal surface', () => {
  const notice = readFileSync('components/create/CreateInlineNotice.tsx', 'utf8');
  assert.match(notice, /import \{ Text \} from '@\/components\/ui\/Text'/);
  assert.doesNotMatch(notice, /#[0-9a-f]{3,8}|rgba\(/i);
  const sheet = readFileSync('components/create/PublishConfirmSheet.tsx', 'utf8');
  assert.match(sheet, /backgroundColor: tokens\.color\.canvas/);
});

it('creator-facing Analytics omits internal diagnostics while keeping honest missing-data and privacy copy', () => {
  const source = readFileSync('components/analytics/CreatorAnalyticsScreen.tsx', 'utf8');
  assert.doesNotMatch(source, /continuous worker coverage|Coverage samples worker|Awaiting the first aggregation|Partial measurement coverage|error\.message/);
  assert.match(source, /people who opted in/);
  assert.match(source, /dash means data is unavailable/);
  assert.match(source, /report\.stale/);
  assert.match(source, /report\.provisional/);
  assert.match(source, /not confirmed purchases/);
});
it('Create stage and action cards use the shared compact hierarchy without expanding font sizes', () => {
  const stage = readFileSync('components/create/CreateStudioStage.tsx', 'utf8');
  const choices = readFileSync('components/ui/ActionChoiceRow.tsx', 'utf8');
  assert.match(stage, /typeStyle\(tokens, 'sectionTitle'\)/);
  assert.match(stage, /typeStyle\(tokens, 'caption'\)/);
  assert.doesNotMatch(stage, /fontSize:|lineHeight:/);
  assert.doesNotMatch(choices, /fontSize: tokens\.fontSize\.body|minHeight: studio \? 92/);
  assert.match(choices, /paddingVertical: tokens\.space\.sm/);
  // Inputs and primary CTAs retain the app-wide readable control sizes.
  const create = readFileSync('app/(tabs)/create/index.tsx', 'utf8');
  assert.match(create, /fontSize: tokens\.fontSize\.body/);
});
it('Profile refreshes both grids on focus and fences late requests across blur/account changes', () => {
  const profile = readFileSync('app/(tabs)/profile.tsx', 'utf8');
  assert.match(profile, /useFocusEffect\(useCallback/);
  assert.match(profile, /profileOwner\.current !== \(user\?\.id \?\? null\)/);
  assert.match(profile, /if \(!me \|\| gen !== loadGen\.current\) return/);
  assert.match(profile, /void loadCollections\(me\.userId\)/);
  assert.match(profile, /void loadSaved\(\)/);
  assert.match(profile, /return \(\) => \{ \+\+loadGen\.current; \}/);
  const tile = readFileSync('components/collection/CollectionTile.tsx', 'utf8');
  assert.match(tile, /onError=\{\(\) => setFailedThumbnail\(thumbnailKey\)\}/);
  assert.match(tile, /recyclingKey=\{thumbnailKey\}/);
  assert.match(tile, /Preview unavailable/);
});
