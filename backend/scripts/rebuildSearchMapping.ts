/**
 * Explicit Search projection rebuild for mapping changes. Never runs at API startup.
 * Pause Search index writers first; this copies the current disposable projection,
 * checks counts, and atomically promotes each entity alias only after all copies pass.
 * Run from backend with --apply and SEARCH_WRITERS_PAUSED=1 after reviewing the target.
 */
import 'dotenv/config';
import { createEmbeddingPort } from '../src/search/embeddings/factory';
import { OpenSearchIndex } from '../src/search/index/OpenSearchIndex';
import type { SearchEntityType } from '../src/search/domain/types';

async function main(): Promise<void> {
  const node = process.env.OPENSEARCH_URL;
  if (!node) throw new Error('OPENSEARCH_URL is required');
  if (!process.argv.includes('--apply') || process.env.SEARCH_WRITERS_PAUSED !== '1') {
    throw new Error('No changes made. Re-run with --apply and SEARCH_WRITERS_PAUSED=1 after pausing Search index writers.');
  }
  const embeddings = createEmbeddingPort();
  const index = new OpenSearchIndex({ node, username: process.env.OPENSEARCH_USERNAME,
    password: process.env.OPENSEARCH_PASSWORD,
    indexPrefix: process.env.OPENSEARCH_INDEX_PREFIX ?? 'mystash_search',
    embeddingSpace: { embeddingModelId: embeddings.modelId, embeddingVersion: embeddings.version,
      embeddingDimension: embeddings.dimension } });
  const prepared: { type: SearchEntityType; generation: number; source: string; target: string }[] = [];
  for (const type of ['collection', 'creator', 'product'] as const) {
    const before = await index.resolveAlias(index.aliasName(type));
    if (!before) throw new Error(`Serving alias missing for ${type}; no aliases promoted`);
    const { generation, physical } = await index.beginRebuild(type);
    const counts = await index.copyServingToGeneration(type, generation);
    console.log(`${type}: ${before.physical} -> ${physical}; checked ${counts.targetCount} documents`);
    prepared.push({ type, generation, source: before.physical, target: physical });
  }
  for (const item of prepared) {
    await index.promoteGeneration(item.type, item.generation);
    console.log(`${item.type}: promoted ${item.target}; previous generation retained at ${item.source}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
