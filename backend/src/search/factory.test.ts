import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import {
  resolveSearchIndexBackend,
  SearchConfigurationError,
  createSearchService,
  describeSearchRuntime,
  resetSharedSearchServiceForTests,
} from './factory';

describe('Search factory backend selection', () => {
  const envKeys = [
    'NODE_ENV',
    'SEARCH_ENV',
    'SEARCH_INDEX_BACKEND',
    'OPENSEARCH_URL',
    'EMBEDDING_PROVIDER',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  before(() => {
    for (const k of envKeys) saved[k] = process.env[k];
  });

  after(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetSharedSearchServiceForTests();
  });

  function clearEnv() {
    for (const k of envKeys) delete process.env[k];
  }

  it('uses memory when SEARCH_INDEX_BACKEND=memory in non-production', () => {
    clearEnv();
    process.env.SEARCH_ENV = 'development';
    process.env.SEARCH_INDEX_BACKEND = 'memory';
    assert.equal(resolveSearchIndexBackend(), 'memory');
  });

  it('fails fast when production lacks OPENSEARCH_URL', () => {
    clearEnv();
    process.env.SEARCH_ENV = 'production';
    delete process.env.OPENSEARCH_URL;
    assert.equal(resolveSearchIndexBackend(), 'opensearch');
    assert.throws(() => createSearchService(), (e: unknown) => {
      assert.ok(e instanceof SearchConfigurationError);
      assert.match((e as Error).message, /OPENSEARCH_URL/);
      return true;
    });
  });

  it('forbids SEARCH_INDEX_BACKEND=memory in production', () => {
    clearEnv();
    process.env.SEARCH_ENV = 'production';
    process.env.SEARCH_INDEX_BACKEND = 'memory';
    assert.throws(() => resolveSearchIndexBackend(), SearchConfigurationError);
  });

  it('forceInMemory works for unit tests', () => {
    clearEnv();
    process.env.SEARCH_ENV = 'production';
    const svc = createSearchService({ forceInMemory: true });
    assert.ok(svc);
  });

  it('fails fast when SEARCH_INDEX_BACKEND=opensearch lacks OPENSEARCH_URL in development', () => {
    clearEnv();
    process.env.SEARCH_ENV = 'development';
    process.env.SEARCH_INDEX_BACKEND = 'opensearch';
    delete process.env.OPENSEARCH_URL;
    assert.equal(resolveSearchIndexBackend(), 'opensearch');
    assert.throws(() => createSearchService(), (e: unknown) => {
      assert.ok(e instanceof SearchConfigurationError);
      assert.match((e as Error).message, /OPENSEARCH_URL/);
      assert.doesNotMatch((e as Error).message, /InMemorySearchIndex is required/i);
      return true;
    });
  });

  it('describes explicit local OpenSearch runtime without secrets', () => {
    clearEnv();
    process.env.SEARCH_ENV = 'development';
    process.env.SEARCH_INDEX_BACKEND = 'opensearch';
    process.env.OPENSEARCH_URL = 'http://127.0.0.1:9200';
    process.env.EMBEDDING_PROVIDER = 'local';
    const snap = describeSearchRuntime();
    assert.equal(snap.backend, 'opensearch');
    assert.equal(snap.embeddingProvider, 'local');
    assert.equal(snap.embeddingDimension, 384);
    assert.equal(snap.embeddingModelId, 'local-feature-hash');
    assert.equal(snap.opensearchUrl, 'http://127.0.0.1:9200');
  });

  it('selects OpenSearch when SEARCH_INDEX_BACKEND=opensearch even if URL is unreachable', () => {
    clearEnv();
    process.env.SEARCH_ENV = 'development';
    process.env.SEARCH_INDEX_BACKEND = 'opensearch';
    process.env.OPENSEARCH_URL = 'http://127.0.0.1:1';
    process.env.EMBEDDING_PROVIDER = 'local';
    assert.equal(resolveSearchIndexBackend(), 'opensearch');
    assert.equal(describeSearchRuntime().backend, 'opensearch');
    const svc = createSearchService();
    assert.ok(svc);
  });
});
