import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectQueryIntent } from './intent';

describe('detectQueryIntent', () => {
  it('detects exact product intent', () => {
    const r = detectQueryIntent('sony xm5');
    assert.equal(r.intent, 'EXACT_PRODUCT');
    assert.ok(r.laneWeights.product > r.laneWeights.collection);
  });

  it('detects creator intent for @handle and separator-shaped usernames', () => {
    assert.equal(detectQueryIntent('@nike_creator').intent, 'CREATOR');
    assert.equal(detectQueryIntent('nike_creator').intent, 'CREATOR');
    assert.equal(detectQueryIntent('tech.hints').intent, 'CREATOR');
  });

  it('does not classify ordinary product or discovery terms as creator', () => {
    const notCreator = ['smartphone', 'best', 'smart', 'sma', 'headphones', 's', 'sm'];
    for (const q of notCreator) {
      assert.notEqual(detectQueryIntent(q).intent, 'CREATOR', `expected non-CREATOR for "${q}"`);
    }
  });

  it('classifies common discovery and category queries without creator intent', () => {
    assert.equal(detectQueryIntent('smartphone').intent, 'DISCOVERY');
    assert.equal(detectQueryIntent('best').intent, 'DISCOVERY');
    assert.equal(detectQueryIntent('headphones').intent, 'DISCOVERY');
    assert.ok(
      ['CATEGORY_CONCEPT', 'EXACT_PRODUCT', 'DISCOVERY'].includes(
        detectQueryIntent('Nike running shoes').intent,
      ),
    );
    assert.equal(detectQueryIntent('MacBook Air M4').intent, 'EXACT_PRODUCT');
  });

  it('detects comparison intent', () => {
    assert.equal(detectQueryIntent('compare iPhone vs Samsung').intent, 'COMPARISON');
  });

  it('detects discovery queries', () => {
    assert.equal(detectQueryIntent('beach outfits').intent, 'DISCOVERY');
    assert.equal(detectQueryIntent('best travel gadgets').intent, 'DISCOVERY');
    assert.equal(detectQueryIntent('gifts for girlfriend').intent, 'DISCOVERY');
    assert.equal(detectQueryIntent('tech hints').intent, 'DISCOVERY');
  });

  it('defaults collection-primary', () => {
    const r = detectQueryIntent('something vague here today');
    assert.ok(r.laneWeights.collection >= r.laneWeights.product);
  });
});
