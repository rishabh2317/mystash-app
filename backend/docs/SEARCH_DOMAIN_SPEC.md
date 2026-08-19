# Mystash Search Domain Specification

**Status:** Canonical domain specification — **V1 product decisions frozen** per [`SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md`](./SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md) (no SQL, no Prisma, no APIs, no code, no migrations)  
**Audience:** Platform architecture for discovery, retrieval, and ranking (5–10 year horizon)  
**Principle:** Search is a **read-side consumer domain**. It owns discovery, retrieval, ranking orchestration, autocomplete, and search telemetry. It owns **no** business entities. Indexes and SearchDocuments are **disposable projections**.  
**Depends on (consume only):** [`USER_DOMAIN_SPEC.md`](./USER_DOMAIN_SPEC.md), [`COLLECTION_DOMAIN_SPEC.md`](./COLLECTION_DOMAIN_SPEC.md), [`COLLECTION_MEDIA_DOMAIN_SPEC.md`](./COLLECTION_MEDIA_DOMAIN_SPEC.md), [`COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md`](./COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md), [`CATALOG_DOMAIN_SPEC.md`](./CATALOG_DOMAIN_SPEC.md), [`ENGAGEMENT_DOMAIN_SPEC.md`](./ENGAGEMENT_DOMAIN_SPEC.md)  
**Peers (also consume Search; never write Search SoT):** Feed, Recommendations, Analytics (may mirror search telemetry), Notifications  
**V1 product freeze:** [`SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md`](./SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md) is the authoritative V1 decision layer for result types, hybrid retrieval, intent, blending, and non-goals.

**Technology stance (normative):** This specification is **technology-agnostic**. It does **not** assume Elasticsearch, OpenSearch, Typesense, Meilisearch, PostgreSQL FTS, Vespa, Solr, any vector database, or any specific embedding provider/model. Engine and embedding-model selection happen **only after** this architecture is frozen and Mystash workloads are benchmarked.

---

## 0. Definition

**Search** answers:

> “Given a query (and optional user context), which **Collections**, **Creators**, and **Catalog Products** should we retrieve, rank, blend, and return — with high relevance and low latency?”

```text
Search (bounded context — read side)
  ├── SearchDocument (*)           denormalized projections (Collection · Creator · Product)
  ├── SearchIndex (*)              disposable lexical + vector indexes (hybrid in V1)
  ├── Query Understanding          normalize, spell, synonyms, deterministic intent, entities
  ├── Retrieval                    hybrid candidate generation (lexical + embedding)
  ├── Ranking Pipeline             deterministic precision over candidates (signals consumed)
  ├── Autocomplete                 suggestions index + serving
  ├── Synonym / Spell lexicons     Search-owned linguistic assets
  ├── Search Cache                 hot query / autocomplete / personalized TTL
  ├── Result Assembly              blended results (unified and/or typed lanes)
  └── Search Telemetry             queries, CTR, zero-result, latency (≠ Engagement)
```

**Analogues (inspiration, not clones)**

| Platform | Mystash analogue |
|----------|------------------|
| Amazon product + brand + store search | Catalog Product + Creator + Collection (brand as signal/facet) |
| Pinterest visual + text discovery | Collection-first commerce discovery |
| Spotify search (tracks, artists, playlists) | Products, Creators, Collections |
| YouTube / TikTok search | Creator + content package discovery |
| Airbnb search | Faceted discovery + ranking over denorm docs |

### What it is not

| Not this | Owning context |
|----------|----------------|
| Collection content / publish / search source compile | **Collection** |
| CollectionMedia binaries / media SoT | **CollectionMedia** |
| Catalog identity / verification / merge | **Catalog** |
| Interaction facts / follow / save edges | **Engagement** |
| Feed timeline generation | **Feed** |
| Recs models / embeddings as SoT / required Search recall | **Recommendations** |
| Shopping destination / affiliate / live price | **Shopping** |
| BI warehouse | **Analytics** |
| Notification delivery | **Notifications** |
| User profile / account | **User** |
| GPT / LLM query reasoning or answers | **Out of Search V1** (forbidden) |

### Scale assumptions

- Hundreds of millions of Collections  
- Tens of millions of Creators  
- Hundreds of millions of Catalog products  
- Billions of searches  
- Thousands of concurrent queriers  
- Low latency, high relevance, horizontal scale, cost discipline  
- Future personalization, ML ranking, multimodal retrieval **without redesign**

### Specification phases

| Layer | Role |
|-------|------|
| **Canonical Domain Model** | This document (aligned with V1 freeze) |
| **V1** | **Blended** Collections (primary) + Creators + Catalog Products; **hybrid** BM25-family lexical **+** embedding/vector retrieval; deterministic intent & ranking; event-driven indexing; autocomplete; Search telemetry; no LLM/GPT/agents; no ML LTR; no online learning |
| **Future** | Stronger semantic/multimodal retrieval; ML ranking / experiments; richer personalization; Session-aware / conversational search; Brand/Category as optional **result** lanes if product requires; learned intent classifiers |

---

## 1. Aggregate ownership

### 1.1 What Search owns

| Responsibility | Meaning |
|----------------|---------|
| **Search Documents** | Denormalized read models per searchable entity |
| **Search Indexes** | Disposable lexical and vector structures derived from documents |
| **Retrieval** | Hybrid candidate generation (maximize recall, cheap/fast) |
| **Query Understanding** | Normalize, spell, synonyms, **deterministic** intent, entity recognition |
| **Ranking Pipeline** | Orchestrate **deterministic** ranking over candidates using **consumed** signals |
| **Autocomplete** | Suggestion documents + serving |
| **Synonyms / Spell Correction / Query Expansion** | Linguistic assets and deterministic rewrite stages |
| **Search Telemetry** | Query logs, zero-result, latency, search CTR, abandonment |
| **Search Caches** | Hot query, autocomplete, personalized result caches + invalidation |
| **Result Assembly** | Blended results for client surfaces (layout-agnostic) |
| **Search Quality Evaluation** | Offline/online quality metrics ownership (architecture) |
| **Search Experiments (reserved)** | A/B hooks for ranking / features — not V1 required |
| **Optional Recs candidate API** | One-way: Search may supply candidates **to** Recommendations |

### 1.2 What Search must NEVER own

| Must not own | Owner |
|--------------|-------|
| Users / creator profiles / account status | **User** |
| Collections / tags / media / search source fields | **Collection** (+ Media / Tag) |
| Catalog identity / aliases / verification | **Catalog** |
| Engagement facts / edges / affinities | **Engagement** |
| Shopping destinations / clicks / live price as SoT | **Shopping** / **Engagement** |
| Recommendation models / required Search recall | **Recommendations** |
| Feed ranking / timelines | **Feed** |
| Analytics warehouse SoT | **Analytics** |
| Notifications | **Notifications** |
| Business truth of counters / authority | **Engagement** (Search **consumes**) |
| Media binaries | **CollectionMedia** |

### 1.3 Boundary map

```text
User / Collection / Catalog / Tag / Media / Engagement
                    │ domain events + denorm snapshots
                    ▼
┌──────────────────────────────────────────────────────────┐
│                     SEARCH DOMAIN                         │
│  documents · lexical+vector indexes · query · rank       │
│  blend · autocomplete · telemetry · cache                 │
└────────────┬───────────────────┬─────────────────────────┘
             │ serves            │ optional candidates (one-way)
             ▼                   ▼
        Discover / Home     Recommendations
        blended Collection/Creator/Product search
```

**Normative:**

- Write domains remain SoT. Search projections are eventually consistent and **rebuildable**.  
- **Recommendations must NOT** be a required candidate source for normal Search.  
- **No** `Search ↔ Recommendations` runtime circular dependency.  
- Search works **independently** of Recommendations.

---

## 2. Searchable entities

| Entity | Why it exists | Primary write-domain source | V1 serving |
|--------|---------------|----------------------------|------------|
| **Collection** | Core Mystash discovery unit (creator recommendation package) | Collection (+ Media refs via Collection, Tag rollups, search source fields) | **PRIMARY result type** |
| **Creator** | Find people to follow; brand-of-one discovery | User (public profile) + Engagement authority signals | **Result type** |
| **Catalog Product** | Exact product / commerce intent queries | Catalog (+ Tag co-occurrence context optional) | **Result type** |
| **Brand** | Facet, expansion, ranking, relevance | Catalog brand + Collection `search_brands` | **Internal only in V1** — not an independent result type |
| **Category** | Facet, expansion, ranking, relevance | Catalog category + Collection `search_categories` / intent | **Internal only in V1** — not an independent result type |
| **Topic** (future) | Editorial / intent themes | Collection intent + keywords | Future |
| **Merchant Brand** (future) | Retailer-led discovery | Shopping / Catalog merchant fields | Future |
| **Hashtag** (future) | Social/editorial tags | Collection keywords / future taxonomy | Future |

**V1 normative:** Index and return **Collections, Creators, and Catalog Products**. Collection is the default/dominant discovery object. Brand/Category data may power lexical/semantic retrieval, query expansion, ranking, and facets — but must **not** appear as peer V1 result lanes.

---

## 3. Search read models

Search owns **denormalized SearchDocuments only**. They are disposable projections built from write-domain events and denorm fields. **Never** canonical data.

### 3.1 CollectionSearchDocument (conceptual)

| Concern | Examples (conceptual fields) |
|---------|------------------------------|
| **Identity** | `collection_id`, `slug` |
| **Searchable** | From Collection `search_title`, `search_text`, `search_keywords`, `search_brands`, `search_categories`; intent labels; tagged product names; creator display name snapshot |
| **Ranking** | Freshness (`published_at`), quality_score, engagement counter mirrors (nearline), creator_authority (consumed), save_rate / merchant-click hints (consumed), semantic embedding |
| **Visibility** | `search_eligible`, visibility, moderation clear, deleted tombstone |
| **Freshness** | `content_revision`, `search_source_updated_at`, indexed_at |
| **Denorm metadata** | **Creator snapshot** (id, display name, avatar) — async refresh from User events; primary product name; **primary media reference** (CollectionMedia remains SoT); product_tag_count; engagement summary mirrors |

**FE-agnostic:** The same Collection hit must support normal search cards **and** a future vertical/reels-style Collection discovery feed. Search does **not** own media and is **not** coupled to a specific FE layout.

### 3.2 CreatorSearchDocument

| Concern | Examples |
|---------|----------|
| Identity | `user_id` / creator id, username |
| Searchable | display name, username, bio tokens |
| Ranking | followers_count (denorm), Creator Authority (Engagement), activity freshness, embedding |
| Visibility | account/creator status gates; public profile only |
| Denorm | photo, locale hints |

### 3.3 CatalogProductSearchDocument

| Concern | Examples |
|---------|----------|
| Identity | `catalog_product_id`, `canonical_slug` |
| Searchable | name, brand, model, category, aliases (from Catalog) |
| Ranking | verification status, popularity (Engagement), last_verified_at, embedding |
| Visibility | Catalog `ACTIVE` (+ not HIDDEN/MERGED; resolve survivor) |
| Denorm | primary image, brand, category; optional Search-side **price projection** (never live Shopping) |

### 3.4 Brand / Category projections (internal / facets)

Brand and Category may exist as **internal** documents or facet aggregations for expansion, filters, and ranking. They are **not** V1 independent result types. Future product may promote them to result lanes without redesigning Collection/Creator/Product docs.

### 3.5 Rules

1. Documents are **rebuildable** from write domains.  
2. Prefer Collection **search source fields** over scraping caption/OCR in Search.  
3. Do **not** invent AI-generated descriptions or a Search-only LLM enrichment pipeline.  
4. Engagement/Catalog signals enter as **ranking fields**, not as Search-owned truth.  
5. MERGED Catalog products resolve to survivor before document upsert.  
6. **Creator snapshots** are denormalized into CollectionSearchDocument; refresh asynchronously on User public-profile events — **never** synchronously join User on every search request.  
7. **Counter freshness:** nearline/batched Engagement projections only — **no** per-event Search reindex.  
8. **Embedding model ≠ LLM.** Dedicated embedding models may generate document/query vectors; GPT/LLM reasoning is forbidden in V1.

---

## 4. Indexing pipeline

```text
Write domains emit events
        ↓
Search consumers (async)
        ↓
Upsert / delete SearchDocuments (+ embeddings where configured)
        ↓
Refresh / rebuild lexical and vector indexes (engine-specific later)
        ↓
Invalidate affected caches
```

### 4.1 Principles

- **No synchronous writes** from Collection/Catalog/User/Engagement/Shopping request paths into Search.  
- **Eventual consistency** is expected; clients tolerate brief lag after publish.  
- Indexing is **idempotent** on `(document_type, id, content_revision)` or equivalent.  
- Deletes / unpublish / hide → remove from **serving** quickly; internal tombstone OK for propagation/rebuild.  
- Catalog merge → delete/resolve source doc; refresh survivor; reindex referencing Collections when search source recompiles.  
- Never serve private / deleted / ineligible entities.

### 4.2 Consistency model

| State | Meaning |
|-------|---------|
| Published Collection | Becomes searchable after async index catch-up |
| Edited Collection | `content_revision` bump → reindex |
| Soft-deleted / ineligible | Dropped from serving (tombstone optional internally) |
| Counter / authority updates | Nearline/batched only; slightly stale OK |

---

## 5. Query pipeline

Complete conceptual pipeline. **Architecture only — no algorithms.**

```text
1. Normalize              (case, unicode, trim, tokenize policy)
2. Spell correction       (deterministic)
3. Synonyms / expansion   (curated / deterministic rewrite)
4. Intent detection       (deterministic / rule-based — no LLM)
5. Entity recognition     (product/creator/brand/category metadata matching)
6. Filters                (from query + UI facets)
7. Candidate retrieval    (hybrid: lexical + vector → union)
8. Ranking                (deterministic; consumed signals)
9. Personalization        (optional re-rank from User+Engagement context)
10. Diversification       (creator domination / product duplication control)
11. Final assembly        (blended unified and/or typed lanes)
12. Telemetry             (log query, latency, result ids)
```

**V1 normative:** Intent and ranking are **deterministic**. Clean extension points may exist for future learned intent / ML ranking **without** requiring API or domain redesign. V1 must not call GPT/LLM/agents.

### 5.1 Zero-result fallback (frozen)

1. Normalization  
2. Deterministic spelling correction  
3. Curated synonym expansion  
4. Broader lexical retrieval  
5. Semantic / vector retrieval  
6. Related / popular suggestions  

Do not fabricate results. Do not use an LLM to generate fallback queries.

---

## 6. Retrieval vs ranking

| | **Retrieval** | **Ranking** |
|--|---------------|-------------|
| Goal | Maximize **recall** | Maximize **precision** |
| Cost | Fast, inexpensive | Heavier; fewer items |
| Input | Query (+ filters) | Retrieved candidates + signals |
| Output | Candidate set(s) | Ordered results |
| Owns | Hybrid candidate generation | Deterministic scoring orchestration |

**Normative:** Do not mix. Retrieval must not become a full ML ranker. Ranking must not scan the entire corpus. **No** ML learning-to-rank and **no** LLM ranking in V1.

---

## 7. Candidate generation

### 7.1 V1 retrieval sources (normative)

```text
Query
  → Lexical / BM25-family retrieval
  + Embedding / vector retrieval
  → Hybrid candidate union
  → Ranking
  → Diversification
  → Blended results
```

| Source | Produces candidates for | Phase |
|--------|-------------------------|-------|
| Collection lexical index | Collection results | **V1** |
| Creator lexical index | Creator results | **V1** |
| Catalog product lexical index | Product results | **V1** |
| Collection / Creator / Product **vector** indexes | Semantic recall | **V1** |
| Brand / Category metadata (internal) | Expansion, filters, facets — **not** result lanes | **V1 internal** |
| Engagement graph (follow/save) | Personalized boost pools (not SoT) | V1 optional |
| Multimodal indexes | Image/video-aware recall | **Future** |

### 7.2 Recommendations

- Search may expose an **optional** candidate-retrieval API **to** Recommendations.  
- Recommendations **must not** supply required candidates into normal Search.  
- **No circular dependency.**

---

## 8. Query intent

**V1 intent is deterministic / rule-based.** No GPT, LLM classifier, or agent.

Means (examples): exact entity matching; Catalog names/aliases; creator username/name; brand/category metadata; curated synonyms; token/pattern rules; query characteristics.

| Intent | User likely wants | V1 |
|--------|-------------------|----|
| **EXACT_PRODUCT** | Specific Catalog product / model | Required |
| **CREATOR** | A person / handle | Required |
| **DISCOVERY** | Broad / natural discovery (“beach outfits”, “best travel gadgets”) | Required |
| **CATEGORY/CONCEPT** | Category or concept browse | Required |
| **COMPARISON** | Multi-product / “vs” Collections | Optional deterministic |
| **COMMERCE** | Buy-oriented cues | Optional deterministic |
| **TRENDING** | What’s popular now | Optional deterministic |

Intent influences retrieval lanes, entity-type weighting, ranking, and blending. Leave a clean extension point for a future learned/semantic intent classifier.

Natural discovery queries must work **without** LLM query understanding, relying on high-quality Collection search-source content + hybrid retrieval.

---

## 9. Ranking signals

**Search owns the ranking pipeline.**  
**Search does NOT own ranking signal SoT.**

| Signal class | Consumed from | Used for |
|--------------|---------------|----------|
| Lexical relevance | SearchDocument searchable fields | Lexical match |
| Semantic similarity | Embedding similarity | Semantic match |
| Query intent | Deterministic intent stage | Lane / blend weights |
| Entity type | Search ranking config | Collection-primary defaults |
| Freshness | Collection `published_at` / revisions | Recency |
| Creator Authority | **Engagement** | Creator/collection boost |
| Collection Quality | Collection `quality_score` (+ contracts) | Eligibility / boost |
| Product popularity | **Engagement** | Product/collection commerce boost |
| Save rate / merchant click rate | **Engagement** metrics | Commerce relevance |
| Verification | **Catalog** verification_status | Trust / exact product |
| Follow graph / saves | **Engagement** edges | Personalization |
| Personalization features | User + Engagement recent activity | Re-rank |
| Commerce intent | Query intent + Tag/Catalog context | Blend toward products |
| Price (filter only) | **Search-side denorm projection** | Facet/filter — **never** live Shopping |

**Rules:**

- Search may cache copies of signals on SearchDocuments for latency; write domains remain producers.  
- Engagement counters/authority refresh Search via **nearline/batch**, not per-event reindex.  
- Search CTR is **Search telemetry**, not an Engagement fact and not a substitute for Engagement popularity.

---

## 10. Personalization

Search **consumes**, never owns:

| Context | Source |
|---------|--------|
| User identity / locale | **User** |
| Following Creators | **Engagement** FOLLOW edges |
| Saved Collections | **Engagement** SAVE edges |
| Recent activity (views, merchant clicks) | **Engagement** (private) |
| Recent searches | **Search Telemetry** (Search-owned — not Engagement) |
| Hide / Safety suppressions | Engagement HIDE + **Safety** block/mute projections |

Personalization is an optional ranking stage. Offline users get non-personalized ranking.

**Privacy:** Respect Engagement privacy classes; do not expose private history in public results.

---

## 11. Autocomplete

Autocomplete is a Search-owned suggestion surface.

| Suggestion class | Source inputs | V1 |
|------------------|---------------|----|
| Recent searches | Search telemetry (per user; short retention, isolated) | Yes |
| Trending / popular queries | Aggregated search telemetry | Where data exists |
| Products | CatalogProductSearchDocument | Yes |
| Creators | CreatorSearchDocument | Yes |
| Collections | CollectionSearchDocument | Yes |
| Brand/category tokens | Internal metadata / facets | Internal / suggest text — not Brand/Category result cards |
| LLM-generated suggestions | — | **Forbidden** |

Latency-critical; heavily cached. Prefix / lexical matching + popularity + recency. Engine TBD.

---

## 12. Filtering

V1 filters are deliberately limited:

| Filter | Typical source | V1 note |
|--------|----------------|---------|
| Creator | creator id / username | Yes |
| Brand | `search_brands` / Catalog brand | Facet/filter — not Brand result type |
| Category | `search_categories` / Catalog | Facet/filter — not Category result type |
| Verified products | Catalog verification | Yes |
| Recently published | `published_at` | Yes |
| Popular | Engagement counters / popularity | Yes |
| Price | Search-side denorm price on Product (or related) docs | **Only if projection exists**; never live Shopping |
| Saved / Following | Engagement edges | Personalized optional |
| Intent | Collection recommendation_intent | Optional |

Prefer **index-time / precomputed** facets; keep the facet set small in V1.

---

## 13. Blended search

**Blended Search is V1 — not Collection-only.**

One query returns:

```text
Collections (primary) | Creators | Catalog Products
```

Clients must **not** be required to pre-select entity type before searching.

**Search owns blending** (sectioning, interleaving, quotas, intent-weighted prominence). Architecture supports:

- Unified mixed ranking underneath  
- Typed sections/lanes available to clients  
- Collection strongest default weight  
- Creator diversification  
- Product/category duplication control  

Intent-aware prominence examples:

| Query | Dominant | Follow-on |
|-------|----------|-----------|
| `sony xm5` | Products | Collections, Creators |
| `tech hints` | Creator | Collections |
| `beach outfits` | Collections | Products, Creators |
| `best travel gadgets` | Collections | Products |

Brand and Category are **not** V1 blended result types.

---

## 14. Freshness

Indexes converge **asynchronously** on write-domain change.

| Event (examples) | Search action |
|------------------|---------------|
| CollectionPublished | Upsert CollectionSearchDocument (+ embedding); autocomplete touch |
| CollectionUpdated | Reindex if search-affecting / revision bump |
| CollectionDeleted / unpublished / ineligible | Remove from serving; optional tombstone |
| CatalogMerged | Resolve/remove stale product doc; index survivor; refresh Collections after search-source recompile |
| ProductVerified | Refresh product ranking fields |
| CreatorUpdated / User public profile | Refresh CreatorSearchDocument + nested creator snapshots on Collections (**async**) |
| EngagementAggregated / batch CounterUpdated | Nearline refresh of ranking mirrors (throttle) |

**Rule:** Prefer event-driven incremental updates; full reindex is an ops rebuild path, not the steady state.

---

## 15. Search quality

Search owns **search quality evaluation** (architecture):

| Metric class | Examples |
|--------------|----------|
| Effectiveness | Precision, Recall, MRR, NDCG |
| Engagement-with-results | Search CTR, dwell proxies |
| Failure | Zero-result rate, abandonment, successful search rate |
| Efficiency | Latency (p50/p95/p99) |
| Behavior | Query reformulation rate |

Judgments / evaluation sets are Search-owned assets. Offline eval ≠ Engagement product graph.  
**No** online learning in V1. Telemetry must be structured so future ML platforms can consume it.

---

## 16. Search telemetry

Search owns operational and product telemetry for **search itself**:

| Telemetry | Purpose |
|-----------|---------|
| Search queries | Debug, trending, “recent searches” |
| Autocomplete usage | Suggestion quality |
| Zero-result queries | Coverage gaps |
| Latency | SLO |
| Search CTR / abandonment | Ranking feedback |
| Result impressions/clicks **in search UI** | Search-quality loop |

**Do not confuse with Engagement:**

| Search owns | Engagement owns |
|-------------|-----------------|
| Query issued, search impression, search result click, Search CTR, abandonment, reformulation, autocomplete interaction, latency | Collection view/open/save, Creator follow, Product click, Merchant click |

A search result click **may lead to** an Engagement fact when the user opens/interacts with the underlying object. Search CTR must **not** become an Engagement fact. Prefer client Engagement ingest over Search inventing behavioral SoT.

---

## 17. Search experiments (reserved)

Future support (no V1 requirement):

- A/B testing of ranking weights / stages  
- Feature flags for pipeline stages  
- ML ranking model comparison  
- Retrieval hybrid experiments  

Experiment assignment may live in an Experimentation platform; Search consumes variant config at query time. Future ML ranking may live outside Search serving; Search remains orchestration/serving.

---

## 18. Consumer contracts

How Search serves product surfaces:

| Surface | Search provides |
|---------|-----------------|
| **Discover / Home Search** | **Blended** Collection/Creator/Product results + autocomplete |
| **Collection Search** | Collection lane + filters (still part of blended architecture) |
| **Creator Search** | Creator lane |
| **Product Search** | Catalog product lane |
| **Recommendation candidate retrieval** | Optional one-way recall API **to** Recs (candidates only; Recs ranks for feed) |
| **Future APIs** | Richer facets, “more like this”, multimodal, conversational |

Contracts are read-only and **FE-presentation-agnostic** (cards today; reels-style Collection discovery later). Clients never write SearchDocuments.

Pagination/cursors are part of the read contract. Collection results include primary media **references** only.

---

## 19. Domain events

### 19.1 Search consumes (examples)

| Event | From |
|-------|------|
| `CollectionPublished` / `CollectionUpdated` / `CollectionDeleted` | Collection |
| Search-source recompile signals | Collection |
| CollectionMedia changes projected through Collection | Collection / Media |
| `ProductMerged` / `ProductVerified` / `CatalogUpdated` / `LifecycleChanged` | Catalog |
| `CreatorStatusChanged` / `ProfileUpdated` / `UsernameChanged` | User |
| `EngagementAggregated` / batch `CounterUpdated` / `TrendingUpdated` | Engagement |
| Tag rematch affecting search brands (via Collection recompile) | Collection / Tag |

### 19.2 Search emits

Search **should not emit business-domain events** (no Collection/Catalog/Engagement truth).

Optional **Search-internal** ops signals (index lag, reindex completed) may exist for observability — not foundational domain events.

---

## 20. Caching

| Cache | Role |
|-------|------|
| **Hot query cache** | Popular anonymous/global queries → assembled results |
| **Autocomplete cache** | Prefix → suggestions |
| **Query embedding cache** | Where useful for vector retrieval |
| **Personalized cache** | Per-user result pages (short TTL; user-isolated; privacy-sensitive) |
| **Document cache** | Optional hydration cache for assembly |

**Invalidation:** On document upsert/delete; on revision bump; TTL expiry; optional event-driven purge (best-effort).

**TTL:** Short for personalized; longer for global trending/autocomplete; never treat cache as SoT.

---

## 21. Architectural decisions (frozen for V1)

Former open questions — **resolved**. Authoritative detail: [`SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md`](./SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md). Do not reopen without an explicit architecture change.

| # | Decision |
|---|----------|
| **1** | **V1 entity scope:** Collections + Creators + Catalog Products. **Collection is primary.** Brands/Categories are not independent V1 result types. |
| **2** | **Blend strategy:** Unified ranking underneath; typed sections/lanes available to clients; Collection prominence. Blended Search is V1 — **not** Collection-only. |
| **3** | **Counter freshness:** Nearline/batched Engagement projections into Search. **No** per-event Search reindex. |
| **4** | **Creator snapshot fan-out:** Denormalize into CollectionSearchDocument; refresh asynchronously on User changes. No sync User join per query. |
| **5** | **Price filters:** Search-side denormalized projection only. **Never** live Shopping joins. If projection unavailable → **no** V1 price filter. |
| **6** | **Semantic timeline:** Embedding/vector retrieval is **V1** (hybrid with lexical). Dedicated embedding model. **No** LLM/GPT search reasoning. |
| **7** | **Recs candidate API:** Search may supply candidates **to** Recommendations. Recommendations does **not** supply required candidates to Search. **No circular dependency.** |
| **8** | **Zero-result fallback:** Normalize → spell → synonym → broader lexical → semantic → related/popular. |
| **9** | **Search click → Engagement:** Search owns search telemetry; Engagement owns behavioral facts. A search click may **lead to** Engagement; no Search-server duplication of Engagement SoT. |
| **10** | **Multi-language:** Language-aware analysis/indexing where supported; avoid unnecessary per-language infrastructure in V1. |
| **11** | **Soft-delete retention:** Remove from serving quickly; retain tombstone internally when useful for propagation/rebuild. |
| **12** | **Autocomplete PII:** Short retention for per-user recent searches; explicit privacy/deletion policy; strict user isolation. |
| **13** | **Facet compute:** Prefer index-time/precomputed facets; keep V1 facet set small. |
| **14** | **Engine selection:** Deferred until architecture freeze + workload benchmark. No engine or embedding provider chosen here. |
| **15** | **Online learning:** Not V1. Telemetry/evaluation hooks only; future ML/experimentation consumes Search signals. |

### Additional V1 freezes

| Topic | Decision |
|-------|----------|
| LLM / GPT / agents | Forbidden for query understanding, rewrite, answers, rerank |
| ML learning-to-rank | Not V1 |
| Query intent | Deterministic / rule-based; extension point for future learned intent |
| Embedding model | Allowed as dedicated retrieval component; **≠ LLM** |
| FE layout | Backend contract FE-agnostic; supports cards and future reels-style Collection discovery; Search does not own media |

---

## 22. Explicit non-goals

Search **must never** own:

| Non-goal | Owner / note |
|----------|--------------|
| Collections / publish / tags / media | **Collection** (+ Media / Tag) |
| Catalog identity / merge / verification | **Catalog** |
| Engagement facts / follows / saves | **Engagement** |
| Recommendations models / feed ranking | **Recommendations** / **Feed** |
| Required Recs→Search candidate supply | **Forbidden** |
| Shopping destinations / affiliate / live price serving | **Shopping** |
| Analytics warehouse as product SoT | **Analytics** |
| Notifications delivery | **Notifications** |
| Creator profiles / auth | **User** |
| Canonical counters / Creator Authority production | **Engagement** |
| Collection search source compile | **Collection** |
| Brand/Category as V1 independent result types | Internal/facet use only |
| GPT/LLM/agent search reasoning | Out of V1 |
| Online learning / ML LTR in V1 | Future / external ML |

---

## 23. Architecture principles (normative)

1. **Search is read-only** relative to business entities.  
2. **Search owns retrieval** and **ranking orchestration**.  
3. **Search consumes signals** from foundational domains; it does not invent business truth.  
4. **Search indexes are disposable** and rebuildable.  
5. **Search is eventually consistent** and **CQRS-friendly**.  
6. **Retrieval ≠ Ranking** — separate stages.  
7. **V1 retrieval is hybrid** — BM25-family lexical + embedding/vector semantic.  
8. **Collection search source fields** are the preferred text inputs for Collection documents.  
9. **Engagement is behavioral SoT**; Search telemetry is search-ops SoT.  
10. **Technology-agnostic** — no engine or embedding provider assumed.  
11. **Embedding model ≠ LLM** — embeddings allowed; LLM search reasoning forbidden in V1.  
12. **Cost-aware** — cheap recall first; expensive rank second.  
13. **Privacy-aware personalization** — consume Engagement/Safety correctly.  
14. **Blended Search is V1** — Collections (primary) + Creators + Products; not Collection-only.  
15. **One-way Recs boundary** — Search may feed Recs; Recs must not feed required Search recall.  
16. **Never live Shopping calls** during search serving for price.  
17. **FE-agnostic assembly** — same Collection result supports cards and future reels-style discovery; Search does not own media.  
18. **Future-ready without redesign:** better semantic/multimodal retrieval, ML ranking, personalization, session-aware and conversational search — none required for V1.  
19. **Incremental delivery** — V1 must not paint the architecture into a corner.

---

## 24. Mystash principles (applied)

1. Write domains stay pure; Search projects.  
2. Event-driven indexing only.  
3. One producer per signal class (esp. Engagement for authority/popularity).  
4. V1 product freezes in the implementation plan are normative for delivery.  
5. Optimize for creator-commerce discovery — **Collections first**, with Creators and Products as first-class V1 peers in blended results.

---

## 25. Existing Mystash mapping (informational)

| Spec concept | Current / related artifact |
|--------------|----------------------------|
| Collection search inputs | Collection `search_*` fields + compile (`searchSourceCompile`) |
| Eligibility | Collection `search_eligible` |
| Catalog identity for product docs | `catalog_products` / CatalogService |
| Ranking signals | Engagement counters, Creator Authority (Engagement-owned) |
| Personalization edges | Engagement FOLLOW / SAVE |
| Merchant click behavioral fact | Engagement `MerchantClicked` (not Search telemetry) |
| Media for Collection cards / reels | CollectionMedia references projected into SearchDocument |
| Search engine / embedding provider | **Not chosen** |
| V1 delivery sequencing | [`SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md`](./SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md) |

---

## 26. Success criteria for “canonical Search”

1. SearchDocuments and indexes are clearly disposable projections.  
2. Retrieval and ranking are separated; V1 retrieval is **hybrid**.  
3. V1 serves **blended** Collections (primary) + Creators + Products.  
4. Signal ownership is explicit (Search orchestrates; peers produce).  
5. Indexing is async/event-driven with eventual consistency and nearline engagement freshness.  
6. Telemetry is Search-owned and not confused with Engagement.  
7. Recs boundary is one-way; no circular dependency.  
8. No live Shopping price joins; no LLM/GPT search reasoning in V1.  
9. No business entity SoT lives in Search.  
10. Technology choice (engine + embedding provider) remains deferred.  
11. Spec and implementation plan are consistent on frozen V1 decisions.

---

*End of Search Domain Specification.*
