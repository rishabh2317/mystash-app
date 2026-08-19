import { getEnv } from '../env';
import { logger } from '../logger';
import { createEmbeddingPort } from './embeddings/factory';
import type { EmbeddingPort } from './embeddings/EmbeddingPort';
import { LocalEmbeddingProvider } from './embeddings/LocalEmbeddingProvider';
import { InMemorySearchIndex } from './index/InMemorySearchIndex';
import {
  OpenSearchIndex,
  type EmbeddingSpace,
} from './index/OpenSearchIndex';
import type { SearchIndexPort } from './ports';
import { SearchService } from './SearchService';
import { SearchTelemetryStore } from './telemetry';

export type SearchRuntimeOptions = {
  index?: SearchIndexPort;
  embeddings?: EmbeddingPort;
  telemetry?: SearchTelemetryStore;
  /** Unit tests only — never a production escape hatch. */
  forceInMemory?: boolean;
};

export class SearchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchConfigurationError';
  }
}

export function isProductionSearchRuntime(): boolean {
  const searchEnv = (getEnv('SEARCH_ENV') ?? '').toLowerCase();
  if (searchEnv === 'production' || searchEnv === 'prod') return true;
  if (searchEnv === 'development' || searchEnv === 'dev' || searchEnv === 'test') {
    return false;
  }
  return (getEnv('NODE_ENV') ?? '').toLowerCase() === 'production';
}

/**
 * Backend selection (normative):
 * - forceInMemory → memory (tests)
 * - SEARCH_INDEX_BACKEND=memory → memory (forbidden in production)
 * - production OR SEARCH_INDEX_BACKEND=opensearch → opensearch (OPENSEARCH_URL required)
 * - development + OPENSEARCH_URL → opensearch
 * - development without URL → memory (explicit zero-infra local)
 */
export function resolveSearchIndexBackend(forceInMemory?: boolean): 'memory' | 'opensearch' {
  if (forceInMemory) return 'memory';

  const explicit = (getEnv('SEARCH_INDEX_BACKEND') ?? '').toLowerCase();
  const prod = isProductionSearchRuntime();

  if (explicit === 'memory' || explicit === 'inmemory') {
    if (prod) {
      throw new SearchConfigurationError(
        'SEARCH_INDEX_BACKEND=memory is forbidden in production. OpenSearch is required.',
      );
    }
    return 'memory';
  }

  if (explicit === 'opensearch' || prod) {
    return 'opensearch';
  }

  if (getEnv('OPENSEARCH_URL')) return 'opensearch';
  return 'memory';
}

export type SearchRuntimeSnapshot = {
  backend: 'memory' | 'opensearch';
  embeddingProvider: 'local' | 'openai';
  embeddingModelId: string;
  embeddingDimension: number;
  /** Present only when backend is OpenSearch. Never includes credentials. */
  opensearchUrl: string | null;
};

/**
 * Safe runtime description for startup logs. Does not instantiate OpenAI
 * (that requires OPENAI_API_KEY) and never returns secrets.
 */
export function describeSearchRuntime(forceInMemory?: boolean): SearchRuntimeSnapshot {
  const backend = resolveSearchIndexBackend(forceInMemory);
  const kind = (getEnv('EMBEDDING_PROVIDER') ?? 'local').toLowerCase();
  const embeddingProvider = kind === 'openai' ? 'openai' : 'local';
  const local = new LocalEmbeddingProvider();
  const embeddingModelId =
    embeddingProvider === 'openai' ? 'text-embedding-3-small' : local.modelId;
  const embeddingDimension = embeddingProvider === 'openai' ? 1536 : local.dimension;
  return {
    backend,
    embeddingProvider,
    embeddingModelId,
    embeddingDimension,
    opensearchUrl: backend === 'opensearch' ? getEnv('OPENSEARCH_URL') ?? null : null,
  };
}

export function logSearchRuntime(forceInMemory?: boolean): SearchRuntimeSnapshot {
  const snapshot = describeSearchRuntime(forceInMemory);
  logger.info(
    {
      backend: snapshot.backend,
      embeddingProvider: snapshot.embeddingProvider,
      embeddingModelId: snapshot.embeddingModelId,
      embeddingDimension: snapshot.embeddingDimension,
      opensearchUrl: snapshot.opensearchUrl,
    },
    `Search backend: ${snapshot.backend}; Embedding provider: ${snapshot.embeddingProvider}` +
      (snapshot.opensearchUrl ? `; OpenSearch endpoint: ${snapshot.opensearchUrl}` : ''),
  );
  return snapshot;
}

function spaceFromEmbeddings(embeddings: EmbeddingPort): EmbeddingSpace {
  return {
    embeddingModelId: embeddings.modelId,
    embeddingVersion: embeddings.version,
    embeddingDimension: embeddings.dimension,
  };
}

/**
 * Create SearchService.
 * Production never silently falls back to InMemorySearchIndex.
 */
export function createSearchService(opts?: SearchRuntimeOptions): SearchService {
  const embeddings = opts?.embeddings ?? createEmbeddingPort();
  const telemetry = opts?.telemetry ?? new SearchTelemetryStore();

  let index = opts?.index;
  if (!index) {
    const backend = resolveSearchIndexBackend(opts?.forceInMemory);
    if (backend === 'memory') {
      index = new InMemorySearchIndex({
        embeddingSpace: spaceFromEmbeddings(embeddings),
      });
    } else {
      const url = getEnv('OPENSEARCH_URL');
      if (!url) {
        throw new SearchConfigurationError(
          'OpenSearch is required but OPENSEARCH_URL is not set. ' +
            'Set OPENSEARCH_URL (e.g. http://127.0.0.1:9200). ' +
            'For local zero-infra only: SEARCH_INDEX_BACKEND=memory with non-production NODE_ENV/SEARCH_ENV. ' +
            'Production must never fall back to InMemorySearchIndex.',
        );
      }
      const os = new OpenSearchIndex({
        node: url,
        username: getEnv('OPENSEARCH_USERNAME'),
        password: getEnv('OPENSEARCH_PASSWORD'),
        indexPrefix: getEnv('OPENSEARCH_INDEX_PREFIX') ?? 'mystash_search',
        embeddingSpace: spaceFromEmbeddings(embeddings),
      });
      index = os;
      void os.ensureIndexes()
        .then(() => {
          logger.info(
            { backend: 'opensearch', opensearchUrl: url },
            'search OpenSearch indexes/aliases ensured',
          );
        })
        .catch((err: unknown) => {
          /* Never swap to InMemory — first query/ops will also surface the error. */
          logger.error(
            { err, backend: 'opensearch', opensearchUrl: url },
            'search OpenSearch ensureIndexes failed; not falling back to InMemory',
          );
        });
    }
  }

  return new SearchService(index, embeddings, telemetry);
}

let shared: SearchService | null = null;

export function getSharedSearchService(): SearchService {
  if (!shared) shared = createSearchService();
  return shared;
}

export function resetSharedSearchServiceForTests(): void {
  shared = null;
}

export { SearchService, SearchServiceError } from './SearchService';
export { InMemorySearchIndex } from './index/InMemorySearchIndex';
export {
  OpenSearchIndex,
  EmbeddingSpaceMismatchError,
  OpenSearchConfigError,
} from './index/OpenSearchIndex';
export { createEmbeddingPort } from './embeddings/factory';
export type { SearchIndexPort } from './ports';
export type { EmbeddingPort } from './embeddings/EmbeddingPort';
