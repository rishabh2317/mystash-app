import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CREATE_COPY } from './createCopy';
import {
  CREATE_MODES,
  CREATE_MODE_DESCRIPTIONS,
  CREATE_MODE_LABELS,
  DEFAULT_CREATE_MODE,
  createModeStudioCopy,
  createProductsOnlyManualHref,
  createStudioHref,
  isCreateMode,
  parseCreateMode,
} from './createMode';

describe('Phase 1 CreateMode contract', () => {
  it('defines three modes with default my_content', () => {
    assert.deepEqual([...CREATE_MODES], ['my_content', 'curate_public', 'products_only']);
    assert.equal(DEFAULT_CREATE_MODE, 'my_content');
  });

  it('exposes labels and descriptions for each mode', () => {
    for (const mode of CREATE_MODES) {
      assert.equal(typeof CREATE_MODE_LABELS[mode], 'string');
      assert.ok(CREATE_MODE_LABELS[mode].length > 0);
      assert.equal(typeof CREATE_MODE_DESCRIPTIONS[mode], 'string');
      assert.ok(CREATE_MODE_DESCRIPTIONS[mode].length > 0);
    }
    assert.equal(CREATE_MODE_LABELS.my_content, 'My content');
    assert.equal(CREATE_MODE_LABELS.curate_public, 'Curate public');
    assert.equal(CREATE_MODE_LABELS.products_only, 'Products');
  });

  it('isCreateMode / parseCreateMode handle valid, invalid, and array query shapes', () => {
    assert.equal(isCreateMode('my_content'), true);
    assert.equal(isCreateMode('curate_public'), true);
    assert.equal(isCreateMode('products_only'), true);
    assert.equal(isCreateMode('manual'), false);
    assert.equal(isCreateMode(null), false);
    assert.equal(isCreateMode(undefined), false);

    assert.equal(parseCreateMode('curate_public'), 'curate_public');
    assert.equal(parseCreateMode(['products_only']), 'products_only');
    assert.equal(parseCreateMode('nope'), DEFAULT_CREATE_MODE);
    assert.equal(parseCreateMode(undefined), DEFAULT_CREATE_MODE);
    assert.equal(parseCreateMode('nope', 'curate_public'), 'curate_public');
  });

  it('returns mode-aware studio copy without rewriting review/publish strings', () => {
    const mine = createModeStudioCopy('my_content');
    assert.equal(mine.headline, CREATE_COPY.modeMyContentHeadline);
    assert.equal(mine.contentUrlLabel, CREATE_COPY.modeMyContentUrlLabel);
    assert.match(mine.subhead, /you created/i);

    const curate = createModeStudioCopy('curate_public');
    assert.equal(curate.headline, CREATE_COPY.modeCurateHeadline);
    assert.equal(curate.contentUrlLabel, CREATE_COPY.modeCurateUrlLabel);
    assert.match(curate.subhead, /public/i);

    const products = createModeStudioCopy('products_only');
    assert.equal(products.headline, CREATE_COPY.modeProductsHeadline);
    assert.equal(products.subhead, CREATE_COPY.modeProductsSubhead);

    assert.equal(CREATE_COPY.publishConfirmPrimary, 'Publish Collection');
    assert.equal(CREATE_COPY.editorPublish, 'Publish Collection');
  });

  it('maps products_only to the manual route with mode query', () => {
    assert.equal(createProductsOnlyManualHref(), '/(tabs)/create/manual?mode=products_only');
    assert.equal(createStudioHref('my_content'), '/(tabs)/create');
    assert.equal(createStudioHref('curate_public'), '/(tabs)/create?mode=curate_public');
  });
});
