# Catalog Domain — Current Architecture Audit

**Purpose:** Understand the Catalog implementation that exists today before deciding whether a new canonical Catalog specification is needed.  
**Constraints:** Read-only inventory. No redesign. No implementation proposals. No migrations. No new spec.  
**Primary evidence:** `backend/src/product-intelligence/**`, `backend/src/shopping/**`, `backend/src/publish.ts`, `backend/src/collection/**`, Supabase migrations under `supabase/migrations/`, and `backend/docs/ARCHITECTURE.md` / Collection domain docs.

**Headline**

There is **no standalone `backend/src/catalog` bounded-context package**. Catalog is a **Product Intelligence submodule** (`product-intelligence/catalog/`) plus a set of Supabase tables centered on `catalog_products`. That implementation is already treated as the **commerce / UI source of truth** for product identity and durable product metadata. Discovery providers (Serper/CSE) and page enrichment (Tavily / `canonical_products` preview cache) are ingest-time inputs — not Catalog truth.

---

## 1. Existing Catalog Architecture

### 1.1 Shape

```
┌─────────────────────────────────────────────────────────────────┐
│ Product Intelligence (write orchestrator)                       │
│  ProductNormalizer → LocalCatalogSearch → Search/Enrich         │
│  → MetadataMerge → ShoppingDestinationResolver                  │
│  → ProductResolver.upsertCatalog → CatalogRepository            │
└────────────────────────────┬────────────────────────────────────┘
                             │ writes / reads
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Catalog persistence (embedded)                                  │
│  catalog_products · catalog_aliases · product_match_history     │
│  catalog_search_candidates (discovery cache, not product SoT)   │
│  SupabaseCatalogRepository · LocalCatalogSearch                 │
│  ProductMergeService (stub)                                     │
└───────────┬───────────────────────────────┬─────────────────────┘
            │                               │
            ▼                               ▼
   Consumers (read)                  Secondary writers
   · CollectionProductTag FK         · publish.ts placeholders
   · video_products / drafts         · background product-resolve
   · Expo Supabase joins             · shopping click analytics
   · GET /products/:id/redirect        (product_clicks only)
```

### 1.2 Catalog-related modules

| Module / path | Role |
|---------------|------|
| `backend/src/product-intelligence/catalog/SupabaseCatalogRepository.ts` | CRUD on `catalog_products` / aliases; maps DB ↔ `CatalogProduct` |
| `backend/src/product-intelligence/catalog/LocalCatalogSearch.ts` | Local dedupe/reuse: merchant URL → exact name → alias → brand+model → fuzzy |
| `backend/src/product-intelligence/catalog/ProductMergeService.ts` | **Stub only** — `UnimplementedProductMergeService` throws |
| `backend/src/product-intelligence/interfaces/CatalogRepository.ts` | Ports: `CatalogRepository`, `SearchCandidateCache`, `MatchHistoryWriter`, `DraftUpdater` |
| `backend/src/product-intelligence/domain/types.ts` | `CatalogProduct`, statuses, create/update inputs |
| `backend/src/product-intelligence/resolver/ProductResolver.ts` | Primary catalog writer / upsert orchestrator |
| `backend/src/product-intelligence/normalizer/*` | Identity normalization + alias generation |
| `backend/src/product-intelligence/matcher/MatchScorer.ts` | Scores AI draft vs external search candidates (pre-catalog admission) |
| `backend/src/product-intelligence/enrichment/*` | Merchant PDP enrichment feeding catalog fields |
| `backend/src/product-intelligence/jobs/productResolveQueue.ts` | Background resolve; syncs `video_products` from catalog |
| `backend/src/product-intelligence/factory.ts` | DI wiring for catalog repo + resolver |
| `backend/src/shopping/*` | Destination selection at resolve time; outbound redirect at click time |
| `backend/src/publish.ts` | Ensures catalog row exists at publish; links `video_products` |
| `backend/src/collection/*` | Tags **reference** `catalog_product_id`; do not own catalog identity |
| `backend/src/products/catalogMatcher.ts` | **Deprecated** no-op; must not be used |
| `backend/src/products/productPersist.ts` | Creates drafts as `UNRESOLVED` (no catalog yet) |
| `src/types/catalogProduct.ts` + `src/services/catalogProductMapper.ts` | App view model + row mapping |
| `src/services/supabase.ts` / `curation.ts` / `shoppingClick.ts` | Feed/review joins and redirect client |

### 1.3 How pieces interact

1. **Ingest** persists AI draft products without requiring a catalog id.
2. **ProductResolver** normalizes identity, searches the local catalog, optionally discovers/enriches externally, then **creates or updates** a `catalog_products` row and stamps `ingest_draft_products.catalog_product_id`.
3. **Collection ingestBridge** copies draft → tag rows, carrying `catalog_product_id` when present.
4. **Publish** (legacy video path) ensures a catalog row exists (creating an `UNRESOLVED` placeholder if missing) and writes `video_products` with denormalized display fields + catalog FK.
5. **App UI** prefers joining `catalog_products` for product cards; shopping clicks call **`GET /products/:id/redirect`**, which reads catalog and records `product_clicks`.
6. **Search compile** (Collection) uses **tag snapshots**, not live Catalog joins, for brands/categories/keywords.

There is no Catalog application service, no Catalog HTTP CRUD API, and no Catalog domain-event bus separate from Product Intelligence structured logs.

---

## 2. Database Schema

### 2.1 Core Catalog tables

#### `catalog_products`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Global product catalog — documented as commerce / UI source of truth |
| **Ownership** | Product Intelligence catalog repository; also written by `publish.ts` placeholders |
| **PK** | `id` uuid (`gen_random_uuid()`) |
| **FKs** | Self-FK `merged_into_id` → `catalog_products(id)` ON DELETE SET NULL |
| **Unique** | `canonical_slug` |
| **Important indexes** | `normalized_name`; `(brand, model)`; `verification_status`; `status`; `merchant_url` |
| **Lifecycle fields** | `status` (`ACTIVE` \| `DISCONTINUED` \| `MERGED` \| `HIDDEN`); `verification_status` (`VERIFIED` \| `UNVERIFIED` \| `UNRESOLVED`); `last_verified_at`; `created_at` / `updated_at` |
| **Identity** | `canonical_slug`, `brand`, `name`, `normalized_name`, `model`, `category` |
| **Commerce (denormalized on same row)** | `merchant`, `merchant_url`, `preferred_shopping_url`, `shopping_provider`, `affiliate_url`, `currency`, `price`, `availability`, `rating`, `review_count` |
| **Verification** | `verification_provider`, `verification_source`, `verification_version`, confidence numerics |
| **Extensibility** | `metadata` jsonb |
| **RLS** | Public `SELECT` for `anon`/`authenticated` where `status = 'ACTIVE'`; writes service-role |

Migration origins: `20260728200000_product_intelligence_catalog.sql`; shopping columns in `20260729150000_shopping_resolution.sql`; public read policy in `20260729000000_catalog_public_read.sql`.

#### `catalog_aliases`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Alternate names pointing at a catalog product |
| **Ownership** | `SupabaseCatalogRepository.addAlias` on create |
| **PK** | `id` uuid |
| **FKs** | `catalog_product_id` → `catalog_products` ON DELETE CASCADE |
| **Unique** | `(catalog_product_id, alias)` |
| **Indexes** | `alias` |
| **Lifecycle** | `created_at` only (no soft-delete / deactivation) |

#### `catalog_search_candidates`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Normalized **discovery** candidate cache keyed by query + provider — **not** product identity SoT |
| **Ownership** | `SupabaseSearchCandidateCache` via Serper/CSE providers |
| **PK** | `id` uuid |
| **FKs** | None to `catalog_products` |
| **Indexes** | `(query, provider, expires_at)` |
| **Lifecycle** | `created_at`, `expires_at` (TTL-driven) |

#### `catalog_search_debug`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Optional raw provider payload dump |
| **Ownership** | Schema only — no runtime `.from('catalog_search_debug')` usage found |
| **PK** | `id` uuid |
| **Lifecycle** | `created_at` |

#### `product_match_history`

| Aspect | Detail |
|--------|--------|
| **Purpose** | Audit of draft ↔ catalog match decisions |
| **Ownership** | ProductResolver finish path via `SupabaseMatchHistoryWriter` |
| **PK** | `id` uuid |
| **FKs** | `draft_id` → `ingest_draft_products`; `catalog_product_id` → `catalog_products` |
| **Indexes** | `draft_id` |
| **Lifecycle** | `created_at`; append-only |
| **Reads** | No app/API reader found |

### 2.2 Catalog-adjacent tables (consumers / analytics)

| Table | Catalog link | Purpose / notes |
|-------|--------------|-----------------|
| `ingest_draft_products` | `catalog_product_id`, `resolution_status`, `merchant_url` | Pre-publish product candidates |
| `video_products` | `catalog_product_id`, `resolution_status`, denorm name/price/image | Published feed products (legacy Collection surface) |
| `collection_product_tags` | `catalog_product_id` + snapshots + `resolution_status` | Collection recommendation tags; unique `(collection_id, catalog_product_id)` when catalog set & not deleted |
| `affiliate_links` | `catalog_product_id`, `merchant_url` | Schema extended for catalog-scoped affiliate cache; little/no runtime usage found |
| `product_clicks` | `catalog_product_id` NOT NULL | Shopping redirect analytics before 302 |

### 2.3 Related but **not** Catalog identity

#### `canonical_products`

| Aspect | Detail |
|--------|--------|
| **Purpose** | URL-keyed **product page preview / enrichment cache** (tracking-stripped URL → scraped/AI fields) |
| **Ownership** | `pipeline/productLinkPreview.ts` |
| **PK** | `canonical_url` text |
| **Lifecycle** | `last_extracted_at`; extraction_source versioning |
| **Important** | Naming overlap with “canonical product” language, but this table is **not** the Catalog domain aggregate |

---

## 3. Domain Responsibilities

### 3.1 What Catalog actually owns today

In practice, Catalog owns (or is the persisted home of):

| Responsibility | Reality |
|----------------|---------|
| Durable product identity | `id`, `canonical_slug`, `normalized_name`, brand/model/category |
| Durable display metadata | name, description, image, specs (often in `metadata`) |
| Verification state | `verification_status` + provider/source/version + confidences |
| Lifecycle status | `ACTIVE` / `DISCONTINUED` / `MERGED` / `HIDDEN` (MERGED unused in code) |
| Alias strings | `catalog_aliases` |
| Match audit trail | `product_match_history` |
| **Also stores shopping/commerce fields** | merchant URL, preferred shopping URL, affiliate URL, provider, price/currency |

Catalog does **not** own: Collection recommendation intent, tag presentation, ingest pipeline stages, discovery provider selection, or click analytics schema (clicks reference Catalog but are Shopping-owned writes).

### 3.2 Responsibilities handled elsewhere

| Domain | What it does relative to Catalog |
|--------|----------------------------------|
| **Product Intelligence** | Orchestrates normalize → local hit → search → enrich → merge → verify → shopping destination → **catalog upsert**. Catalog package is nested under PI. |
| **Merchant Resolution / Enrichment** | Resolves PDP metadata (Tavily / scrape / AI via `previewProductLink`); feeds Catalog columns + `metadata`. Uses `canonical_products` as page-cache, not Catalog. |
| **Shopping** | At resolve: writes `preferred_shopping_url` / `shopping_provider` onto Catalog. At click: reads Catalog, chooses affiliate → preferred → merchant, writes `product_clicks`. |
| **Search (discovery)** | External candidate generation + `catalog_search_candidates` cache. Explicitly not UI truth. |
| **Search (Collection compile)** | Brands/categories/keywords from **tag snapshots**, not live Catalog. |
| **CollectionProductTag** | Recommendation link + snapshots; requires `catalog_product_id` for publish-surface inclusion; must not mutate Catalog identity. |
| **Ingest** | Extracts drafts; emits `catalog.match.complete` around `resolveIngestDrafts`; does not define Catalog schema. |
| **Publish** | Can **create** Catalog placeholders (`verification_source = publish_placeholder`) — a second write path outside PI resolver. |

### 3.3 Duplicated / blurred ownership

| Overlap | Issue |
|---------|-------|
| **Identity + commerce on one row** | Catalog stores both durable identity and volatile offer/shopping fields; Collection specs say Commerce/Shopping should own offer volatility. |
| **PI vs Catalog package boundary** | Catalog persistence lives inside Product Intelligence; there is no Catalog service boundary for other domains to call. |
| **Publish vs Resolver writes** | Both create/update `catalog_products`; publish can mint low-quality `UNRESOLVED` placeholders. |
| **Denorm on `video_products`** | Name/price/image copied from Catalog at publish; can drift from live Catalog. |
| **Tag snapshots vs Catalog** | Intentional offline/search copies of brand/name/category; risk of stale facets if Catalog later corrects identity and tags are not rematched. |
| **`canonical_products` vs `catalog_products`** | Two “canonical product” concepts; only the latter is Catalog SoT. |
| **Deprecated `CatalogMatcher`** | Parallel naming; no-op; confusion risk for newcomers. |

---

## 4. Current Data Flow

### 4.1 Implemented end-to-end flow

```
Ingest (Stages 1–3: metadata / media / reasoning)
        ↓
productPersist → ingest_draft_products (resolution_status = UNRESOLVED)
        ↓
resolveIngestDrafts / ProductResolver.resolveOne
        ↓
Normalize + specificity gate
        ↓
LocalCatalogSearch (prefer VERIFIED hits ≥ CATALOG_HIT_MIN_SCORE)
   ├─ HIT → light update / reuse existing catalog row
   └─ MISS → Discovery search (Serper/CSE) + PDP rank
                ↓
           Merchant enrichment (Tavily / previewProductLink)
                ↓
           MatchScorer + MetadataMergeService (field-trust policy)
                ↓
           Verification merchant URL (authority-first)
                ↓
           ShoppingDestinationResolver → preferredShoppingUrl
                ↓
           CatalogRepository.create | update
                + aliases + product_match_history
                + draft.catalog_product_id / resolution_status
        ↓
Collection ingestBridge (optional) → collection_product_tags
        ↓
Creator review / tag accept-reject (Collection)
        ↓
Publish
   ├─ Collection path: tags must be included + catalog_product_id for publish surface
   └─ Legacy video path: ensure catalog row (placeholder if missing)
        → video_products (+ denorm fields + catalog FK)
        ↓
Feed / curation UI reads catalog_products joins
        ↓
User shopping click → GET /products/:id/redirect
        → ShoppingResolver → product_clicks → 302
```

### 4.2 Background continuation

Unresolved / weak resolves may enqueue BullMQ `product-resolve`. The worker re-runs resolution and can sync published `video_products` fields from the updated Catalog row. Collection lifecycle is intentionally independent of async Catalog verification (per Collection specs).

### 4.3 What the flow is **not**

- There is no separate “Draft Products domain aggregate” beyond `ingest_draft_products`.
- There is no Catalog merge step after create.
- There is no Catalog-owned publish gate; Collection/Publish enforce resolution requirements.
- Discovery search results never become Catalog rows directly without enrichment/merge decisions.

---

## 5. Product Identity

### 5.1 How identity is formed

1. **`canonicalizeProductIdentityText`** — strips review/video noise from identity text.
2. **`ProductNormalizer`** — produces `normalizedName`, brand/model/category, `canonicalSlugBase`, and an alias set (normalized name, raw name, brand+model patterns).
3. **Persistence** — `canonical_slug` is unique; on collision `SupabaseCatalogRepository.create` appends `-2`, `-3`, …
4. **IDs** — Catalog primary key is a random UUID (`gen_random_uuid()`). Public-facing durable key intended in schema comments is `canonical_slug`.

### 5.2 How products are matched (local reuse)

`LocalCatalogSearch` order:

| Step | Via | Score (typical) |
|------|-----|-----------------|
| Merchant URL exact | `merchant_url` | 1.0 |
| Normalized name + compatibility | `exact_name` | 1.0 |
| Alias lookup + compatibility | `alias` | 0.95 |
| Brand + model | `brand_model` | 0.92 |
| Fuzzy Dice ≥ 0.72 over recent ACTIVE pool (prefer VERIFIED) | `fuzzy` | variable |

Compatibility rejects conflicting brand/model/category. Resolver only auto-reuses a local hit when score ≥ `CATALOG_HIT_MIN_SCORE` (default 0.85) **and** `verification_status === VERIFIED`.

External candidates are scored by `MatchScorer` before enrichment admission — that is discovery matching, not Catalog alias matching.

### 5.3 Duplicates

| Mechanism | Status |
|-----------|--------|
| Prefer reuse of VERIFIED local hits | Implemented |
| In-place `update` when draft already has `catalogProductId` | Implemented (anti-duplicate for enrichment) |
| Slug collision suffixing | Implemented (new row, not merge) |
| Cross-row merge of duplicates | **Not implemented** (`ProductMergeService` stub) |
| Soft-hide / discontinue workflows | Status enum exists; no domain service API |

### 5.4 Aliases

- Written at create from normalizer-generated alias list.
- Unique per `(catalog_product_id, alias)`.
- Used for local search; no alias confidence, source, or retirement model.

### 5.5 Merges

- Schema ready: `status = MERGED`, `merged_into_id`.
- Service interface reserved; implementation throws.
- CollectionProductTag specs expect remapping tags on merge — **not coded**.
- Redirect / clicks / aliases preservation on merge — **not coded**.

---

## 6. Current Catalog API

There is **no dedicated Catalog REST CRUD surface**. Interactions:

### 6.1 Public / app-facing

| Surface | Read / Write | Catalog role |
|---------|--------------|--------------|
| Supabase `SELECT` on `catalog_products` (`ACTIVE`) | Read | Feed, curation, product cards via joins |
| `GET /products/:id/redirect` | Read catalog; write `product_clicks` | Shopping outbound |
| Collection tag routes accepting `catalog_product_id` | Write **tag** only | Does not create Catalog products |

### 6.2 Backend write paths (service-role)

| Surface | Writer |
|---------|--------|
| `ProductResolver` → `SupabaseCatalogRepository.create/update/addAlias` | Primary |
| `publish.ts` insert/update placeholders | Secondary |
| `product-resolve` worker (via resolver + video_products sync) | Background |
| Match history / search candidate cache | PI supporting tables |

### 6.3 Internal ports (not HTTP)

| Port | Used by |
|------|---------|
| `CatalogRepository` | Resolver, LocalCatalogSearch, Shopping redirect |
| `LocalCatalogSearch` | Resolver |
| `SearchCandidateCache` | Serper/CSE |
| `MatchHistoryWriter` | Resolver |
| `DraftUpdater` | Resolver |
| `ProductMergeService` | Unused (unimplemented) |

### 6.4 Who reads / who writes (summary)

| Actor | Reads Catalog | Writes Catalog |
|-------|---------------|----------------|
| Product Intelligence / Resolver | Yes | **Yes (primary)** |
| Publish | Yes | Yes (placeholders) |
| Shopping redirect | Yes | No (writes clicks only) |
| Collection / tags | Via FK + snapshots | No (stores id only) |
| Expo app (Supabase) | Yes | No |
| Discovery search providers | No (write candidate cache) | No |

---

## 7. Current Events

Catalog does **not** emit a formal domain-event stream. Observability is structured logging.

### 7.1 Product Intelligence (`emitPiEvent`)

| Event | Meaning |
|-------|---------|
| `catalog.hit` | Local catalog reuse |
| `catalog.miss` | No qualifying local hit → external search |
| `catalog.created_verified` | Catalog upsert with commerce offer present |
| `catalog.created_unverified` | Metadata-only / weak catalog row |
| `draft.unresolved` | Placeholder catalog + unresolved draft |
| `resolve.background_enqueued` | Background resolve queued |
| `verification.decided` | Verification outcome recorded |
| (+ surrounding) | `specificity.*`, `search.*`, `pdp.rejected`, `affiliate.resolved` |

Additional PI logs (not always in the `PiEvent` union) include metadata merge / enrichment events.

### 7.2 Pipeline

| Event | Meaning |
|-------|---------|
| `catalog.match.complete` | Orchestrator around `resolveIngestDrafts` |

### 7.3 Shopping (structured logs)

`shopping.redirect.*`, `shopping.url.selected` / `.unavailable` — consume Catalog, do not define Catalog lifecycle.

### 7.4 Collection tag events

Tag events may carry `catalogProductId` (`ProductTagProposed`, `ProductTagAccepted`, `ProductTagPublished`, rematch, etc.). These are **Collection-owned** events that reference Catalog ids; they are not Catalog domain events.

---

## 8. Consumers

| Consumer | How it uses Catalog |
|----------|---------------------|
| **CollectionProductTag** | Nullable FK `catalog_product_id`; publish requires resolved catalog id for included tags; uniqueness per collection+catalog; snapshots for offline/search |
| **Collection search compile** | Indirect — uses tag brand/name/category snapshots (often sourced from drafts/catalog at tag creation), not live Catalog joins |
| **Publish (legacy video)** | Ensures catalog row; denorms into `video_products`; links FK |
| **Publish (Collection)** | Gate on tag → catalog resolution; does not rewrite Catalog identity |
| **Shopping** | Destination fields stored on Catalog; redirect resolves from Catalog row |
| **Product Intelligence** | Creator and updater of Catalog rows; local search consumer |
| **Ingest orchestrator** | Triggers resolve; emits match-complete |
| **Expo feed / curation** | Joins `catalog_products` for display verification/price/image |
| **product_clicks / analytics** | Foreign key target for outbound commerce analytics |
| **Affiliate (planned)** | Schema on `affiliate_links.catalog_product_id`; runtime mostly catalog `affiliate_url` when enabled |

---

## 9. Architectural Assessment

Evaluated against Mystash domain principles as expressed in Collection / ProductTag specs and ARCHITECTURE.md: clear bounded contexts, Catalog as shared product SoT, PI as upstream resolver, Shopping as commerce destination, tags as recommendation links, no reinventing strong existing systems.

### 9.1 Strengths

- **Real product SoT table** with identity, verification, status, metadata, and public read RLS.
- **Clear ingest-time doctrine:** discovery providers are not UI truth; enrichment feeds Catalog.
- **Local catalog search + aliases** provide practical dedupe before external spend.
- **In-place update path** when a draft already links a catalog id reduces enrichment duplicates.
- **Separation of verification URL vs preferred shopping URL vs affiliate URL** is documented and partially enforced in comments/code.
- **CollectionProductTag correctly references Catalog** rather than owning global product truth.
- **Match history** exists for auditability of resolve decisions.
- **Shopping redirect** is a clean read consumer with analytics.

### 9.2 Weaknesses

- **No Catalog bounded-context service** — persistence and matching sit under Product Intelligence; other domains cannot depend on a stable Catalog API contract.
- **Commerce fields co-located with identity** — blurs Catalog vs Shopping/Commerce ownership.
- **Second writer (`publish` placeholders)** can mint low-quality Catalog rows outside the resolver quality bar.
- **Merge / duplicate consolidation incomplete** despite schema and reserved service.
- **No Catalog domain events** for merge, hide, verify, rematch consumers (tags, search) to react to.
- **Denormalized `video_products`** and **tag snapshots** can diverge from Catalog without rematch contracts.
- **`catalog_search_debug` unused**; `affiliate_links` catalog extension largely unused.
- **Deprecated matcher** still present under `products/`.
- **Naming collision** with `canonical_products` preview cache.

### 9.3 Duplicated ownership

- Product identity write path: PI resolver vs publish ensure-catalog.
- Product display fields: Catalog vs `video_products` vs tag snapshots.
- Offer/price: enrichment merge into Catalog vs Shopping destination selection (independent by design, but both persisted on Catalog).
- “Canonical product” language: Catalog slug vs `canonical_products` URL cache.

### 9.4 Technical debt

- `UnimplementedProductMergeService`.
- Publish placeholder slugs (`publish-{draftId}`) vs normalizer slugs.
- Fuzzy search over a capped ACTIVE pool (scalability / recall limits).
- No alias lifecycle or conflict resolution across products.
- No admin/ops Catalog API for moderation (`HIDDEN` / `DISCONTINUED`).
- Background sync targets `video_products` more than Collection tags.

### 9.5 Future risks

- Duplicate Catalog rows accumulate without merge → broken uniqueness assumptions for Collection tags and analytics.
- Collection publish uniqueness on `catalog_product_id` becomes wrong if two tags resolve to duplicates that should have been one product.
- Shopping/price freshness fights identity stability on the same row.
- As Collection becomes the primary publish surface, legacy `video_products` denorm + Catalog dual paths increase drift.
- Without a Catalog event contract, tag rematch / search recompile on Catalog correction will remain ad hoc.

---

## 10. Gap Analysis

Architectural gaps only (capabilities a world-class Catalog domain typically owns). **No implementation details.**

| Capability | Status vs world-class Catalog |
|------------|-------------------------------|
| Explicit Catalog bounded context / application service | **Missing** (embedded in PI) |
| Canonical identity model with stable public ids | **Partial** (uuid + slug; slug collision suffixes; publish placeholders) |
| First-class alias model with provenance | **Partial** (strings only) |
| Deterministic match / reuse policy | **Partial** (strong local search; thresholds config-driven) |
| Duplicate detection + merge with referential integrity | **Missing** (schema stub only) |
| Lifecycle moderation (hide/discontinue/restore) as Catalog ops | **Missing** (enum only) |
| Catalog domain events for consumers | **Missing** (logs only) |
| Clear split: identity SoT vs offer/shopping SoT | **Partial / blurred** (fields on same row; Shopping logic separate) |
| Single write authority | **Partial** (resolver primary; publish secondary) |
| Consumer rematch contract (tags, video_products, search) | **Missing** for Catalog-side changes |
| Reverse index “Collections featuring product” | **Missing** (called out as Catalog-centric need in Collection spec; not built) |
| Offer history / price time series | **Missing** (current price only on row) |
| Admin / governance API | **Missing** |
| Disambiguation of preview-cache vs Catalog | **Conceptual gap** (`canonical_products` naming) |

These gaps are architectural ownership and contract gaps — not a claim that Catalog tables should be thrown away.

---

## 11. Recommendation

### **B) Existing Catalog should be evolved into a canonical domain.**

**Why not A (already canonical, refinement only)**  
The data model and runtime behavior already act as product SoT for UI and tags, but Catalog is not yet a first-class domain: it has no independent service boundary, no merge lifecycle, no domain events, dual write paths, and identity is entangled with shopping/offer columns. Calling it “already canonical” would understate the boundary work peers (User, Collection, CollectionProductTag) already received.

**Why not C (redesign)**  
A strong implementation already exists: `catalog_products` + aliases + local search + verification states + public read policy + resolver upsert + Collection FK semantics + shopping redirect consumer. Product Intelligence correctly treats Catalog as truth and discovery as ingest-only. Redesigning from scratch would reinvent working SoT tables and break Collection/Shopping contracts.

**What “evolve” means (direction only — not a plan)**  
Preserve `catalog_products` as the identity aggregate; clarify Catalog vs Product Intelligence vs Shopping ownership; close merge/rematch/event gaps; reduce secondary writers and denorm drift. A future canonical Catalog **specification** (when written) should start from this implementation, not from a greenfield model.

---

## Appendix A — Key file index

| Path | Note |
|------|------|
| `supabase/migrations/20260728200000_product_intelligence_catalog.sql` | Core Catalog schema |
| `supabase/migrations/20260729150000_shopping_resolution.sql` | Shopping columns + `product_clicks` |
| `supabase/migrations/20260729000000_catalog_public_read.sql` | Public ACTIVE read |
| `backend/src/product-intelligence/catalog/*` | Catalog persistence + local search + merge stub |
| `backend/src/product-intelligence/resolver/ProductResolver.ts` | Primary writer |
| `backend/src/shopping/productRedirect.ts` | Public redirect consumer |
| `backend/src/publish.ts` | Placeholder catalog ensure |
| `backend/docs/ARCHITECTURE.md` | Broader system map including Catalog |
| `backend/docs/COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md` | Tag ↔ Catalog contracts |
| `backend/src/product-intelligence/README.md` | PI + Catalog flow summary |

## Appendix B — Explicit non-goals of this audit

- No new `CATALOG_DOMAIN_SPEC.md`
- No implementation plan
- No migrations or code changes
- No ranking of sprint work

---

*Audit generated from repository state; intended as input to a later go/no-go on writing a canonical Catalog specification.*
