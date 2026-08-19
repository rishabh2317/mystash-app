# Search Domain — V1 Implementation Plan

**Spec:** [`SEARCH_DOMAIN_SPEC.md`](./SEARCH_DOMAIN_SPEC.md) (canonical architecture)  
**Status:** V1 plan revised with **frozen product decisions** — no code, no migrations, no APIs in this document  
**Stance:** Read-side consumer. Event-driven indexing. Hybrid lexical + embedding retrieval. Deterministic intent/ranking. Collection-first blended results (Collections + Creators + Products). Technology selection deferred.

---

## Spec decisions locked (V1)

| Topic | Frozen decision |
|-------|-----------------|
| Result types | **Collections** (primary) + **Creators** + **Catalog Products** only |
| Brand / Category | **Not** V1 result lanes; usable internally for lexical/semantic/ranking/filters/facets |
| Blend | **Blended Search is V1** — single query, no mandatory type picker |
| Retrieval | **Hybrid**: BM25-family lexical **+** embedding/vector semantic |
| Embeddings | Dedicated embedding model allowed; **≠ LLM** |
| LLM / GPT / agents | **Forbidden** in V1 (no query understanding, rewrite, answers, rerank) |
| Query intent | **Deterministic / rule-based** only; clean extension point for future learned intent |
| Ranking | Deterministic/configurable; **no** ML LTR, **no** LLM rank |
| Online learning | **Not V1** |
| Recs boundary | Search → optional candidates **to** Recs; Recs **not** required for Search; **no circular dependency** |
| Search CTR vs Engagement | Search owns search telemetry; Engagement owns behavioral facts; no duplication |
| Price | Search-side denorm projection only; **never** live Shopping join; omit filter if projection missing |
| Counter freshness | Nearline/batched Engagement → Search; **no** per-event reindex |
| Creator snapshot | Denorm into CollectionSearchDocument; async refresh on User events |
| Soft-delete | Remove from serving quickly; internal tombstone OK |
| Engine / embedding provider | **Deferred** — define capabilities only |
| FE | No FE build; backend contract must support cards **and** future reels-style Collection discovery |

---

## Architecture (V1)

```text
Write domains (events)
  Collection / Media(via Collection) / Tags(recompile) / Catalog / User / Engagement
        ↓ async, idempotent
Search Documents (Collection · Creator · CatalogProduct)
        ↓
Lexical index  +  Vector index (embeddings)
        ↓
Query → normalize → deterministic intent → hybrid retrieval (union)
        ↓
Deterministic ranking → diversification → blend (unified and/or typed lanes)
        ↓
Result assembly + autocomplete + telemetry
```

**V1 query path (normative):**

```text
Query
  → Lexical / BM25-family retrieval
  + Embedding / vector retrieval
  → Hybrid candidate union
  → Deterministic ranking
  → Diversification
  → Blended results (Collections · Creators · Products)
```

---

## V1 result types & blending

### Result types (serving)

| Type | Role |
|------|------|
| **Collection** | PRIMARY / default discovery object |
| **Creator** | People / handles |
| **Catalog Product** | Exact / commerce product hits |

Brand and Category are **not** independent V1 result types. They may still power internal retrieval, expansion, ranking, and facets.

### Blended Search (required in V1)

Do **not** ship Collection-only Search. One query returns a blended set. Intent-aware entity prominence examples:

| Query pattern | Dominant lane | Follow-on |
|---------------|---------------|-----------|
| `sony xm5` | Products | Collections, Creators |
| `tech hints` | Creator | Collections |
| `beach outfits` | Collections | Products, Creators |
| `best travel gadgets` | Collections | Products |

Clients must **not** be required to pre-select Products / Creators / Collections.

### Blend / ranking modes (read contract)

Underlying: entity-aware scores + Collection primary weight default.

API/read contract supports:

- **A)** unified mixed ranking  
- **B)** typed sections/lanes  

FE chooses presentation; backend must not hard-code card vs reels layout.

### Collection result contract (FE-agnostic)

Collection hits must be able to render as today’s cards **or** a future vertical/reels-style feed. Conceptual payload includes:

- `collectionId`
- `title`
- primary **media reference** (CollectionMedia remains SoT — Search does not own media)
- creator snapshot / reference (id, display name, avatar)
- product count
- relevant engagement summary (denorm mirrors)
- ranking/relevance context where appropriate

Same Search result → multiple FE presentations.

---

## Retrieval vs ranking

| Stage | V1 rule |
|-------|---------|
| **Retrieval** | High recall; lexical + semantic candidate generation; cheap/fast; produces candidate sets |
| **Ranking** | High precision; deterministic combo of relevance + business signals; **only** on retrieved candidates |

No ML ranker. No LLM ranking.

---

## Embeddings without LLM search

| Allowed | Forbidden |
|---------|-----------|
| Dedicated **embedding model** for docs + queries | GPT / ChatGPT |
| Collection / Creator / Product embeddings | LLM query understanding / rewriting |
| Query embeddings | LLM answers / agents |
| Vector similarity retrieval | LLM reranking |

**Embedding model ≠ LLM.** Do not select a specific embedding provider/model in this plan — infrastructure decision after architecture freeze + benchmarks.

---

## Deterministic query intent (no AI)

V1 intent is rule-based:

- exact entity matching  
- Catalog product names/aliases  
- creator username/display name matching  
- known brand/category **metadata** (internal; not result types)  
- curated synonyms  
- token/pattern rules  
- query characteristics  

**Minimum intents:** `EXACT_PRODUCT` · `CREATOR` · `DISCOVERY` · `CATEGORY/CONCEPT`  

**Optional deterministic:** `COMMERCE` · `COMPARISON` · `TRENDING`

Intent influences retrieval lanes, entity-type weights, ranking, and blending.

**Extension point:** leave a clean seam for a future learned/semantic intent classifier **without** API/domain redesign. V1 must not call any LLM.

### Natural / discovery queries

Must work without LLM understanding, e.g.:

- “beach outfits”  
- “best travel gadgets”  
- “things to pack for ladakh”  
- “minimalist home office”  
- “gifts for girlfriend”  

CollectionSearchDocument searchable content comes from existing Collection SoT inputs (where available):

- `search_title`, `search_text`, `search_keywords`, `search_brands`, `search_categories`  
- creator metadata (snapshot)  
- tagged product names  
- catalog brand/category  
- curated taxonomy/synonyms  
- media metadata already projected through Collection  

**Do not** invent AI-generated descriptions or a Search-only AI enrichment pipeline. Semantic retrieval **complements** lexical retrieval.

---

## Architectural corrections (mandatory)

### A. Search ↔ Recommendations

```text
Search ──optional candidate retrieval──► Recommendations
```

- Recommendations owns models, candidate generation, rec ranking, personalization.  
- Recommendations is **not** a required candidate source for normal Search.  
- Search works **independently** of Recommendations.  
- **Forbidden:** runtime `Search ↔ Recommendations` circular dependency.

### B. Search CTR vs Engagement

| Owner | Owns |
|-------|------|
| **Search** | query issued, search impression, search result click, Search CTR, abandonment, reformulation, autocomplete interaction, latency |
| **Engagement** | Collection view/open/save, Creator follow, Product click, Merchant click |

A search result click **may lead to** an Engagement fact when the user opens/interacts with the object. Search CTR must **not** become an Engagement fact. Do not duplicate Engagement as Search SoT. Prefer client-side Engagement ingest over Search server inventing behavioral facts.

### C. Price / Shopping

- Search must **never** synchronously call Shopping/merchant systems during serving for price.  
- If price filter exists: Commerce/Catalog → **denormalized Search-side price projection** → filter.  
- If no reliable projection in V1: **no price filter**.

---

## Ranking signals (consume, don’t own)

Search **orchestrates**; peers remain SoT:

| Signal | Source SoT |
|--------|------------|
| Lexical relevance | SearchDocument text |
| Semantic similarity | Embedding similarity |
| Query intent | Deterministic intent stage |
| Entity type / blend weights | Search ranking config |
| Freshness | Collection / Catalog timestamps |
| Collection quality | Collection |
| Catalog verification | Catalog |
| Popularity / save rate / merchant clicks | Engagement |
| Creator Authority | Engagement |
| Product popularity | Engagement |
| Personalization (follow/save/recent) | User + Engagement |
| Price (optional filter only) | Search-side denorm projection |

---

## Counter freshness

```text
Engagement facts → Engagement aggregation → nearline/batched ranking projection → Search docs
```

- Do **not** reindex Search on every individual engagement event.  
- Slightly stale engagement signals are acceptable.  
- Prefer low write amplification and high serving performance.

---

## Creator snapshots

- Denormalize creator snapshot into **CollectionSearchDocument**.  
- Do **not** synchronously join User on every search request.  
- On public creator change: User event → async Search projection refresh.  
- Creator remains owned by **User**.

---

## Zero-result fallback (V1 order)

1. Normalization  
2. Deterministic spelling correction  
3. Curated synonym expansion  
4. Broader lexical retrieval  
5. Semantic retrieval  
6. Related / popular suggestions  

Do not fabricate results. Do not use an LLM to generate fallback queries.

---

## Autocomplete (V1)

Support:

- Products, Creators, Collections  
- Recent searches  
- Popular/trending queries where data exists  

Means: prefix/lexical matching, popularity, recency, caching.  
**No** LLM autocomplete. **No** AI-generated suggestions.

Per-user recent searches: short retention, explicit privacy/deletion policy, strict user isolation.

---

## Filters (deliberately limited)

Potential V1 filters:

- Creator  
- Brand  
- Category  
- Verified Product  
- Recently Published  
- Popular  

Price **only** if Search-side denormalized price projection exists. Prefer index-time / precomputed facets; keep facet set small.

---

## Multi-language

- Language-aware indexing/analysis where the engine supports it.  
- Do not assume one analyzer for every language.  
- Permit per-locale analysis later.  
- Avoid multiple independent indexes in V1 unless the chosen engine requires it.

---

## Soft delete / visibility

When Collection / User / Product becomes non-searchable:

- Remove from **serving** as quickly as practical.  
- Internal tombstone may remain for event propagation, idempotency, rebuild safety.  
- Never serve private / deleted / ineligible entities.

---

## Catalog merges

When Catalog merges:

- Stale product SearchDocument resolves/removes appropriately.  
- Survivor product is indexed.  
- Affected CollectionSearchDocuments refresh when Collection search-source / tag projections change.  
- Search does **not** own Catalog merge truth.

---

## Search telemetry & quality (V1)

Metrics:

- zero-result rate  
- Search CTR  
- successful search rate  
- abandonment  
- reformulation  
- latency p50 / p95 / p99  
- Precision, Recall, MRR, NDCG  

Evaluation-set architecture so quality can improve from real queries.  
**No** online learning. **No** ML learning-to-rank. Telemetry structured for future ML consumers outside Search serving.

---

## Caching (conceptual)

- Hot anonymous queries  
- Autocomplete  
- Query embeddings where useful  
- Search results where safe  
- Document hydration where useful  

Personalized caches: user-isolated, short-lived. Cache is never Search SoT.

---

## Event-driven indexing

Async consumers of (at least):

- Collection (+ search-source recompile)  
- CollectionMedia metadata projected **through** Collection  
- CollectionProductTag / tag rematch via Collection recompile  
- Catalog (verify, merge, lifecycle)  
- User (public profile)  
- Engagement (batched aggregates / nearline projections only)

Requirements: asynchronous, idempotent, retryable, rebuildable, eventually consistent.  
No foundational write request synchronously writes Search indexes.

---

## Engine selection (deferred)

Do **not** select Elasticsearch, OpenSearch, Typesense, Meilisearch, Vespa, Solr, PostgreSQL FTS, a specific vector DB, or embedding provider in this plan.

**Required capabilities:**

- BM25-family lexical retrieval  
- Vector similarity retrieval  
- Hybrid retrieval  
- Prefix / autocomplete  
- Filters / facets  
- Field weighting  
- Ranking fields  
- High concurrency, low latency, horizontal scale  
- Rebuildability, cost efficiency  

Select after architecture freeze + Mystash workload benchmarks.

---

## Frontend boundary

No FE implementation in this plan.

Backend read contract must support:

- Collection / Creator / Product result cards  
- Typed sections **and** unified results  
- Pagination / cursors  
- Primary Collection media **reference** (not owned media)  
- Future vertical/reels-style Collection discovery without Search redesign  

---

## Implementation phasing (V1)

| Phase | Work |
|-------|------|
| **1** | Search domain module + contracts + document model (Collection / Creator / Product) |
| **2** | Collection SearchDocuments + event indexing |
| **3** | Creator SearchDocuments + indexing |
| **4** | Catalog Product SearchDocuments + indexing |
| **5** | Lexical retrieval |
| **6** | Embedding generation + vector retrieval |
| **7** | Hybrid candidate generation (union) |
| **8** | Deterministic query normalization / intent / synonyms |
| **9** | Deterministic ranking (entity-aware weights) |
| **10** | Collection-first blended result assembly (unified + typed lanes) |
| **11** | Autocomplete |
| **12** | Search telemetry + quality evaluation sets |
| **13** | Caching + degraded modes + operational hardening |

**Explicitly out of this plan’s build scope:** Frontend, Feed, Recommendations, Analytics, ML ranking, LLM features, online learning.

---

## Frozen answers to SEARCH_DOMAIN_SPEC §21 open questions

| # | Spec open question | **Frozen V1 decision** |
|---|--------------------|------------------------|
| 1 | V1 entity scope | Collections + Creators + Products; **Collection is primary** |
| 2 | Blend strategy | Unified ranking underneath; typed sections/lanes available to clients; Collection prominence |
| 3 | Counter freshness | Nearline/batched engagement projections; no per-event Search reindex |
| 4 | Creator snapshot fan-out | Denorm into CollectionSearchDocument; async refresh on User changes |
| 5 | Price filters | Search-side denorm only; never live Shopping; omit if projection unavailable |
| 6 | Semantic timeline | **Semantic/vector is V1**; dedicated embedding model; no LLM/GPT search reasoning |
| 7 | Recs candidate API | Search may supply candidates **to** Recs; Recs does **not** supply required candidates to Search; no cycle |
| 8 | Zero-result fallback | Normalize → spell → synonym → broader lexical → semantic → related/popular |
| 9 | Search click → Engagement | Search telemetry vs Engagement facts separated; search click may **lead to** Engagement; no Search-server duplication of Engagement SoT |
| 10 | Multi-language | Language-aware analysis where supported; avoid unnecessary per-language infra in V1 |
| 11 | Soft-delete retention | Remove from serving quickly; tombstone internally when useful |
| 12 | Autocomplete PII | Short retention, privacy/deletion policy, strict user isolation |
| 13 | Facet compute | Prefer index-time/precomputed facets; small V1 facet set |
| 14 | Engine selection | Deferred until freeze + workload benchmark |
| 15 | Online learning | Not V1; telemetry/eval hooks only |

---

## Explicit non-goals (V1 build)

- GPT / LLM / agents for query, rewrite, answer, or rank  
- ML learning-to-rank / online learning  
- Brand or Category as independent result types  
- Collection-only Search  
- Synchronous Shopping price joins  
- Search ↔ Recommendations circular runtime dependency  
- Feed / Recommendations / Analytics / FE implementation  
- Owning CollectionMedia, Catalog, Engagement, or User truth  

---

## V1 success shape (checklist)

Ship:

- BM25 lexical retrieval  
- Embedding/vector semantic retrieval  
- Deterministic query intent  
- Deterministic ranking  
- Collection-first blended results  
- Creator + Product results  
- Event-driven indexing  
- Autocomplete  
- Search telemetry  

Without: GPT/LLM, ML LTR, online learning, live Shopping, Recs circularity.

Remain future-ready for: better semantic retrieval, ML ranking, personalization, multimodal, session-aware, conversational search — **none required for V1**.

---

## SPEC ALIGNMENT STATUS

Canonical [`SEARCH_DOMAIN_SPEC.md`](./SEARCH_DOMAIN_SPEC.md) has been revised to match this plan’s frozen V1 decisions (result types, hybrid retrieval, blended Search, Recs one-way boundary, telemetry vs Engagement, price/Shopping, creator snapshots, open questions resolved, Collection-only / Future-semantic contradictions removed).

**Before implementation:** re-read both documents once; if any new drift appears, fix the **spec** (or explicitly amend this plan) before coding.

---

*End of Search V1 Implementation Plan (revised).*
