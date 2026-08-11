/**
 * Focused auth-intent validation checks (no test framework required).
 * Run: npx --yes tsx src/navigation/authIntent.validation.ts
 */
import assert from 'node:assert/strict';

import {
  AUTH_INTENT_ADD_TO_CART,
  appendAuthIntentToRedirectUrl,
  buildProfileHrefAfterAuth,
  isValidCatalogProductId,
  parseAddToCartIntent,
} from './authIntent';

function run() {
  assert.equal(isValidCatalogProductId('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isValidCatalogProductId('prod_abc-123'), true);
  assert.equal(isValidCatalogProductId(''), false);
  assert.equal(isValidCatalogProductId('../etc/passwd'), false);
  assert.equal(isValidCatalogProductId('https://evil.example/x'), false);
  assert.equal(isValidCatalogProductId('a'.repeat(129)), false);

  assert.deepEqual(
    parseAddToCartIntent({
      intent: AUTH_INTENT_ADD_TO_CART,
      catalogProductId: '550e8400-e29b-41d4-a716-446655440000',
    }),
    {
      intent: AUTH_INTENT_ADD_TO_CART,
      catalogProductId: '550e8400-e29b-41d4-a716-446655440000',
    },
  );

  assert.equal(parseAddToCartIntent({ intent: 'SAVE', catalogProductId: 'abc' }), null);
  assert.equal(parseAddToCartIntent({ intent: AUTH_INTENT_ADD_TO_CART }), null);
  assert.equal(
    parseAddToCartIntent({
      intent: AUTH_INTENT_ADD_TO_CART,
      catalogProductId: 'https://evil',
    }),
    null,
  );
  assert.equal(parseAddToCartIntent({}), null);

  assert.deepEqual(buildProfileHrefAfterAuth({}), { pathname: '/(tabs)/profile' });
  assert.deepEqual(
    buildProfileHrefAfterAuth({
      intent: AUTH_INTENT_ADD_TO_CART,
      catalogProductId: 'prod_1',
    }),
    {
      pathname: '/(tabs)/profile',
      params: { intent: AUTH_INTENT_ADD_TO_CART, catalogProductId: 'prod_1' },
    },
  );
  assert.deepEqual(
    buildProfileHrefAfterAuth({
      intent: 'FOLLOW',
      catalogProductId: 'prod_1',
    }),
    { pathname: '/(tabs)/profile' },
  );

  assert.equal(
    appendAuthIntentToRedirectUrl('mystash://auth/callback', null),
    'mystash://auth/callback',
  );
  assert.equal(
    appendAuthIntentToRedirectUrl('mystash://auth/callback', {
      intent: AUTH_INTENT_ADD_TO_CART,
      catalogProductId: 'prod_1',
    }),
    'mystash://auth/callback?intent=ADD_TO_CART&catalogProductId=prod_1',
  );
  assert.equal(
    appendAuthIntentToRedirectUrl('mystash://auth/callback', {
      intent: AUTH_INTENT_ADD_TO_CART,
      catalogProductId: 'bad://id',
    }),
    'mystash://auth/callback',
  );

  console.log('authIntent validation checks passed');
}

run();
