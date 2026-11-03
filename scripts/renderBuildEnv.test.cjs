/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformSync } = require('@babel/core');
const root = path.resolve(__dirname, '..');
const target = require('../eas.json').build['render-test'].env.EXPO_PUBLIC_MYSTASH_INGEST_URL;

function compile(profile, source = 'const endpoint = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL;') {
  const oldProfile = process.env.EAS_BUILD_PROFILE;
  const oldUrl = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL;
  try {
    if (profile) process.env.EAS_BUILD_PROFILE = profile;
    else delete process.env.EAS_BUILD_PROFILE;
    process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL = 'https://api-dev.mystash.in';
    return transformSync(source, {
      filename: path.join(root, 'src/renderBuildEndpointFixture.js'),
      configFile: path.join(root, 'babel.config.js'), babelrc: false,
      caller: { name: 'metro', bundler: 'metro', platform: 'android', isDev: false },
    }).code;
  } finally {
    if (oldProfile === undefined) delete process.env.EAS_BUILD_PROFILE;
    else process.env.EAS_BUILD_PROFILE = oldProfile;
    if (oldUrl === undefined) delete process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL;
    else process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL = oldUrl;
  }
}

test('Render release embeds its profile endpoint despite stale shared preview environment', () => {
  for (const profile of ['render-test', 'android-share-validation']) {
    const code = compile(profile);
    assert.ok(code.includes(target));
    assert.ok(!code.includes('api-dev.mystash.in'));
  }
});
test('local, preview, pilot and production endpoints remain untouched across cached configs', () => {
  for (const profile of [undefined, 'preview', 'analytics-pilot', 'production', 'render-test', undefined]) {
    const code = compile(profile);
    assert.ok(code.includes(profile === 'render-test' ? target : 'https://api-dev.mystash.in'));
  }
});
test('all endpoint reads in a module use the Render endpoint', () => {
  const code = compile('render-test', 'const a = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL; const b = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\\/$/, "");');
  assert.equal(code.split(target).length - 1, 2);
});
test('rejects insecure or credential-bearing build targets', () => {
  for (const backendUrl of ['http://localhost:8787', 'https://user:password@example.com', 'https://example.com?token=x']) {
    assert.throws(() => transformSync('process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL;', {
      configFile: false, babelrc: false,
      plugins: [[require('./renderBuildEnv.cjs'), { backendUrl }]],
    }), /public HTTPS/);
  }
});
