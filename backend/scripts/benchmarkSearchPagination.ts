/** Disposable local OpenSearch benchmark; refuses remote targets. */
import { buildProductSearchDocument } from '../src/search/documents';
import { LocalEmbeddingProvider } from '../src/search/embeddings/LocalEmbeddingProvider';
import { OpenSearchIndex } from '../src/search/index/OpenSearchIndex';
import { SearchService } from '../src/search/SearchService';

async function main(): Promise<void> {
  const node = process.env.OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
  const parsed = new URL(node);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('Local OpenSearch only');
  const count = Number(process.env.SEARCH_BENCHMARK_DOCS ?? 1000);
  if (!Number.isInteger(count) || count < 100 || count > 100000) throw new Error('SEARCH_BENCHMARK_DOCS must be 100–100000');
  const prefix = `mystash_bench_${Date.now()}`;
  const embeddings = new LocalEmbeddingProvider(64);
  const index = new OpenSearchIndex({ node, indexPrefix: prefix, embeddingSpace: {
    embeddingModelId: embeddings.modelId, embeddingVersion: embeddings.version,
    embeddingDimension: embeddings.dimension } });
  const svc = new SearchService(index, embeddings);
  try {
    await index.ensureIndexes();
    const started = Date.now();
    for (let offset = 0; offset < count; offset += 500) {
      const docs = Array.from({ length: Math.min(500, count - offset) }, (_, i) => {
        const n = offset + i;
        return buildProductSearchDocument({ catalogProductId: `bench-${String(n).padStart(6, '0')}`,
          name: `Travel Backpack ${n}`, brand: n % 100 === 0 ? 'Niche' : 'Common',
          category: 'Bags', searchEligible: true });
      });
      await index.upsertMany(docs);
    }
    const indexMs = Date.now() - started;
    const seen = new Set<string>();
    const latencies: number[] = [];
    let cursor: string | null = null;
    let firstMs = 0;
    do {
      const pageStart = Date.now();
      const page = await svc.search({ q: 'Travel Backpack', entityType: 'product',
        lexicalOnly: true, limit: 50, cursor });
      const elapsed = Date.now() - pageStart;
      if (!latencies.length) firstMs = elapsed;
      latencies.push(elapsed);
      for (const result of page.results) {
        if (seen.has(result.id)) throw new Error(`Duplicate ${result.id}`);
        seen.add(result.id);
      }
      cursor = page.nextCursor;
      if (latencies.length > Math.ceil(count / 50) + 3) throw new Error('Pagination did not terminate');
    } while (cursor);
    if (seen.size !== count) throw new Error(`Missing results: expected ${count}, got ${seen.size}`);
    latencies.sort((a, b) => a - b);
    const percentile = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * (latencies.length - 1)))];
    console.log(JSON.stringify({ fixture: 'local OpenSearch 2.19 synthetic public products', count,
      indexMs, pages: latencies.length, firstMs, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
      allUnique: true }));
  } finally {
    // The prefix is generated in this process and cannot address a live or shared index.
    await fetch(`${node}/${prefix}_*`, { method: 'DELETE' }).catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
