/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { apiOnlyEnvironment } = require('./devApiOnly.cjs');

test('defaults to 8788 without mutating the parent environment or credentials', () => {
  const inherited = { SUPABASE_URL: 'test-url', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
  const before = { ...inherited };
  const env = apiOnlyEnvironment(inherited);
  assert.deepEqual(inherited, before);
  assert.equal(env.PORT, '8788');
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, inherited.SUPABASE_SERVICE_ROLE_KEY);
});

test('disables consumers and scheduled jobs even when inherited configuration enables them', () => {
  const flags = ['INGEST_WORKER_EMBEDDED', 'ANALYTICS_ENABLED',
    'ANALYTICS_MAINTENANCE_ENABLED', 'ANALYTICS_ROLLUPS_ENABLED',
    'ANALYTICS_ADMIN_ROLLUPS_ENABLED', 'ANALYTICS_INTEREST_WORKER_ENABLED',
    'NOTIFICATIONS_PUSH_ENABLED'];
  const env = apiOnlyEnvironment({ ...Object.fromEntries(flags.map(flag => [flag, 'true'])),
    DOTENV_CONFIG_OVERRIDE: 'true' });
  assert.equal(env.DOTENV_CONFIG_OVERRIDE, undefined);
  for (const flag of flags) assert.equal(env[flag], 'false', flag);
  dotenv.populate(env, Object.fromEntries(flags.map(flag => [flag, 'true'])),
    { override: env.DOTENV_CONFIG_OVERRIDE });
  for (const flag of flags) assert.equal(env[flag], 'false', `dotenv must preserve ${flag}`);
});

test('selects the supported zero-infrastructure search mode and free local embeddings', () => {
  const env = apiOnlyEnvironment({ NODE_ENV: 'production', SEARCH_ENV: 'production',
    SEARCH_INDEX_BACKEND: 'opensearch', OPENSEARCH_URL: 'http://127.0.0.1:9200',
    EMBEDDING_PROVIDER: 'openai' });
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.SEARCH_ENV, 'development');
  assert.equal(env.SEARCH_INDEX_BACKEND, 'memory');
  assert.equal(env.EMBEDDING_PROVIDER, 'local');
});

test('supports an independent test port but refuses the supervised port and invalid ports', () => {
  assert.equal(apiOnlyEnvironment({ PORT: '8789' }).PORT, '8789');
  for (const PORT of ['8787', '08787', '', '0', '-1', '65536', 'abc', '8788.5']) {
    assert.throws(() => apiOnlyEnvironment({ PORT }), /valid PORT/);
  }
});

test('the API startup gate still surrounds all embedded consumers and notifications', () => {
  const source = readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
  const gateStart = source.indexOf("if (getEnv('INGEST_WORKER_EMBEDDED') !== 'false')");
  const gate = source.slice(gateStart, source.indexOf('app.listen(', gateStart));
  for (const start of ['startEmbeddedIngestPipelineWorker()', 'startNotificationWorker(createSupabaseAdmin())',
    'startProductResolveWorker(createSupabaseAdmin())', 'startProductAiReviewWorker(createSupabaseAdmin())',
    'startContentSourceProcessingWorker(createSupabaseAdmin())', 'startCreatorLibrarySyncWorker(createSupabaseAdmin())']) {
    assert.ok(gate.includes(start), start);
    assert.ok(!source.slice(0, gateStart).includes(start), `startup moved outside gate: ${start}`);
  }
});
