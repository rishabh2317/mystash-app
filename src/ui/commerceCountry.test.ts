import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  resolveCommerceCountry,
  shouldRefreshLocation,
  LOCATION_CHECK_COOLDOWN_MS,
} from '@/src/services/commerceCountry/resolve';

const ROOT = process.cwd();

describe('commerce country resolution', () => {
  it('prefers saved profile country over device locale', () => {
    const snap = resolveCommerceCountry({
      profileCountry: 'IN',
      countrySource: 'location',
      deviceLocale: 'en-US',
    });
    assert.equal(snap.country, 'IN');
    assert.equal(snap.source, 'location');
  });

  it('falls back to locale then default when profile is empty', () => {
    assert.equal(
      resolveCommerceCountry({ profileCountry: null, deviceLocale: 'en-US' }).country,
      'US',
    );
    assert.equal(
      resolveCommerceCountry({ profileCountry: null, deviceLocale: null }).country,
      'IN',
    );
  });

  it('does not override a valid saved country with device locale', () => {
    const snap = resolveCommerceCountry({
      profileCountry: 'GB',
      countrySource: 'manual',
      deviceLocale: 'en-IN',
    });
    assert.equal(snap.country, 'GB');
    assert.equal(snap.source, 'manual');
  });

  it('location cooldown skips refresh within 24h', () => {
    const now = Date.parse('2026-09-22T12:00:00.000Z');
    assert.equal(
      shouldRefreshLocation({
        lastLocationCheckAt: '2026-09-22T10:00:00.000Z',
        nowMs: now,
        cooldownMs: LOCATION_CHECK_COOLDOWN_MS,
      }),
      false,
    );
    assert.equal(
      shouldRefreshLocation({
        lastLocationCheckAt: '2026-09-20T10:00:00.000Z',
        nowMs: now,
        cooldownMs: LOCATION_CHECK_COOLDOWN_MS,
      }),
      true,
    );
    assert.equal(shouldRefreshLocation({ lastLocationCheckAt: null }), true);
  });

  it('Product Page uses commerce country service without embedding GPS', () => {
    const page = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    assert.match(page, /getCommerceCountry/);
    assert.doesNotMatch(page, /expo-location|getCurrentPosition|reverseGeocode/);
    assert.match(page, /page\.offers/);
    const types = readFileSync(join(ROOT, 'src/types/productPage.ts'), 'utf8');
    assert.match(types, /export type ProductPageOffer/);
  });

  it('central service owns permission and foreground refresh', () => {
    const index = readFileSync(join(ROOT, 'src/services/commerceCountry/index.ts'), 'utf8');
    assert.match(index, /promptCommerceLocationOnboarding/);
    assert.match(index, /onCommerceCountryAppForeground/);
    assert.match(index, /setManualCommerceCountry/);
    assert.match(index, /enableAutomaticCommerceLocation/);
    assert.match(index, /countrySource === 'manual'/);
  });

  it('settings exposes shopping country override controls', () => {
    const settings = readFileSync(join(ROOT, 'app/settings.tsx'), 'utf8');
    assert.match(settings, /shoppingCountry/);
    assert.match(settings, /setManualCountry|enableAutomaticLocation/);
    assert.match(settings, /SHOPPING_COUNTRY_OPTIONS/);
  });
});
