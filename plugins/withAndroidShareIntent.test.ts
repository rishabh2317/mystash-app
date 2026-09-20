import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const plugin = require('./withAndroidShareIntent.js') as {
  addShareIntentActivity: (manifest: unknown) => {
    manifest: { application: { activity?: unknown[] }[] };
  };
  shareIntentActivityKotlin: (packageName: string) => string;
  SHARE_ACTIVITY_NAME: string;
  MAX_SHARED_TEXT_LENGTH: number;
};

type ManifestActivity = {
  $: Record<string, string>;
  'intent-filter'?: {
    action?: { $: Record<string, string> }[];
    category?: { $: Record<string, string> }[];
    data?: { $: Record<string, string> }[];
  }[];
};

function emptyManifest() {
  return {
    manifest: {
      application: [{ $: { 'android:name': '.MainApplication' }, activity: [] as ManifestActivity[] }],
    },
  };
}

function shareActivity(manifest: ReturnType<typeof emptyManifest>): ManifestActivity {
  const activities = (manifest.manifest.application[0].activity ?? []) as ManifestActivity[];
  const found = activities.find((a) => a.$['android:name'] === plugin.SHARE_ACTIVITY_NAME);
  assert.ok(found, 'share activity missing from manifest');
  return found;
}

describe('Android share target manifest', () => {
  it('registers an exported ACTION_SEND text/plain activity', () => {
    const manifest = plugin.addShareIntentActivity(
      emptyManifest(),
    ) as unknown as ReturnType<typeof emptyManifest>;
    const activity = shareActivity(manifest);
    const filter = activity['intent-filter']?.[0];

    assert.equal(activity.$['android:exported'], 'true');
    assert.equal(filter?.action?.[0].$['android:name'], 'android.intent.action.SEND');
    assert.equal(filter?.category?.[0].$['android:name'], 'android.intent.category.DEFAULT');
    assert.equal(filter?.data?.[0].$['android:mimeType'], 'text/plain');
  });

  it('is idempotent across repeated prebuilds', () => {
    let manifest = emptyManifest();
    manifest = plugin.addShareIntentActivity(manifest) as unknown as typeof manifest;
    manifest = plugin.addShareIntentActivity(manifest) as unknown as typeof manifest;

    const activities = (manifest.manifest.application[0].activity ?? []) as ManifestActivity[];
    const matches = activities.filter(
      (a) => a.$['android:name'] === plugin.SHARE_ACTIVITY_NAME,
    );
    assert.equal(matches.length, 1);
  });
});

describe('Android share target native source', () => {
  const kotlin = plugin.shareIntentActivityKotlin('com.anonymous.Mystash');

  it('forwards the shared payload as a mystash://import deep link', () => {
    assert.match(kotlin, /package com\.anonymous\.Mystash/);
    assert.match(kotlin, /Intent\.EXTRA_TEXT/);
    assert.match(kotlin, /const val SCHEME = "mystash"/);
    assert.match(kotlin, /const val IMPORT_HOST = "import"/);
    assert.match(kotlin, /Intent\(this, MainActivity::class\.java\)/);
    assert.match(kotlin, /action = Intent\.ACTION_VIEW/);
  });

  it('bounds the payload and preserves it verbatim otherwise', () => {
    assert.match(kotlin, new RegExp(`MAX_SHARED_TEXT_LENGTH = ${plugin.MAX_SHARED_TEXT_LENGTH}`));
    assert.match(kotlin, /\.trim\(\)\.take\(MAX_SHARED_TEXT_LENGTH\)/);
  });

  it('contains no product, catalog, network or AI logic', () => {
    const code = kotlin
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');
    assert.doesNotMatch(code, /http|fetch|OkHttp|catalog|product|openai/i);
  });
});
