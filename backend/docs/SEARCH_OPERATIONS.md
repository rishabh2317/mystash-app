# Search V1 — local OpenSearch & operations

This note documents **implementation behavior** after the post-audit remediation. It does **not** change frozen decisions in `SEARCH_DOMAIN_SPEC.md`, `SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md`, or `SEARCH_TECHNOLOGY_SELECTION.md`.

## Start local OpenSearch

```bash
cd backend
docker compose -f docker-compose.search.yml up -d
# OpenSearch HTTP: http://127.0.0.1:9200
```

No vendor account required for local Docker.

## Index backend selection

| Mode | Behavior |
|------|----------|
| **Production** (`NODE_ENV=production` or `SEARCH_ENV=production`) | **OpenSearch required.** Missing `OPENSEARCH_URL` → **fail fast** (`SearchConfigurationError`). Never silent InMemory. |
| **Development** + `OPENSEARCH_URL` | OpenSearch |
| **Development** without URL | InMemory (zero-infra local) |
| `SEARCH_INDEX_BACKEND=memory` | InMemory — **forbidden in production** |
| `SEARCH_INDEX_BACKEND=opensearch` | OpenSearch — requires `OPENSEARCH_URL` |
| Unit tests | Inject `forceInMemory: true` or pass an `InMemorySearchIndex` |

Env vars:

- `OPENSEARCH_URL` (e.g. `http://127.0.0.1:9200`)
- `OPENSEARCH_USERNAME` / `OPENSEARCH_PASSWORD` (optional)
- `OPENSEARCH_INDEX_PREFIX` (default `mystash_search`)
- `EMBEDDING_PROVIDER=local|openai` (default `local`)
- `SEARCH_ENV` / `SEARCH_INDEX_BACKEND`

## Run tests

```bash
# Unit (InMemory + LocalEmbedding + mocked OpenAI) — default CI
npm test

# Integration against real OpenSearch (fails clearly if OS is down — no InMemory fallback)
OPENSEARCH_URL=http://127.0.0.1:9200 npm run test:search:integration

# Both
npm run test:all
```

## Index generations & aliases

Serving uses **aliases**, not permanent `*_current` physical indexes:

```text
mystash_search_collections  →  mystash_search_collections_vN
mystash_search_creators     →  mystash_search_creators_vN
mystash_search_products     →  mystash_search_products_vN
```

Lifecycle:

1. `createGeneration` / `beginRebuild` → new empty `vN+1`
2. Bulk index into physical generation
3. `promoteGeneration` / `switchAlias` → atomic alias cutover
4. Retain old generation briefly
5. `deleteGeneration` after safe period (refuses to delete serving generation)

## Embedding space

Each generation stores `_meta`: `embeddingModelId`, `embeddingVersion`, `embeddingDimension`, and `mappingVersion`.

Upserts with a mismatched space throw `EmbeddingSpaceMismatchError`.  
Changing model/version/dimension or the indexed field mapping requires a **complete new generation**. `ensureIndexes` refuses to switch an existing serving alias to an empty or incompatible generation.

## Rebuild Search

Operationally:

1. Point `EmbeddingPort` at the chosen model (after Mystash offline benchmark).
2. Pause Search index writers, drain or retain their pending events for replay, and verify the OpenSearch target, active aliases, and matching embedding configuration. Keep the API on the old generation during the copy.
3. Run `scripts/rebuildSearchMapping.ts --apply` with `SEARCH_WRITERS_PAUSED=1`. It creates a new physical generation per type, copies the serving public projections with the new indexed fields, checks source/target counts, then promotes aliases. It retains previous generations for containment. This is an explicit operator action; it is never run by API startup.
4. Resume writers against the matching backend code, replay events accumulated during the pause, verify Search and indexed updates, then consider deleting old generations after a safe period. The copy requires paused writers to avoid missing concurrent changes; count equality alone does not prove update parity.
5. For a changed embedding model, re-project and re-embed from Collection / Catalog / User sources instead of copying old vectors. The 500-row dev bootstrap below is not a complete production reindex.

### Dev bootstrap after DB reset (InMemory or empty OpenSearch)

Event-driven indexing only runs on **writes**. After wiping/recreating Postgres data, the active Search index can be empty even though SoT rows exist. With local **InMemorySearchIndex** (no `OPENSEARCH_URL`), the index is also empty on every backend process start.

Re-project from Postgres into the **running** Search process:

```bash
cd backend
# Optional: SEARCH_BOOTSTRAP_URL=http://127.0.0.1:8787
npm run search:bootstrap
```

This uses existing `POST /search/index/collection|creator|product` routes (same bridges as live writes). It does not create a second Search architecture.

## Event-driven indexing

Async (fire-and-forget) projections:

- **Collection** lifecycle routes → Collection SearchDocuments  
- **User** profile/username/creator/account changes → Creator docs + collection creator snapshot fan-out  
- **Catalog** create/update/verify/lifecycle/merge → Product docs (source removed on merge)  
- **Engagement** throttled `CounterUpdated` → nearline Collection ranking mirrors  

Write paths do not block on Search success.
