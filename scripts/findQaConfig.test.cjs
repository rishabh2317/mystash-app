const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const config = require('../app.json').expo;
const resolve = require('../app.config.js');
const eas = require('../eas.json');

function withEnv(values, run) {
  const keys = ['EAS_BUILD_PROFILE', 'EAS_BUILD', 'GOOGLE_SERVICES_JSON', 'MYSTASH_QA_FIREBASE_PROJECT_ID'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try { for (const k of keys) { if (values[k] === undefined) delete process.env[k]; else process.env[k] = values[k]; } return run(); }
  finally { for (const k of keys) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; } }
}
test('QA inherits the existing signed internal APK, native share flags, and unchanged app identifiers/version', () => {
  function profile(name) { const p = eas.build[name], base = p.extends ? profile(p.extends) : {}; return { ...base, ...p, env: { ...base.env, ...p.env } }; }
  const qa = profile('universal-find-qa');
  assert.equal(qa.distribution, 'internal'); assert.equal(qa.android.buildType, 'apk'); assert.equal(qa.credentialsSource, 'remote');
  assert.equal(qa.environment, 'preview'); assert.equal(qa.autoIncrement, true);
  for (const flag of ['EXPO_PUBLIC_NATIVE_SHARE_ENABLED', 'EXPO_PUBLIC_SHARE_INTENT_ENABLED', 'EXPO_PUBLIC_SHARE_SUGGESTIONS_ENABLED', 'EXPO_PUBLIC_FIND_MEASUREMENT_ENABLED', 'EXPO_PUBLIC_NOTIFICATIONS_ENABLED', 'EXPO_PUBLIC_PUSH_ENABLED']) assert.equal(qa.env[flag], 'true');
  assert.equal(qa.env.EXPO_PUBLIC_MYSTASH_INGEST_URL, 'https://mystash-free-test.onrender.com');
  assert.equal(qa.env.EXPO_PUBLIC_SUPABASE_URL, 'https://womdeohfpvzmhomgqwig.supabase.co');
  const core = profile('universal-find-qa-core');
  assert.equal(core.env.EXPO_PUBLIC_PUSH_ENABLED, 'false');
  assert.equal(core.env.EXPO_PUBLIC_NOTIFICATIONS_ENABLED, 'true');
  assert.equal(core.env.EXPO_PUBLIC_MYSTASH_INGEST_URL, qa.env.EXPO_PUBLIC_MYSTASH_INGEST_URL);
  assert.equal(core.android.buildType, qa.android.buildType);
  assert.equal(config.version, '1.0.0'); assert.equal(config.android.package, 'com.anonymous.Mystash'); assert.equal(config.ios.bundleIdentifier, 'com.anonymous.Mystash');
});
test('Firebase configuration is scoped to QA and missing remote credentials fail closed', () => {
  for (const profile of [undefined, 'preview', 'production', 'android-share-validation', 'universal-find-qa-core']) withEnv({ EAS_BUILD_PROFILE: profile, EAS_BUILD: 'true', GOOGLE_SERVICES_JSON: '/missing' }, () => assert.equal(resolve({ config }), config));
  withEnv({ EAS_BUILD_PROFILE: 'universal-find-qa' }, () => assert.equal(resolve({ config }), config));
  withEnv({ EAS_BUILD_PROFILE: 'universal-find-qa', EAS_BUILD: 'true' }, () => assert.throws(() => resolve({ config }), /requires the approved/));
});
test('QA accepts only Firebase client configuration for the approved project and same Android package', () => {
  const directory = mkdtempSync('/private/tmp/mystash-qa-config-'), file = path.join(directory, 'google-services.json');
  const valid = { project_info: { project_id: 'mystash-496009' }, client: [{ client_info: { android_client_info: { package_name: config.android.package } } }] };
  try { withEnv({ EAS_BUILD_PROFILE: 'universal-find-qa', EAS_BUILD: 'true', GOOGLE_SERVICES_JSON: file, MYSTASH_QA_FIREBASE_PROJECT_ID: 'mystash-496009' }, () => {
    for (const invalid of [{ type: 'service_account', private_key: 'FIXTURE' }, { ...valid, project_info: { project_id: 'other' } }, { ...valid, client: [] }]) {
      writeFileSync(file, JSON.stringify(invalid)); assert.throws(() => resolve({ config }), /approved project/);
    }
    writeFileSync(file, JSON.stringify(valid)); const next = resolve({ config });
    assert.equal(next.android.googleServicesFile, file); assert.deepEqual({ ...next, android: config.android }, config);
  }); } finally { rmSync(directory, { recursive: true, force: true }); }
});
