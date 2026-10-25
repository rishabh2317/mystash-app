import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  UnsafeDatabaseTargetError,
  assertSafeTestTarget,
  isLocalSupabaseUrl,
  isProductionSupabaseUrl,
} from './databaseTargetGuard';

const env = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'test', ...extra }) as NodeJS.ProcessEnv;

describe('database target guard', () => {
  it('accepts the local stack by default', () => {
    assert.equal(assertSafeTestTarget('http://127.0.0.1:54321', undefined, env()), 'local');
    assert.ok(isLocalSupabaseUrl('http://localhost:54321'));
  });

  it('refuses the production project in every mode', () => {
    const prod = 'https://womdeohfpvzmhomgqwig.supabase.co';
    assert.ok(isProductionSupabaseUrl(prod, env()));
    for (const target of [undefined, 'local', 'staging']) {
      assert.throws(() => assertSafeTestTarget(prod, target, env()), UnsafeDatabaseTargetError);
    }
  });

  it('honours configured production URLs and refs', () => {
    assert.throws(
      () => assertSafeTestTarget('https://abc.supabase.co', 'staging', env({ SUPABASE_PRODUCTION_URL: 'https://abc.supabase.co' })),
      UnsafeDatabaseTargetError,
    );
    assert.throws(
      () => assertSafeTestTarget('https://def.supabase.co', 'staging', env({ SUPABASE_PRODUCTION_PROJECT_REFS: 'xyz, def' })),
      UnsafeDatabaseTargetError,
    );
  });

  it('requires staging to be explicit and refuses NODE_ENV=production', () => {
    assert.throws(() => assertSafeTestTarget('https://stg.supabase.co', undefined, env()), UnsafeDatabaseTargetError);
    assert.equal(assertSafeTestTarget('https://stg.supabase.co', 'staging', env()), 'staging');
    assert.throws(
      () => assertSafeTestTarget('http://127.0.0.1:54321', 'local', { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      UnsafeDatabaseTargetError,
    );
    assert.throws(() => assertSafeTestTarget('not a url', 'staging', env()), UnsafeDatabaseTargetError);
  });
});
