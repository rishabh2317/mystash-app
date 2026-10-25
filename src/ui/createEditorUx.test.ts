import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = process.cwd();

describe('Edit Collection surgical UX', () => {
  it('places Publish in the existing TopBar trailing slot and Discard in the scroll', () => {
    const layout = readFileSync(join(ROOT, 'app/(tabs)/create/_layout.tsx'), 'utf8');
    const review = readFileSync(join(ROOT, 'app/(tabs)/create/review.tsx'), 'utf8');
    assert.match(layout, /trailing=/);
    assert.match(layout, /options\.headerRight/);
    assert.match(review, /headerRight/);
    assert.match(review, /CREATE_COPY\.editorPublish/);
    assert.match(review, /CREATE_COPY\.editorDiscard/);
    assert.doesNotMatch(review, /position:\s*'absolute'/);
  });

  it('reuses paste ingest append and synced-library product URLs', () => {
    const review = readFileSync(join(ROOT, 'app/(tabs)/create/review.tsx'), 'utf8');
    assert.match(review, /CREATE_COPY\.editorPasteProductLink/);
    assert.match(review, /CREATE_COPY\.editorAddFromLibrary/);
    assert.match(review, /CreateStudioLibraryPicker/);
    assert.match(review, /listLibraryItemProducts/);
    assert.match(review, /appendManualProductsToIngest/);
    assert.doesNotMatch(review, /addLibraryItemToCollection/);
  });

  it('keeps publish confirmation and success on existing sheets', () => {
    const confirm = readFileSync(join(ROOT, 'components/create/PublishConfirmSheet.tsx'), 'utf8');
    const success = readFileSync(join(ROOT, 'components/create/PublishSuccessScreen.tsx'), 'utf8');
    const review = readFileSync(join(ROOT, 'app/(tabs)/create/review.tsx'), 'utf8');
    assert.match(confirm, /CREATE_COPY\.publishConfirmReady/);
    assert.match(confirm, /ActionButton/);
    assert.match(confirm, /publishConfirmPrimary/);
    assert.match(confirm, /publishConfirmSecondary/);
    assert.match(success, /layout === 'editor'/);
    assert.match(review, /layout="editor"/);
    assert.match(review, /coverUrl=\{publishedCoverUrl\}/);
    const copy = readFileSync(join(ROOT, 'src/ui/createCopy.ts'), 'utf8');
    assert.match(copy, /editorPasteProductLink: 'Paste product link'/);
    assert.match(copy, /editorAddFromLibrary: 'Add from synced library'/);
    assert.match(copy, /publishConfirmReady: 'Ready to publish'/);
  });
});
