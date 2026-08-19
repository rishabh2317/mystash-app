# Mystash Search — Technology Selection (V1)

**Status:** Infrastructure selection — does **not** change domain architecture  
**Canonical architecture:** [`SEARCH_DOMAIN_SPEC.md`](./SEARCH_DOMAIN_SPEC.md)  
**V1 product freeze:** [`SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md`](./SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md)  
**Scope:** Freeze V1 search engine; define embedding abstraction and hosting/dev posture  
**Non-goals:** No code, migrations, APIs, FE, GPT/LLM search, ML LTR, Recs/Shopping coupling, domain redesign

---

## 0. Decision summary

| Decision | Status |
|----------|--------|
| **A. V1 search engine** | **OpenSearch — FROZEN.** Primary Search infrastructure for BM25-family lexical retrieval, vector/ANN, hybrid candidate generation, filters/facets, autocomplete, index storage, aliases/versioning, shards/replicas, search-time retrieval primitives. |
| **B. Search engine hosting** | **Deployment choice** — local Docker (dev), self-hosted, or managed equivalent. Not a Search domain dependency. **No vendor account required for local development.** AWS is optional, not required. |
| **C. Embedding abstraction** | **EmbeddingPort — FROZEN.** Provider/model-agnostic. Search domain must not know which implementation runs. |
| **D. Initial embedding candidate** | **OpenAI `text-embedding-3-small`** — **DEFAULT INITIAL CANDIDATE**, not permanently frozen. Final production model after Mystash-specific offline benchmark. |
| **E. Architecture split** | Supabase/Postgres = transactional/business **Source of Truth**. OpenSearch = disposable Search projection/index. Engine = hybrid **candidate generation**. Mystash Search service = deterministic intent, Collection-first ranking, blending, telemetry, caches. |
| **F. Why OpenSearch** | Best balance of hybrid quality, retrieval primitives, autocomplete, aliases/reindex, local + managed options, and Stage A→C headroom without Vespa-level ops burden. |
| **G. Do not build yet** | Separate vector DB, separate lexical engine, Postgres-as-primary-search, Vespa day-one, LLM/GPT search, ML LTR, online learning, live Shopping joins, Recs-as-Search-dependency. |
| **H. Outgrow path** | Stay on OpenSearch through Stage C; evaluate **Vespa** (or peers) at Stage D with real Mystash workload. Documents remain disposable → migration is a reindex. |

**Do NOT replace OpenSearch with:** Supabase/Postgres, pgvector as primary Search, a separate vector database, or a separate lexical engine.

**Historical runners-up (evaluation context only — not V1 alternatives to reopen):** Typesense, Meilisearch, Elasticsearch, Vespa (future), Postgres+pgvector (SoT only).

---

## 1. Required capabilities (evaluation frame)

Frozen V1 needs (from spec + plan):

| Area | Requirement |
|------|-------------|
| Lexical | BM25-family, field weighting, typo tolerance, prefix/autocomplete, synonyms, filters/facets |
| Semantic | Vector storage, ANN, hybrid lexical+vector, candidate/score combination |
| Ranking | Deterministic custom ranking; entity-type weights; Collection-first blend; freshness; engagement; Creator Authority; Catalog verification; optional personalization |
| Serving | Low latency, concurrency, horizontal scale, cursor pagination, cache-friendly, graceful degradation |
| Indexing | Async, bulk, incremental, deletes, rebuilds, aliases/versioned indexes, idempotent upserts |
| Ops | Observability, backup/recovery, reindex, schema evolution, manageable complexity, optional managed hosting |
| Constraints | No GPT/LLM query reasoning/rewrite/answer/rerank; no agents; no ML LTR; no online learning; Search independent of Recs & Shopping |

### Ranking ownership (normative)

```text
OpenSearch
  → retrieval infrastructure:
     lexical scoring, vector similarity, candidate fusion,
     filters/facets, autocomplete, optional function-score boosts

Mystash Search service
  → final product relevance semantics:
     Collection-first weighting, entity-type blending,
     diversification, intent-based lane weighting,
     business-signal combination, telemetry, degraded modes
```

**OpenSearch must not be the only source of ranking logic.**  
Engine primitives may assist scoring; Mystash-specific relevance remains controlled by the Search domain.

The engine must not become the business SoT. V1 prefers **engine hybrid recall + Search-service ranking** so Collection-first blending stays under domain control.

---

## 2. OpenSearch software vs hosting

| Layer | Meaning |
|-------|---------|
| **OpenSearch software** | Open-source / free to use. No software license fee for the engine itself. |
| **Running OpenSearch** | Still requires compute, memory, storage, network, backups, monitoring, replicas, and operational effort. |

### A. Local development

- Run OpenSearch **locally**, preferably via **Docker**.  
- **No OpenSearch vendor account required.**  
- No AWS (or other cloud) account required for local Search development.  
- Same Search architecture as production (documents → OpenSearch indexes → hybrid retrieval → Search-service ranking).

### B. Production

OpenSearch may be:

- **self-hosted**  
- **managed** (any equivalent infrastructure provider)  
- hosted by Mystash’s chosen infra partner  

Managed OpenSearch is an **operational/deployment choice**, not a Search domain dependency. **Do not require AWS specifically.**

**Implementation ops:** See [`SEARCH_OPERATIONS.md`](./SEARCH_OPERATIONS.md) for local Docker, production fail-fast (no silent InMemory), alias/`vN` generations, embedding-space rebuilds, and test commands.

### Recommended hosting progression

| Environment | Posture |
|-------------|---------|
| **Development** | Local Docker OpenSearch |
| **Early production** | Small managed **or** self-hosted OpenSearch, based on operational capacity |
| **Growth** | Managed / high-availability OpenSearch |
| **Large scale (Stage D)** | Evaluate OpenSearch vs Vespa using real Mystash workload |

---

## 3. Scale stages (comparison points, not forecasts)

| Stage | Collections | Products | Creators | Searches / month | Approx. searchable docs* |
|-------|-------------|----------|----------|------------------|---------------------------|
| **A** | 10k | 10k | 1k | 1M | ~21k |
| **B** | 1M | 1M | 100k | 50M | ~2.1M |
| **C** | 10M | 10M | 1M | 500M | ~21M |
| **D** | 100M+ | 100M+ | 10M+ | Billions | 200M+ |

\*Three entity document types; vectors add material storage vs text-only.

Infra cost ranges below are **order-of-magnitude planning aids**, not quotes.

---

## 4. Candidate technologies (evaluation record)

Evaluated before freezing OpenSearch:

1. OpenSearch ← **FROZEN V1**  
2. Elasticsearch  
3. Typesense  
4. Meilisearch  
5. Vespa  
6. PostgreSQL / Supabase (`tsvector` / FTS + `pgvector`)  

Also considered (not sole-engine peers): **Qdrant / Pinecone / Weaviate** — strong vectors, weaker sole lexical/autocomplete story; would force dual-system hybrid. **Rejected** as separate vector DB alongside OpenSearch for V1.

---

## 5. Hybrid search quality (critical)

“Has vectors” ≠ “good hybrid Search.”

| Capability | OpenSearch | Elasticsearch | Typesense | Meilisearch | Vespa | Postgres+pgvector |
|------------|------------|---------------|-----------|-------------|-------|-------------------|
| True BM25-family lexical | Strong | Strong | Strong (typo-first lexical) | Strong (typo-first) | Strong | Partial (FTS/`ts_rank`; not first-class BM25 without extensions) |
| Dense vector / ANN | kNN / HNSW | kNN / HNSW | HNSW | Vector + hybrid | HNSW tensors | HNSW/IVF via pgvector |
| Native hybrid query | Yes (`hybrid` + pipelines) | Yes (RRF retriever) | Yes (rank fusion + `alpha`) | Yes (`semanticRatio`) | Excellent (single-pass YQL + rank profiles) | DIY (app or SQL RRF) |
| Score normalization | min_max / arithmetic / geometric / etc. | Weighted / CC styles | Rank-fusion style | Internal blend | Rank expressions + RRF helpers | DIY |
| Rank fusion (RRF) | Yes (score-ranker / RRF) | Yes (first-class RRF) | Rank fusion (alpha-weighted ranks) | Proprietary blend | Yes / expressible | DIY |
| Filter before/after ANN | Strong | Strong | Good | Good | Excellent | Possible; careful with plans |
| Deterministic multi-signal rank | `function_score` / script (assist only) | Same family | Limited `sort_by` / eval | Limited custom ranking | Best-in-class rank language | SQL expressions (brittle at scale) |
| Collection-first blend across entity types | Multi-index + **Search-service** blend | Same | `multi_search` + app blend | Multi-index + app blend | Multi-schema / grouping possible | Multi-query + app blend |
| Autocomplete / prefix | Yes (completion / edge n-gram / search_as_you_type) | Yes | Excellent | Excellent | Possible; more DIY | Weak (trigram/`pg_trgm`) |

### Hybrid quality verdict

| Tier | Engines | Notes |
|------|---------|-------|
| **Best hybrid + in-engine ranking control** | Vespa | Ideal Stage C–D evaluation target; heavy V1 ops |
| **Frozen V1 hybrid pragmatism** | **OpenSearch** | Native hybrid + RRF/normalization + filters; Mystash Search owns final ranking |
| Peer-class (not chosen) | Elasticsearch | Similar capability; less favorable license/cost posture for Mystash |
| Good hybrid, lighter ranking DSL | Typesense, Meilisearch | Evaluation runners-up only |
| Hybrid DIY — not primary Search | Postgres+pgvector | SoT / debug / eval only |

---

## 6. Per-candidate evaluation (record)

### 6.1 OpenSearch — **FROZEN V1**

**Fit:** High — selected.

OpenSearch is the primary Search infrastructure for:

- BM25-family lexical retrieval  
- vector / ANN retrieval  
- hybrid candidate generation  
- filters / facets  
- autocomplete  
- index storage  
- aliases / versioning  
- shards / replicas  
- search-time retrieval primitives  

| Strength | Mystash relevance |
|----------|-------------------|
| BM25 + kNN + hybrid pipelines (normalization / RRF) | Matches frozen hybrid V1 |
| Optional `function_score` / scripts | Assistive boosts — **not** sole ranking SoT |
| Index aliases, reindex APIs | Zero-downtime schema / embedding versioning |
| Aggregations / filters | Facets without Shopping/Recs |
| Completion / prefix patterns | Autocomplete |
| Open-source software + local Docker | Free software; local dev without vendor account |
| Managed hosting optional | Ops choice, not domain dependency |
| Scales through Stage C with standard patterns | Headroom without Vespa day one |

| Weakness | Mitigation |
|----------|------------|
| Heavier than Typesense/Meili for tiny Stage A | Local Docker for dev; small self-hosted/managed for early prod |
| JVM / cluster ops in production | Managed option when ops capacity is low |
| Not as expressive as Vespa rank profiles | Final Collection-first blend owned by Search service |

**Production infra cost (order of magnitude, compute/storage only — not software license):**

| Stage | Rough monthly |
|-------|----------------|
| A | $0 local / lab; early prod often $50–300 for tiny managed or small VM |
| B | $400–2k |
| C | $3k–15k+ |
| D | Tens of k$+; revisit Vespa / multi-tier |

Open-source ≠ zero infrastructure cost (see §9).

---

### 6.2 Elasticsearch

**Fit:** High (near OpenSearch), **not selected.**

- Hybrid RRF is excellent.  
- License / commercial posture and typical managed cost are worse for Mystash than OpenSearch.  
- Feature delta does not justify switching from the frozen OpenSearch choice.

---

### 6.3 Typesense

**Fit:** Strong for Stage A–early B historically; **not V1** (OpenSearch frozen).

Excellent DX / typo / autocomplete / hybrid alpha; thinner multi-signal ranking DSL and weaker Stage C+ ops story than OpenSearch.

---

### 6.4 Meilisearch

**Fit:** Good early DX; **not V1.**

Hybrid via `semanticRatio`; clustering / custom multi-signal ranking historically weaker for Mystash’s Stage C ambitions.

---

### 6.5 Vespa

**Fit:** Best technical match for Stage C–D hybrid + ranking; **not day-one V1.**

Explicit **large-scale evaluation target** after OpenSearch is proven with real Mystash load.

---

### 6.6 PostgreSQL / Supabase (FTS + pgvector)

**Fit:** Transactional SoT — **must NOT** become the primary Search engine (including “because free tier”).

```text
Supabase / Postgres  →  transactional / business Source of Truth
OpenSearch           →  disposable Search projection / index
```

Mystash already uses Supabase for write domains. That helps **business data**, not Search serving.

| Allowed | Forbidden as primary Search |
|---------|-----------------------------|
| Business SoT for User / Collection / Catalog / Engagement | Primary BM25 + vector + hybrid serving |
| Optional projection / debug / offline evaluation store | Replacing OpenSearch to avoid infra cost |
| Temporary lexical-only experiments | Coupling Search QPS to transactional DB |

**Architectural reasons Search stays off the transactional DB:**

Search requires BM25-family retrieval, vector ANN, hybrid retrieval, autocomplete, typo handling, filtering/facets, high concurrent serving, and **independent scaling** from transactional writes. Putting that load on Supabase/Postgres would contend with Collection/Catalog/Engagement write paths and force a painful mid-growth migration.

**Free tier is not a reason to collapse this boundary.**

---

## 7. Weighted decision matrix (historical)

Weights reflect Mystash product reality (hybrid discovery, Collection-first, deterministic multi-signal rank, cost discipline), **not** vendor popularity.

| Criterion | Weight | OpenSearch | ES | Typesense | Meili | Vespa | PG+pgvector |
|-----------|--------|------------|----|-----------|-------|-------|-------------|
| Retrieval quality (lexical) | 10 | 9 | 9 | 8 | 8 | 9 | 5 |
| Hybrid search capability | 15 | 9 | 9 | 8 | 7 | 10 | 4 |
| Ranking flexibility | 12 | 8 | 8 | 5 | 5 | 10 | 5 |
| Vector capability | 10 | 8 | 8 | 7 | 7 | 9 | 7 |
| Autocomplete | 8 | 7 | 7 | 9 | 9 | 6 | 3 |
| Filtering / facets | 7 | 9 | 9 | 8 | 8 | 9 | 6 |
| Latency | 7 | 8 | 8 | 9 | 9 | 8 | 6 |
| Scalability (→C/D) | 8 | 8 | 8 | 5 | 4 | 10 | 3 |
| Operational complexity (lower burden → higher score) | 8 | 6 | 5 | 8 | 8 | 3 | 9 |
| Cost (A–C) | 6 | 7 | 5 | 8 | 8 | 4 | 9 |
| Developer experience | 4 | 6 | 6 | 9 | 9 | 4 | 7 |
| Managed availability | 3 | 8 | 9 | 8 | 7 | 6 | 9 |
| Vendor lock-in (lower lock → higher) | 3 | 8 | 5 | 6 | 7 | 7 | 9 |
| Migration difficulty later | 3 | 7 | 6 | 5 | 5 | 8 | 3 |
| Future multimodal readiness | 2 | 7 | 7 | 5 | 5 | 9 | 4 |
| **Weighted total (approx.)** | **100** | **~8.0** | **~7.6** | **~7.2** | **~6.9** | **~7.8** | **~5.4** |

**OpenSearch is frozen for V1.** This matrix records why; it does not reopen the engine choice.

---

## 8. Embedding model selection (separate from engine)

**Reminder:** Embedding model ≠ LLM. V1 forbids GPT/LLM query reasoning; embedding generation is allowed.

### 8.1 EmbeddingPort — FROZEN

All embedding access goes through a Search-owned **`EmbeddingPort`**.

```text
Hosted embedding API:
  Query/document → external embedding provider → vector

Self-hosted / local embedding:
  Query/document → local / open-source embedding model → vector
```

Both implement the same `EmbeddingPort`.  
**The Search domain must not know which implementation is used.**

Conceptual configuration (infrastructure only — not domain architecture):

```text
EMBEDDING_PROVIDER=local
# or
EMBEDDING_PROVIDER=openai
# or another hosted provider
```

Do not hard-code a provider into the domain model. Do not require a specific open-source model in the architecture. Model selection remains an **infrastructure** decision.

### 8.2 Options (candidates, not freezes)

| Option | Dims (typical) | Cost posture | Multilingual | Notes |
|--------|----------------|--------------|--------------|-------|
| OpenAI `text-embedding-3-small` | Provider default (often 1536; may support reduction) | Low hosted API cost | Good | **Initial V1 default candidate** |
| OpenAI `text-embedding-3-large` | Higher | Higher hosted cost | Good | Benchmark only if small underperforms |
| Voyage / Cohere-class APIs | Provider-dependent | Mid–premium hosted | Often strong | Required benchmark peer |
| Google embedding models | Provider-dependent | Competitive | Good | Optional peer |
| Open-source / self-hostable (e.g. BGE-M3, multilingual-E5, GTE class) | Model-dependent | Infra/GPU, no per-token API | Strong options | Required where practical for local/dev and scale path |

### 8.3 Initial default vs final production freeze

| Item | Status |
|------|--------|
| **Initial V1 embedding candidate / default** | OpenAI `text-embedding-3-small` via `EmbeddingPort` |
| **Final production embedding model** | **Not frozen** until Mystash-specific offline relevance benchmark completes |
| **EmbeddingPort** | **Frozen** |

Do **not** treat OpenAI `text-embedding-3-small` as permanently frozen.  
Do **not** choose a production model solely from generic public benchmark scores (MTEB leaderboards, etc.).

### 8.4 Mystash-specific offline benchmark (required before production freeze)

Benchmark **at minimum**:

1. OpenAI `text-embedding-3-small`  
2. One strong alternative **hosted** embedding provider (e.g. Voyage / Cohere class)  
3. One strong **open-source / self-hostable** model where practical  

Use realistic Mystash queries:

**Entity queries**

- `sony xm5`  
- `iphone 17 pro`  
- `tech hints`  
- `nike`  

**Discovery queries**

- `beach outfits`  
- `best travel gadgets`  
- `things to pack for ladakh`  
- `minimalist home office`  
- `gifts for girlfriend`  

Evaluate at least:

- Recall  
- Precision  
- MRR  
- NDCG  
- Semantic retrieval quality (esp. discovery queries alongside hybrid lexical)  
- Latency  
- Cost  
- Multilingual behavior where relevant  

Then freeze the production model + dimension + `embedding_version` for a serving index generation.

### 8.5 Embedding dimensionality

**Embedding dimensionality is a model/configuration decision — not an unconditional “prefer 1024” rule.**

Choose dimensionality based on:

- retrieval quality  
- storage  
- ANN performance  
- latency  
- provider/model support  

If a model supports dimension reduction / truncation, **benchmark the reduced dimension against the native/default dimension** before adopting it.  
**Do not reduce dimensions merely to save storage.**

**One embedding space per serving index generation.**

Documents must carry:

- `embedding_model_id`  
- `embedding_version`  
- `embedding_dimension`  

Do **not** mix incompatible embedding spaces in one serving index.

Additional rules:

- Do **not** embed via chat/completions / LLM models.  
- Do **not** use LLM rewrite before embedding in V1.

### 8.6 Embedding cost (illustrative, provider-dependent)

The table below assumes a **hosted OpenAI `text-embedding-3-small`-class** price posture for illustration only.

**These are provider-dependent estimates, not architectural commitments or quotes.**  
Embedding APIs are **not** required — local/self-hosted `EmbeddingPort` implementations may have $0 API cost and non-zero compute cost.

Assume ~200 tokens average per Collection doc text; Products/Creators shorter; query ~20 tokens.

| Stage | Corpus embed (one-time-ish)* | Query embeds / month* |
|-------|------------------------------|------------------------|
| A | << $1 (hosted) or local compute | ~$0.40 at 1M searches (hosted, before cache) |
| B | ~$10–40 (hosted) or local compute | ~$20 at 50M searches (hosted, before cache) |
| C | ~$100–400 (hosted) or local compute | ~$200 at 500M searches (hosted, before cache) |
| D | $1k–4k+ per full hosted re-embed **or** self-host economics | Dominated by QPS; cache / self-host often wins |

\*Hosted API illustration only.

**Cost mechanics:**

- Document embeddings are mostly **indexing-time** cost.  
- Unchanged documents must **never** be re-embedded.  
- Query embeddings are **per-query** unless cached.  
- Caching normalized query embeddings by `(normalized_query, embedding_model_id, embedding_version, embedding_dimension)` reduces cost and latency.  
- At larger scale, **self-hosting** may become economically attractive — still via the same `EmbeddingPort`.

---

## 9. Open source / free ≠ zero infrastructure cost

OpenSearch and open-source embedding models may have **zero software licensing / API cost**.

Production still incurs:

- compute  
- memory  
- storage  
- network  
- backups  
- monitoring  
- replicas  
- operational cost  

Optimize for low cost. **Do not** choose inferior infrastructure solely because a free tier exists (especially: do not make Supabase the Search engine for that reason).

---

## 10. Development and early V1 cost posture

The architecture must be **developable without paid managed Search infrastructure**.

### Recommended development setup

```text
Mystash Backend
+ Supabase / Postgres (e.g. free tier for SoT)
+ OpenSearch local Docker instance
+ EmbeddingPort
    ├── hosted provider implementation (optional)
    └── local / self-hosted implementation (required for zero paid-API local path)
```

| Goal | How |
|------|-----|
| No vendor lock-in | OpenSearch software + EmbeddingPort |
| No mandatory paid Search SaaS for development | Local Docker OpenSearch |
| No mandatory paid embedding API for development | `EMBEDDING_PROVIDER=local` (or equivalent) |
| Same architecture in dev and prod | Same documents, indexes, hybrid path, Search-service ranking |

Production may still use managed OpenSearch and/or a hosted embedding provider — as **deployment choices**, not domain redesigns.

---

## 11. Query embedding architecture

```text
Document path (async):
  Collection / Creator / Product SearchDocument text
    → EmbeddingPort.embedDocuments(batch)
    → store vector on document + ANN index in OpenSearch
    → idempotent on (id, content_revision, embedding_model_id, embedding_version)

Query path (sync, hot):
  raw query
    → normalize (deterministic)
    → EmbeddingPort.embedQuery(normalized)   [cacheable]
    → OpenSearch vector retrieval (ANN + filters)
    → parallel OpenSearch lexical retrieval
    → hybrid candidate union
    → Mystash deterministic ranking / blend
```

| Concern | V1 rule |
|---------|---------|
| **Latency** | Budget query embed p95 according to chosen implementation (hosted vs local); total search p95 is a Search SLO |
| **Caching** | Cache query embeddings by `(normalized_query, embedding_model_id, embedding_version, embedding_dimension)` |
| **Batching** | Document indexing always batched; query path usually single |
| **Failure** | If embedding implementation fails: **lexical-only** continue (see §14) |
| **Degraded mode** | Skip vector lane; mark telemetry `retrieval_mode=lexical_only` |
| **Cost** | Cache + normalize; never re-embed unchanged docs; APIs optional |
| **Versioning** | Documents carry `embedding_model_id`, `embedding_version`, `embedding_dimension`; one space per serving index |

---

## 12. Mystash data model mapping

Disposable projections only — **no** Collection/Catalog/User/Engagement SoT in OpenSearch.

### 12.1 Indexes (logical)

Prefer **separate indexes per entity type**:

| Index | Document |
|-------|----------|
| `collections_vN` | CollectionSearchDocument |
| `creators_vN` | CreatorSearchDocument |
| `products_vN` | CatalogProductSearchDocument |

Alias: `collections_current` → `collections_vN` (same for creators/products).

### 12.2 CollectionSearchDocument fields (engine view)

| Field group | Examples | Notes |
|-------------|----------|-------|
| Identity | `collection_id`, `slug` | Stable id = upsert key |
| Searchable text | `search_title`, `search_text`, `search_keywords`, brands/categories tokens, tagged product names, creator name snapshot | From Collection search source — no LLM enrichment |
| Vector | `embedding`, `embedding_model_id`, `embedding_version`, `embedding_dimension` | From EmbeddingPort |
| Ranking mirrors | `published_at`, `quality_score`, engagement counters, `creator_authority`, save/merchant rates | Nearline from Engagement/Collection |
| Creator snapshot | `creator_id`, `creator_display_name`, `creator_avatar_ref` | Async User refresh |
| Media | `primary_media_ref` | Reference only — CollectionMedia SoT |
| Commerce context | `product_tag_count`, optional denorm price | Never live Shopping call |
| Gates | `search_eligible`, visibility, tombstone/deleted | Soft-delete → remove from serving quickly |
| Revisions | `content_revision`, `indexed_at` | Idempotent indexing |

### 12.3 Creator / Product

- Creator: username, display name, bio tokens, authority, followers denorm, embedding metadata, public gates.  
- Product: name, brand, model, aliases, category, verification, popularity, survivor-after-merge id, embedding metadata, optional price denorm.

### 12.4 Catalog merges

- On merge: delete/redirect source product doc; upsert survivor; Collections reindex when Collection search-source recompile events arrive.  
- OpenSearch never owns merge truth.

### 12.5 Collection-first serving

OpenSearch returns typed candidate sets (multi-index / multi-search).  
**Mystash Search service:**

1. Applies intent-weighted lane budgets.  
2. Scores with deterministic formula (business signals).  
3. Diversifies creators.  
4. Assembles unified and/or typed lanes (FE-agnostic).  

---

## 13. Reindex / model versioning (V1 strategy)

| Change | Strategy |
|--------|----------|
| SearchDocument schema add field | Reindex to `*_vN+1`; alias swap; keep old index until soak |
| Ranking weight change | **No reindex** — config in Search service (preferred) |
| Embedding model / dimension / version change | New index gen; dual-write or backfill; alias swap; drop old |
| Partial reindex | By entity type or id set (e.g. creator snapshot fan-out) |
| Full rebuild | Ops job from write-domain rebuild / event replay |
| Zero downtime | Alias cutover only; never point clients at building index |
| Coexistence | Old + new indexes until quality/latency gates pass |

**V1 rule:** Every OpenSearch index generation is disposable. Rebuild from Collection/Catalog/User/Engagement projections without engine truth.

---

## 14. Failure modes

| Failure | Behavior |
|---------|----------|
| **Vector retrieval fails** | Continue **lexical-only**; telemetry flag |
| **Lexical retrieval fails** | If vector still up: **semantic-only** degraded (weaker for exact SKU/handle). If both down: structured error / empty; autocomplete from cache if available |
| **Embedding implementation fails (query)** | Skip vector lane (lexical-only). **Do not** call GPT as substitute |
| **Embedding implementation fails (indexing)** | Queue retries; keep prior embedding if content unchanged; mark `embedding_stale`; remain lexically searchable |
| **Search index stale** | Eventually consistent; never block Collection publish |
| **Engagement signals stale** | Rank with last indexed mirrors; Search stays up |
| **OpenSearch degraded** | Cache hot queries; shrink candidate window; disable expensive aggs; **never** call Shopping/Recs to compensate |

**Independence:** Search must not require Recommendations or Shopping to answer queries.

---

## 15. Recommended V1 architecture

```text
Write domains (events) — Supabase/Postgres SoT
  Collection / Catalog / User / Engagement (nearline)
        │
        ▼
Search Indexer (async, idempotent)
  → build SearchDocuments
  → EmbeddingPort.embedDocuments  (local OR hosted — config)
  → upsert OpenSearch indexes (collections/creators/products)
  → alias-aware generations

Query path
  Client
    → Search API (Mystash)
      → normalize + deterministic intent
      → parallel:
          OpenSearch lexical (per type)
          EmbeddingPort.embedQuery (cached) + OpenSearch kNN
      → hybrid union (engine RRF and/or app union)
      → Mystash Collection-first ranking + diversification
      → blend (unified and/or typed lanes)
      → telemetry + caches
```

### What Mystash Search service owns

- Document mapping from domain events  
- EmbeddingPort (+ cache, versioning metadata)  
- Deterministic intent  
- Final Collection-first blend / diversification / business-signal combination  
- Search telemetry (≠ Engagement)  
- Degraded modes  
- Optional Recs candidate API (**one-way** Search → Recs)

### What OpenSearch owns

- Inverted index + ANN structures  
- Lexical scoring, filters, aggs, prefix/completion  
- Hybrid candidate fusion primitives  
- Index storage / shards / replicas / aliases  

### What Supabase/Postgres owns

- Transactional business SoT  
- Optional debug / evaluation projection store — **not** primary Search  

---

## 16. What we should NOT build yet

- GPT / LLM query understanding, rewrite, answers, rerank, or agents  
- ML learning-to-rank / online learning  
- Postgres/Supabase as primary hybrid Search  
- Separate vector database  
- Separate lexical engine alongside OpenSearch  
- Vespa as day-one production dependency  
- In-engine ownership of Engagement/Catalog truth  
- OpenSearch DSL as the **only** ranking logic  
- Synchronous Shopping price fetches  
- Recommendations as a required Search candidate source  
- Frontend / Feed / Analytics warehouse work disguised as Search  
- Brand/Category independent result indexes as V1 serving lanes  
- Permanently freezing an embedding model without Mystash offline benchmark  

---

## 17. Migration path if Mystash outgrows OpenSearch

1. Keep SearchDocuments + EmbeddingPort contracts stable.  
2. Dual-index a subset into Vespa (or peer) behind a feature flag.  
3. Compare offline quality + p95 latency + cost at Stage C/D load.  
4. Cut traffic by intent or percentage.  
5. Decommission OpenSearch indexes when disposable rebuild proven.

Migration cost is **reindex + ranking parity**, not domain rewrite.

---

## 18. Final V1 technology decision checklist

| Item | Choice | Freeze status |
|------|--------|---------------|
| **Search engine** | OpenSearch | **FROZEN V1** |
| **Search engine hosting** | Local Docker / self-hosted / managed depending on environment | Deployment choice (not domain) |
| **Lexical engine** | OpenSearch | **FROZEN** (same engine) |
| **Vector DB** | **NONE separately** — vectors live in OpenSearch | **FROZEN** |
| **Hybrid** | OpenSearch BM25-family + vector candidate generation | **FROZEN** |
| **Final ranking** | Mystash Search service (Collection-first, intent, diversification, business signals) | **FROZEN** |
| **Embedding abstraction** | EmbeddingPort | **FROZEN** |
| **Initial embedding candidate** | OpenAI `text-embedding-3-small` | **DEFAULT INITIAL CANDIDATE** |
| **Final production embedding model** | Subject to Mystash-specific offline benchmark | **Not frozen yet** |
| **Embedding dimensions** | Model/config decision; benchmark reductions; store `embedding_dimension` | Per index generation |
| **LLM** | **NONE** | **FROZEN** |
| **Supabase/Postgres** | Business Source of Truth; optional debug/eval store; **not** primary Search | **FROZEN** |
| **Recs** | Optional one-way candidates from Search; not required for Search | Aligned with spec |
| **Shopping** | No live joins; optional Search-side price denorm only | Aligned with spec |
| **Stage D plan** | Evaluate OpenSearch vs Vespa on real Mystash workload | Future |

This selection **implements** the frozen Search architecture; it does **not** alter it.

---

*End of Search Technology Selection.*
