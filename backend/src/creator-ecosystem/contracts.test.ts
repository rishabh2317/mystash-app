import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACTIVE_PRODUCT_PROVENANCE_SOURCES,
  CAMPAIGN_PRODUCT_PROVENANCE_SOURCES,
  COMMERCIAL_SOURCES,
  PRODUCT_PROVENANCE_SOURCES,
  RESERVED_PRODUCT_PROVENANCE_SOURCES,
  assertWritableProductProvenance,
  isActiveProductProvenanceSource,
  isCampaignProductProvenance,
  isProductProvenanceSource,
  isReservedProductProvenanceSource,
} from './contracts';

describe('creator-ecosystem Phase 0 contracts', () => {
  it('includes required provenance vocabulary without dropping live selection_source values', () => {
    for (const live of [
      'AI_DETECTED',
      'AI_RECOMMENDED',
      'CREATOR_MANUAL',
      'CREATOR_ACCEPTED_AI',
      'IMPORT',
      'SYSTEM',
    ] as const) {
      assert.equal(isActiveProductProvenanceSource(live), true);
      assert.equal(isProductProvenanceSource(live), true);
    }

    for (const campaign of ['CAMPAIGN', 'BRAND_FEED'] as const) {
      assert.equal(isCampaignProductProvenance(campaign), true);
      assert.equal(isReservedProductProvenanceSource(campaign), false);
      assert.equal(isProductProvenanceSource(campaign), true);
    }
    assert.equal(isReservedProductProvenanceSource('AFFILIATE_URL'), true);
    assert.equal(isActiveProductProvenanceSource('AFFILIATE_URL'), false);

    assert.equal(ACTIVE_PRODUCT_PROVENANCE_SOURCES.length, 6);
    assert.equal(CAMPAIGN_PRODUCT_PROVENANCE_SOURCES.length, 2);
    assert.equal(RESERVED_PRODUCT_PROVENANCE_SOURCES.length, 1);
    assert.equal(PRODUCT_PROVENANCE_SOURCES.length, 9);
  });

  it('defines CommercialSource overlay without implying a brand product table', () => {
    assert.deepEqual([...COMMERCIAL_SOURCES], ['NONE', 'AFFILIATE', 'CAMPAIGN', 'BRAND_FEED']);
  });

  it('allows campaign provenance and still blocks affiliate writers', () => {
    assert.doesNotThrow(() => assertWritableProductProvenance('CREATOR_MANUAL'));
    assert.doesNotThrow(() => assertWritableProductProvenance('CAMPAIGN'));
    assert.doesNotThrow(() => assertWritableProductProvenance('BRAND_FEED'));
    assert.throws(
      () => assertWritableProductProvenance('AFFILIATE_URL'),
      /affiliate writers are not enabled/,
    );
  });
});
