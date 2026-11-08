/* Offline transport contract: no network, auth secrets, or backend process. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const file = path.resolve(__dirname, '../src/services/searchApi.ts');
const mod = new Module(file, module);
mod.filename = file;
mod.require = id => {
  if (id === '@/src/analytics/client') return { analyticsHeaders: () => ({}), enqueueObservation() {} };
  if (id === '@/src/services/newEventId') return { newEventId: () => 'fixture-id' };
  if (id === '@/src/services/supabase') return { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } };
  return require(id);
};
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText, file);

const originalFetch = global.fetch, originalBase = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL;
process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL = 'https://fixture.invalid';
const calls = [];
global.fetch = async (url, init) => {
  calls.push({ url: new URL(url), method: init.method });
  return Response.json({ query: 'fixture', intent: 'DISCOVERY', retrievalMode: 'lexical_only',
    presentation: 'unified', results: [], nextCursor: null, zeroResult: true, latencyMs: 1 });
};
(async () => {
  await mod.exports.searchBlended({ q: 'https://example.com/video', entityType: 'product', presentation: 'unified', limit: 20 });
  assert.equal(calls[0].url.pathname, '/search');
  assert.equal(calls[0].url.searchParams.get('q'), 'https://example.com/video');
  assert.equal(calls[0].url.searchParams.get('entity_type'), 'product');
  assert.equal(calls[0].method, 'GET');
  await mod.exports.searchBlended({ q: 'linen' });
  assert.equal(calls[1].url.searchParams.has('entity_type'), false, 'old consumers keep their query contract');
  console.log('2 Search API transport checks passed.');
})().finally(() => {
  global.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL;
  else process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL = originalBase;
}).catch(error => { console.error(error); process.exitCode = 1; });
