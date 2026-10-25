import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { UnverifiedEmailError, assertEmailVerified, isAuthEmailVerified } from './emailVerification';

const ROOT = join(__dirname, '../../..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

const VERIFIED_GUARD =
  /requireAuthUser|requireAuthUserId|optionalVerifiedUserId|assertEmailVerified|isAuthEmailVerified/;

describe('authenticated write-path email verification inventory', () => {
  it('blocks unverified users before privileged work', () => {
    assert.throws(() => assertEmailVerified({ email_confirmed_at: null }), UnverifiedEmailError);
    assert.doesNotThrow(() =>
      assertEmailVerified({ email_confirmed_at: '2026-01-01T00:00:00.000Z' }),
    );
    assert.equal(
      isAuthEmailVerified({
        identities: [{ provider: 'google', identity_data: { email_verified: false } }],
      }),
      false,
    );
  });

  it('guards Node write entry points that create or mutate user-owned data', () => {
    const files = [
      'backend/src/index.ts',
      'backend/src/publish.ts',
      'backend/src/user/routes.ts',
      'backend/src/collection/routes.ts',
      'backend/src/cart/routes.ts',
      'backend/src/engagement/routes.ts',
      'backend/src/connected-accounts/routes.ts',
      'backend/src/creator-library/routes.ts',
      'backend/src/brand-campaign/routes.ts',
      'backend/src/user-import/routes.ts',
      'backend/src/notifications/routes.ts',
      'backend/src/place/routes.ts',
    ];
    for (const file of files) {
      assert.match(read(file), VERIFIED_GUARD, file);
    }
    assert.match(read('backend/src/index.ts'), /requireAuthUser/);
    assert.match(read('backend/src/publish.ts'), /requireAuthUser/);
    assert.doesNotMatch(read('backend/src/index.ts'), /createSupabaseUserClient/);
    assert.doesNotMatch(read('backend/src/publish.ts'), /createSupabaseUserClient/);
    for (const file of [
      'backend/src/user-import/routes.ts',
      'backend/src/notifications/routes.ts',
      'backend/src/place/routes.ts',
    ]) {
      assert.match(read(file), /rethrowUnverifiedEmail/, file);
    }
  });

  it('guards legacy Edge ingest and publish functions', () => {
    assert.match(read('supabase/functions/ingest-url/index.ts'), /isAuthEmailVerified/);
    assert.match(read('supabase/functions/publish-ingest/index.ts'), /isAuthEmailVerified/);
    assert.match(read('supabase/functions/_shared/emailVerification.ts'), /email_verified/);
  });

  it('does not treat public catalog reads as verification gates', () => {
    assert.doesNotMatch(read('backend/src/product-page/routes.ts'), VERIFIED_GUARD);
    assert.doesNotMatch(read('backend/src/ai-review/routes.ts'), VERIFIED_GUARD);
    assert.doesNotMatch(read('backend/src/merchant-pricing/routes.ts'), VERIFIED_GUARD);
  });
});
