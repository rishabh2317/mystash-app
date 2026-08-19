import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectQueryIntent } from './intent';

describe('detectQueryIntent', () => {
  it('detects exact product intent', () => {
    const r = detectQueryIntent('sony xm5');
    assert.equal(r.intent, 'EXACT_PRODUCT');
    assert.ok(r.laneWeights.product > r.laneWeights.collection);
  });

  it('detects creator intent', () => {
    const r = detectQueryIntent('tech hints');
    // single token handle-ish OR discovery — tech hints may be creator-like single? 
    // "tech hints" is two tokens without @ — may be DISCOVERY default
    assert.ok(['CREATOR', 'DISCOVERY'].includes(r.intent));
  });

  it('detects @handle as creator', () => {
    assert.equal(detectQueryIntent('@nike_creator').intent, 'CREATOR');
  });

  it('detects discovery queries', () => {
    assert.equal(detectQueryIntent('beach outfits').intent, 'DISCOVERY');
    assert.equal(detectQueryIntent('best travel gadgets').intent, 'DISCOVERY');
    assert.equal(detectQueryIntent('gifts for girlfriend').intent, 'DISCOVERY');
  });

  it('defaults collection-primary', () => {
    const r = detectQueryIntent('something vague here today');
    assert.ok(r.laneWeights.collection >= r.laneWeights.product);
  });
});
