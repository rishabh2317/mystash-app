/** Read local Mystash indexes, clone into a disposable v2 mapping, compare representative queries. */
import { LocalEmbeddingProvider } from '../src/search/embeddings/LocalEmbeddingProvider';
import { OpenSearchIndex } from '../src/search/index/OpenSearchIndex';
import { SearchService } from '../src/search/SearchService';
import type { SearchDocument, SearchEntityType } from '../src/search/domain/types';

const node = process.env.OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const sourcePrefix = process.env.SEARCH_EVAL_SOURCE_PREFIX ?? 'mystash_search';
const targetPrefix = `mystash_eval_${Date.now()}`;

async function json(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${node}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function main(): Promise<void> {
  if (!['localhost', '127.0.0.1'].includes(new URL(node).hostname)) throw new Error('Local OpenSearch only');
  const embeddings = new LocalEmbeddingProvider();
  const target = new OpenSearchIndex({ node, indexPrefix: targetPrefix, embeddingSpace: {
    embeddingModelId: embeddings.modelId, embeddingVersion: embeddings.version,
    embeddingDimension: embeddings.dimension } });
  const service = new SearchService(target, embeddings);
  const cases: { type: SearchEntityType; query: string; expected: string; kind: string }[] = [];
  const counts: Record<string, number> = {};
  try {
    await target.ensureIndexes();
    for (const type of ['collection', 'creator', 'product'] as const) {
      const sourceAlias = `${sourcePrefix}_${type}s`;
      const old = await json(`/${sourceAlias}/_search`, { size: 1000, query: { term: { searchEligible: true } } });
      const docs: SearchDocument[] = (old.hits?.hits ?? []).map((h: any) => h._source?.document && ({
        ...h._source.document, embedding: h._source.embedding ?? h._source.document.embedding,
      })).filter(Boolean);
      counts[type] = docs.length;
      if (docs.length >= 1000) throw new Error(`${sourceAlias} exceeds 1000 documents; use a paged evaluator`);
      const targetAlias = target.aliasName(type);
      await target.upsertManyIntoPhysical((await target.resolveAlias(targetAlias))!.physical, docs);
      if (type === 'collection') {
        const d = docs.find(d => d.entityType === 'collection' && d.searchTitle?.trim());
        if (d?.entityType === 'collection') cases.push({ type, query: d.searchTitle!, expected: d.id, kind: 'exact collection title' });
      } else if (type === 'creator') {
        const d = docs.find(d => d.entityType === 'creator' && d.username?.trim());
        if (d?.entityType === 'creator') cases.push({ type, query: `@${d.username}`, expected: d.id, kind: 'exact creator handle' });
      } else {
        const model = docs.find(d => d.entityType === 'product' && d.model?.toLowerCase().includes('galaxy s26 ultra'));
        if (model?.entityType === 'product') cases.push({ type, query: model.model!, expected: model.id, kind: 'product model' });
        const name = docs.find(d => d.entityType === 'product' && d.name?.toLowerCase() === 'running shoe');
        if (name?.entityType === 'product') cases.push({ type, query: name.name, expected: name.id, kind: 'exact product title' });
      }
    }
    const results = [];
    for (const sample of cases) {
      const oldStarted = Date.now();
      const old = await json(`/${sourcePrefix}_${sample.type}s/_search`, { size: 20,
        query: { bool: { must: [{ multi_match: { query: sample.query,
          fields: ['searchableText^1', 'document.searchTitle^2', 'document.name^2', 'document.username^2', 'suggestText^1.5'],
          type: 'best_fields', fuzziness: 'AUTO' } }], filter: [{ term: { searchEligible: true } }] } } });
      const oldMs = Date.now() - oldStarted;
      const oldIds: string[] = (old.hits?.hits ?? []).map((h: any) => String(h._id));
      const newStarted = Date.now();
      const current = await service.search({ q: sample.query, entityType: sample.type, limit: 20 });
      const newMs = Date.now() - newStarted;
      results.push({ kind: sample.kind, query: sample.query, oldLexicalRank: oldIds.indexOf(sample.expected) + 1 || null,
        newHybridRank: current.results.findIndex(h => h.id === sample.expected) + 1 || null,
        oldLexicalMs: oldMs, newHybridMs: newMs });
    }
    console.log(JSON.stringify({ source: 'existing local Mystash indexed public documents', counts, results }));
  } finally {
    await fetch(`${node}/${targetPrefix}_*`, { method: 'DELETE' }).catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
