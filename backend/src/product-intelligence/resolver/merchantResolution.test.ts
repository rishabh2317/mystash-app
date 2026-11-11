import assert from 'node:assert/strict';
import { it } from 'node:test';
import baseline from './testing/merchantImageBaseline.json';
import { merchantImageFixtures } from './merchantResolutionFixtures';

it('absolute gate: hero images, gallery ordering/fallbacks and image-enrichment calls match the pre-change implementation', async () => {
  // Golden outputs were executed against the source snapshot taken BEFORE this implementation.
  // These are synthetic deterministic provider responses, not live-provider observations.
  const { outputs, outcomes } = await merchantImageFixtures();
  assert.deepEqual(outputs, baseline, 'image differences block this change; do not regenerate goldens from the new resolver');
  for (const key of Object.keys(outcomes)) {
    assert.ok(outcomes[key].destinations.length > 0, `${key}: independently qualified shopping destination survives`);
    const evidence = outcomes[key].evidence as { state: string }[];
    assert.equal(evidence[0]?.state, key.endsWith(':page') ? 'PAGE_VERIFIED' : 'DISCOVERY_VERIFIED', key);
  }
});
