# Mystash User URL Ingestion — Architecture Audit (Phase 0)

**Status:** Reconnaissance only. No production code, schema, migrations, or dependencies were changed.  
**Date:** 2026-09-20  
**Scope:** Repository as implemented under `/` (Expo React Native app + Express backend + Supabase migrations).  
**Out of scope:** Search redesign, Android share implementation, schema changes, any runtime wiring.

---

# 1. Executive Summary

Mystash already has a complete **creator ingest → AI extract → Product Intelligence resolve → `catalog_products` → Collection/Cart/Shopping** path. User “Discover Anywhere” (share Reel / Short / product URL → async process → Bag → decision-oriented Product Page) should **plug into that path**, not fork a second extraction/matching system.

Three facts dominate the addendum design:

1. **Canonical product SoT is `catalog_products`** (Supabase). There is **no Prisma**. The similarly named table `canonical_products` is only a **URL-keyed page-preview cache**, not the catalogue.

2. **Today’s ProductResolver always writes a `catalog_products` row** — including `UNVERIFIED` / `UNRESOLVED` placeholders — so creator UI never waits on providers. That behavior is **incompatible** with the user-ingestion rule “do not auto-promote unknown products into the catalogue.” Reuse must be **lookup + enrichment**, with a **new stop-before-create** branch (or parallel “resolve for user” mode) — not a blind call to `resolveIngestDrafts` as it exists today.

3. **Bag is Cart** (`cart_items`, route `/cart`, copy “Bag”). Membership is **hard-FK’d to `catalog_products`**. Supporting discovered-only products requires the **smallest** Bag model change: allow a Bag line to reference either a catalogue id **or** a new discovered-product id, without exposing that distinction in UX.

Infrastructure already present and reusable: BullMQ + Redis (with in-process fallback), `video_extraction_cache` (global video extract reuse), `parseSupportedVideoUrl` / `sourceIdentity`, `MerchantEnrichmentService` / `previewProductLink`, `LocalCatalogSearch`, `ShoppingResolver` (click-time only), Collection media embeds, AI review keyed by catalogue id.

Missing for Discover Anywhere: user-import API + models, global content-source identity beyond video-extract cache, discovered-product storage, Bag polymorphism, Android `ACTION_SEND` share-in, decision-oriented Product Page route/composition, SSRF hardening, ingest rate limits.

**Verdict:** The codebase can support the domain split (Canonical / Discovered / Bag / Content Source / User Import) **cleanly with minimal additive tables**, if Product Intelligence is extended with a **non-promoting resolve mode** and Cart is extended to accept discovered ids. Do not duplicate creator extraction or invent a second matcher.

---

# 2. Current Mystash Architecture

## 2.1 System context

```text
Expo 54 / React Native 0.81 (expo-router)
      │  JWT Bearer + Supabase client
      ▼
Express API (backend/, PORT typically 8787)
      │
      ├── Supabase (Postgres + Auth + Storage)
      ├── Redis + BullMQ (optional; in-process fallback)
      ├── OpenAI / Google Vision / Serper|CSE / Tavily
      ├── yt-dlp + ffmpeg (video stages)
      └── Shopping redirect (ShoppingResolver)
```

Evidence: `backend/docs/ARCHITECTURE.md`, root `package.json`, `backend/src/index.ts`, `backend/src/worker.ts`.

## 2.2 Client (React Native — not Flutter)

| Concern | Reality |
|---------|---------|
| Framework | Expo `~54.0.33`, RN `0.81.5`, `expo-router` `~6.0.23` |
| Entry | `"main": "expo-router/entry"` |
| Navigation | File routes under `app/`; tabs via `components/chrome/AppTabBar.tsx` |
| State | React Context (`AuthContext`, `CartContext`, `ThemeContext`) + local hooks; **no** Redux/Zustand |
| API layer | `src/services/*` (cart, collection, engagement, search, curation, shoppingClick, …) |
| Scheme | `mystash://` (`app.json`); Android VIEW/BROWSABLE only |
| Analytics | `trackProductEvent` → console/`curationLog`; Engagement HTTP; **no** Amplitude/Mixpanel/Sentry SDK in app deps |

Primary routes:

| Route | Role |
|-------|------|
| `app/(tabs)/index.tsx` | Home reels feed |
| `app/(tabs)/search.tsx` | Search (out of scope for redesign) |
| `app/(tabs)/create/*` | Creator curation / ingest |
| `app/(tabs)/profile.tsx` | Personal profile |
| `app/collection/[collectionId].tsx` | Collection = primary commerce surface |
| `app/cart.tsx` | Bag UI |
| `app/reel/*` | Immersive reel stacks |
| `app/creator/[username].tsx` | Public creator |
| `app/profile/saved.tsx` | Saved **collections** (not products) |
| `app/product-list/[id].tsx` | Deprecated → redirects to collection |

## 2.3 Backend modules (relevant)

| Module | Path | Responsibility |
|--------|------|----------------|
| HTTP + ingest entry | `backend/src/index.ts` | `/ingest`, `/ingest/manual`, publish hooks, embeds workers |
| Progressive extract | `backend/src/stages/orchestrator.ts` | Stage 1→2→3 multimodal pipeline |
| Product Intelligence | `backend/src/product-intelligence/*` | Normalize → match → enrich → verify → catalog write |
| Catalog BC | `backend/src/catalog/CatalogService.ts` | Application boundary over `catalog_products` |
| Cart | `backend/src/cart/*` | Authenticated membership SoT |
| Shopping | `backend/src/shopping/*` | Destination resolve + redirect |
| Collection | `backend/src/collection/*` | Recommendation package + tags + media |
| Engagement | `backend/src/engagement/*` | Follow, save collection, views, likes |
| AI Review | `backend/src/ai-review/*` | Gemini reviews keyed by catalog product |
| Search | `backend/src/search/*` | Blended search (do not redesign) |

## 2.4 Persistence

- **Supabase SQL migrations** under `supabase/migrations/`.
- **No Prisma / no `schema.prisma`** anywhere in the repo.
- Express uses service-role Supabase client for pipeline writes; app uses user JWT + selected public reads.

---

# 3. Existing Creator Ingestion — Exact Flow

Two entry paths converge on the same Product Intelligence core.

## 3.1 Path A — Automatic video URL ingest

| Step | File | Symbol | Responsibility | Reuse for user ingest? |
|------|------|--------|----------------|------------------------|
| 1. HTTP accept | `backend/src/index.ts` | `POST /ingest` | JWT auth; parse URL; create/reuse `ingest_requests`; enqueue | Pattern for User Import API; **not** the same ownership (creator collection vs personal bag) |
| 2. Source identity | `backend/src/pipeline/sourceIdentity.ts` | `parseSupportedVideoUrl` | YouTube Short / IG Reel\|post → `{platform, externalId, canonicalUrl}` | **Yes** — global content identity for video URLs |
| 3. Queue | `backend/src/workers/queue.ts` | `enqueueIngestPipeline` | BullMQ `ingest-pipeline`, jobId `ingest-{id}`, 3 attempts | **Yes** — same async infra |
| 4. Worker | `backend/src/workers/ingestPipelineWorker.ts` | `startIngestPipelineWorker` | Runs progressive pipeline | **Yes** |
| 5. Orchestrate | `backend/src/stages/orchestrator.ts` | `runProgressiveIngestPipeline` | Stage 1→2→3 extract | **Yes** for Reel/Short URLs |
| 6. Extract cache | `backend/src/services/extractionCache.ts` | `getVideoExtractionCache` / `setVideoExtractionCache` | Global cache by platform + external video id + pipeline versions → `video_extraction_cache` | **Yes** — already global cross-user reuse of extract results |
| 7. Context | `pipeline/youtubeContext.ts`, `instagramContext.ts`, `context/ContextBuilder.ts` | gather* / build | Metadata, transcript, title | **Yes** |
| 8. AI product candidates | `providers/reasoner/OpenAiReasonerProvider.ts` | reasoner | LLM → `ProductCandidate[]` | **Yes** — do not build a second extractor |
| 9. Validate / rank | `products/ProductValidator.ts`, `ProductRanker.ts` | `validate` / `rank` | Deterministic cleanup | **Yes** |
| 10. Stage gate | `stages/gate.ts` | `stagePass` / `needsStage2Enrichment` | Confidence/count → deeper stages | **Yes** |
| 11. Frames / vision | `media/FrameExtractor.ts`, `CompositeMediaUnderstanding.ts` | extract / understand | yt-dlp + ffmpeg + OCR/logo/scene | **Yes** when needed |
| 12. Persist drafts | `products/productPersist.ts` | `persistPipelineProducts` | Insert `ingest_draft_products` (`provider='ai_extract'`, `resolution_status='UNRESOLVED'`) | Staging pattern only; drafts are **ingest-scoped**, not global discovered products |
| 13. Resolve | `product-intelligence/index.ts` | `resolveIngestDrafts` | Loads drafts → `ProductResolver.resolveIngest` | **Partial** — see §4 / §11 (must not auto-create catalogue for user misses) |
| 14. Publish | `publish.ts`, `publishVideoProjection.ts` | `handlePublishIngest` | Creator review → `collections` + tags + `videos` / `video_products` | **No** for user flow (users do not “publish collections” from Discover Anywhere) |

## 3.2 Path B — Manual product URLs on a video ingest

| Step | File | Symbol | Responsibility | Reuse? |
|------|------|--------|----------------|--------|
| Input | `index.ts` | `POST /ingest/manual` | Video URL + 1–5 product page URLs | Closest existing “URL → enrich → resolve” for **product pages** |
| Create | `manualIngest.ts` | `createManualIngest` | Enrich each product URL, insert ingest + drafts (`provider='manual'`) | Enrichment + draft shape |
| Enrich | `MerchantEnrichmentService` + `previewProductLink` | `enrich` | Scrape/Tavily/AI page preview | **Yes** |
| Resolve | `resolveIngestDrafts(..., { creatorSuppliedUrl: true })` | — | Treats merchant URL as identity seed | **Lookup + enrich reuse**; **not** full promote-on-miss |
| Append | `manualProductAppend.ts` | `appendManualProductsToIngest` | Mid-draft add product URLs | Pattern for multi-product URLs |

## 3.3 Shared post-extract resolve hook

`stages/orchestrator.ts` calls `resolveIngestDrafts(admin, ingestRequestId, traceId)` after draft persist. Manual path uses the same function with `creatorSuppliedUrl` / `creatorSuppliedUrlForExternalIds` so AI drafts are never accidentally treated as creator-supplied URLs (`manualProductAppend.ts` comment).

---

# 4. Existing Product Resolution — Exact Flow

## 4.1 Orchestration entry

**Primary shared entry today:**  
`backend/src/product-intelligence/index.ts` → **`resolveIngestDrafts`**  
→ `createProductIntelligence` (`factory.ts`)  
→ **`ProductResolver.resolveIngest` / `resolveOne`** (`resolver/ProductResolver.ts`).

**Lower-level enrichment (no catalogue match):**  
`MerchantEnrichmentService.enrich` → `pipeline/productLinkPreview.ts` → `previewProductLink` (writes/reads `canonical_products` preview cache).

## 4.2 `ProductResolver.resolveOne` — actual sequence

Evidence: `ProductResolver.ts` `resolveOne`.

```text
AiDraftInput
  → ProductNormalizer.normalize
  → scoreProductSpecificity
       [not searchable] → upsertCatalog(UNVERIFIED) → finish   ⚠️ always creates/updates catalog
  → CatalogService.localSearch (LocalCatalogSearch)
       [VERIFIED hit ≥ catalogHitMinScore] → createOrUpdateFromResolve(existing) → finish  ✅ reuse
  → else SearchStrategy.search (TavilyEnrichedPdpSearchStrategy)
       → Serper / Google CSE discovery
       → CandidateShortlister + PdpClassifier
       → MerchantEnrichmentService
  → MatchScorer + MetadataMergeService
  → ShoppingDestinationResolver + decideProductVerification
  → CatalogService.createOrUpdateFromResolve / createFromResolve   ⚠️ creates even UNVERIFIED/UNRESOLVED
  → DraftUpdater + product_match_history
  → optional enqueueProductResolve (background retry)
```

**Critical behavioral rule (creator path):** on search failure the resolver **still** creates an `UNRESOLVED` catalogue row so “UI never depends on external providers” (`ProductResolver.ts` comment ~L270).

## 4.3 Local catalogue match order

`LocalCatalogSearch.search` (`product-intelligence/catalog/LocalCatalogSearch.ts`):

1. `merchant_url` (if hint present)  
2. Exact `normalized_name` (+ brand/model/category compatibility)  
3. Alias (`catalog_aliases`)  
4. Brand + model  
5. Fuzzy Dice ≥ 0.72 (prefer VERIFIED on ties)

Resolver **reuses** a local hit only when `score ≥ catalogHitMinScore` **and** `verificationStatus === 'VERIFIED'`.

## 4.4 What should become the shared product-resolution entry for user ingest

| Layer | Recommendation |
|-------|----------------|
| **Reuse as-is for lookup** | `ProductNormalizer`, `scoreProductSpecificity`, `CatalogService.localSearch` / `LocalCatalogSearch`, `MatchScorer`, enrichment stack (`MerchantEnrichmentService`, `previewProductLink`) |
| **Do not call blindly** | Full `resolveIngestDrafts` / `ProductResolver.resolveOne` as implemented — they **promote misses into `catalog_products`** |
| **Smallest shared entry to introduce later** | A new mode on `ProductResolver` (e.g. `resolveForUserImport` / `promoteOnMiss: false`) **or** a thin `resolveProductCandidate` that returns `{ kind: 'catalog_hit', product } \| { kind: 'discovered', payload }` without writing catalogue on miss |

**Do not** revive `products/catalogMatcher.ts` — it is a deprecated noop.

**Do not** invent a second Serper/Tavily/AI matching stack.

---

# 5. Existing Canonical Product Model

## 5.1 Canonical table

| Question | Answer (from repo) |
|----------|-------------------|
| Canonical product table | **`public.catalog_products`** (`supabase/migrations/20260728200000_product_intelligence_catalog.sql`) |
| Application type | `CatalogProduct` in `product-intelligence/domain/types.ts`; writes via `CatalogService` |
| **Not** catalogue | `public.canonical_products` — preview cache keyed by `canonical_url` (`20260511150000_canonical_products.sql`) |

## 5.2 Identity fields

| Field | Role |
|-------|------|
| `id` (uuid) | Primary key |
| `canonical_slug` | UNIQUE public identity |
| `normalized_name` | Match key |
| `(brand, model)` | Match key |
| `merchant_url` | Match + shopping |
| `catalog_aliases.alias` | Alternate names |
| `status` | `ACTIVE` \| `DISCONTINUED` \| `MERGED` \| `HIDDEN` |
| `merged_into_id` | Survivor pointer |
| `verification_status` | `VERIFIED` \| `UNVERIFIED` \| `UNRESOLVED` (internal trust — already surfaced on FE as badges today) |

## 5.3 How existing vs new is decided (creator path)

- Draft already has `catalog_product_id` → update in place via `createOrUpdateFromResolve`.  
- Local **VERIFIED** hit above threshold → reuse that id.  
- Otherwise → **`createFromResolve`** / upsert creates a **new** catalogue row (often UNVERIFIED/UNRESOLVED).  
- Gate `ingestDraftNeedsProductResolve` skips drafts already resolved with catalogue id.

## 5.4 Where AI enters

| Role | Location |
|------|----------|
| Video product draft extraction | `OpenAiReasonerProvider` (stages) |
| Vision / scene / OCR / logo | OpenAI + Google Vision providers |
| Weak page scrape fallback | `previewProductLink` (Tavily + GPT) |
| Post-catalogue AI review | `ai-review/` (Gemini) → `product_ai_reviews` — **requires catalogue id** |

## 5.5 Persisted product fields (high level)

Required-ish: `canonical_slug`, `name`, `normalized_name`, `status`, `verification_status`.  

Common optional: brand, model, category, description, image_url, merchant, merchant_url, preferred_shopping_url, affiliate_url, shopping_provider, price, currency, rating, review_count, availability, verification_*, confidence fields, `metadata` jsonb (specs, gallery, offers, provenance, shoppingSelection, scores).

## 5.6 Merchant / offer relationships

- **No** separate `offers` / `merchants` tables.  
- Offers live as columns + `metadata.offer` / `metadata.shopping_candidates` / `metadata.shoppingSelection`.  
- Ingest-time destination pick: `ShoppingDestinationResolver`.  
- Click-time authority: **`ShoppingResolver`** (`backend/src/shopping/ShoppingResolver.ts`) via `GET /products/:id/redirect` (`productRedirect.ts`).  
- Client **must not** choose merchant destinations; it calls `openProductShopping` (`src/services/shoppingClick.ts`) only.

---

# 6. Existing Bag Architecture

## 6.1 Does “My Bag” exist?

- Product copy noun is **“Bag”** (`src/ui/contracts.ts` `BAG_COPY`), not “My Bag”.  
- Screen: `app/cart.tsx` → `CartScreen`, route **`/cart`**.  
- Backend: `backend/src/cart/` — `GET /cart`, `POST /cart/items`, `DELETE /cart/items/:catalogProductId`.  
- State: `contexts/CartContext.tsx` loads/mutates via `src/services/cartApi.ts`.  
- Add path: `useProductAddToCartHandler` in `src/services/productActionOrchestration.ts` (auth-gated).

## 6.2 Database model

`public.cart_items` (`20260811120000_cart_domain.sql`):

- `user_id` + **`catalog_product_id` NOT NULL FK → `catalog_products`**  
- UNIQUE `(user_id, catalog_product_id)`  
- Optional source attribution: `source_collection_id`, `source_creator_id`, `source_collection_product_tag_id`, `source_surface` ∈ `COLLECTION|SEARCH|PRODUCT_DETAILS|OTHER`

Domain rule (`CART_DOMAIN_SPEC.md`, `CartService`): Cart = membership SoT; Catalog = Product SoT.

## 6.3 Assumes canonical product?

**Yes.** `CartService.addItem` calls `catalog.resolveActiveProduct` and stores the **survivor** catalogue id. There is no path to add a product without a catalogue id.

## 6.4 Saved / Collections vs Bag

| Concern | Bag | Saved |
|---------|-----|-------|
| Entity | Catalogue product | Collection |
| API | `/cart` | Engagement save collection |
| Screen | `/cart` | `app/profile/saved.tsx` |
| Reuse | Shared `ProductCard` / sheet UI | Different membership model |

## 6.5 Smallest change for canonical OR discovered (UX-hidden)

Without implementation in this phase, the minimal design intent is:

1. Keep Bag as **user ↔ product-memory membership**.  
2. Extend membership to reference **either** `catalog_product_id` **or** `discovered_product_id` (check constraint: exactly one).  
3. Hydrate Bag list through a single projection DTO that looks the same to the client (`title`, `image`, `price`, `merchantHint`, `buyAvailable`, `source`).  
4. Shopping redirect / AI review / compare features that require catalogue identity remain available only when the line resolves to a catalogue product (or after later promotion).  
5. **Do not** surface verification/confidence on Bag rows for Discover Anywhere.

Existing `source_*` columns are a starting point for attribution but today assume collection/creator surfaces — user-import source will need an additive source surface / FK (see §12).

---

# 7. Existing Product Page Architecture

## 7.1 There is no standalone PDP route

Product UX today:

| Layer | Path | Role |
|-------|------|------|
| Host | `app/collection/[collectionId].tsx` | Loads collection detail |
| Screen | `components/collection/CollectionScreen.tsx` | Product list, related rail, AI review card |
| “Product page” | `components/commerce/ProductDetailsSheet.tsx` | Modal sheet (~90% height) |

Legacy `app/product-list/[id].tsx` only redirects to `/collection/{id}`.

## 7.2 Current sheet composition (top → bottom)

Evidence: `ProductDetailsSheet.tsx`:

1. Image gallery (dominant)  
2. Brand, title, **VerificationBadge**, merchant line, price, availability  
3. Description  
4. **SpecificationGrid**  
5. **MerchantSection** (sold by / last verified / badge)  
6. Add to Bag / Buy  

Comment in sheet notes future ratings/offers/similar — **not built**. AI reviews live on Collection (`ProductAiReviewCard` / `AiReviewSheet`), not inside the details sheet. **No compare UI.**

## 7.3 Data sources

- Collection hydrate: `loadCollectionDetail` / `fetchCatalogProductsByIds`  
- Related: `loadCollectionRelatedProducts` → search blended (not a graph edge)  
- AI review: `fetchProductAiReview(catalogProductId)` → `GET /products/:id/ai-review`  
- Buy: parent → `openProductShopping` → backend redirect  
- Bag: `onAddToCart` → Cart APIs  

## 7.4 Gap vs desired decision-oriented Product Page

Desired priority: merchants/prices → discovery Reel → related media → reviews → compare → specs last.

| Capability | Today | Reuse |
|------------|-------|-------|
| Merchant / buy | Single merchant section + ShoppingResolver redirect | **Yes** — extend presentation toward multi-offer when metadata has candidates |
| Prices across merchants | Partial in `metadata.shopping_candidates` (ingest-time); UI shows primary | Reuse metadata + ShoppingResolver; UI work later |
| Original Reel / Short | `CollectionMediaReference` on Collection | Reuse embeds; Product surface needs source linkage |
| Related Reels/media | Collection “more from creator” / related products rail | Partial |
| Reviews | AI review for catalogue products | Reuse for catalogue hits; discovered needs policy |
| Compare | Search intent label only; **no** compare screen | Build later |
| Specs | SpecificationGrid prominent | Demote in future composition |
| Verification badges | Shown on ProductCard / Details / Merchant | **Must hide** for Discover Anywhere UX (rule 9–10) |

---

# 8. Existing Content / Creator / Source Architecture

## 8.1 Dual content model

| Layer | Tables | Role |
|-------|--------|------|
| Collection SoT | `collections`, `collection_media`, `collection_product_tags` | Creator recommendation package |
| Feed projection | `videos`, `video_products` | Dual-write on publish (`publishVideoProjection.ts`) |

`collection_media` stores external refs (`source_url`, `canonical_url`, `source_provider`, `external_id`, `media_kind`). Index on `(source_provider, external_id)` is **not UNIQUE** — per-collection, not global content identity.

## 8.2 Creator / user

- Auth: Supabase Auth JWT.  
- App user: `public.users` 1:1 with `auth.users` (`UserService.ensureFromAuth`).  
- Creator capability: `creator_status`; publishing collections requires active creator.

## 8.3 Product ↔ content links

- `collection_product_tags.catalog_product_id` (+ `tag_source` ∈ `ai|manual|import`)  
- `video_products.catalog_product_id`  
- `ingest_draft_products` during curation only  

## 8.4 Can a user-shared URL already be represented globally?

| Mechanism | Scope | Sufficient for Discover Anywhere? |
|-----------|-------|-------------------------------------|
| `ingest_requests` | **Per-user** (`user_id` + `source_url`) | Represents User Import act, not global content |
| `video_extraction_cache` | **Global** extract payload by platform + external id | Strong reuse for **video** AI extract |
| `canonical_products` | **Global** product-page preview by URL | Enrichment cache only |
| `collection_media` | Per collection | Not a global source registry |
| Published `videos` / `collections` | Creator-published content | Not automatic for arbitrary user shares |

**Conclusion:** Video extract caching exists; a first-class **global content/source** entity for “URL X has been processed (products Y…)” for user shares does **not** exist yet. Smallest addition is proposed in §12.

## 8.5 Supported URL types today

`parseSupportedVideoUrl` accepts only YouTube Shorts/watch and Instagram Reel/post. Product page URLs are accepted on **manual ingest**, not on automatic `/ingest`. Arbitrary retail hosts are **not** a first-class video ingest type.

---

# 9. Existing Async / Queue / Worker Infrastructure

| Queue | File | Attempts | Purpose |
|-------|------|----------|---------|
| `ingest-pipeline` | `workers/queue.ts` | 3, exponential | Progressive video extract |
| `product-resolve` | `product-intelligence/jobs/productResolveQueue.ts` | 5 | Background resolve retries |
| `product-ai-review` | `ai-review/jobs/productAiReviewQueue.ts` | 3 | AI review generation |

Redis: `workers/redisConnection.ts` (`REDIS_URL`, optional unless `REDIS_REQUIRED=true`). Soft degradation to in-process when Redis unavailable.

Workers:

- Standalone: `backend/src/worker.ts` → ingest pipeline only (`npm run worker` in `backend/package.json`).  
- Embedded: API process can start product-resolve + AI-review (+ optionally ingest) when configured.

**Do not propose a new queue product** until user-import jobs prove they cannot share `ingest-pipeline` and/or a thin `user-import` job on the same BullMQ/Redis stack.

---

# 10. Existing Caching / Deduplication

| Mechanism | Key | Scope | Notes |
|-----------|-----|-------|-------|
| `video_extraction_cache` | platform + external_video_id + pipeline/provider versions | Global | Avoids re-running expensive multimodal extract |
| `canonical_products` | canonical product page URL | Global | Preview TTL (~24h in `productLinkPreview.ts`) |
| `catalog_search_candidates` | query + provider | Global TTL | Discovery candidate cache |
| Ingest request reuse | `user_id` + source URL, last 24h | **Per-user** | `index.ts` / `manualIngest.ts` — does **not** share ingest rows across users |
| Cart uniqueness | `(user_id, catalog_product_id)` | Per-user | Idempotent add |
| Product URL identity helpers | `canonicalizeProductUrl` / `externalIdForProductUrl` | Helpers | Used in preview/manual paths |

**Desired future:** User A and User B share URL X → reuse processed content/product results. **Partial today** via `video_extraction_cache` + preview cache; **missing** a global processed-content registry + shared discovered/catalogue outcome binding. Do not implement in Phase 0.

---

# 11. Proposed User URL Ingestion Architecture

Conceptual convergence (no implementation):

```text
CREATOR (existing):
  Creator content → Progressive ingest → ProductResolver (promote OK)
    → catalog_products → Collection tags → publish

USER (new):
  Share URL → User Import (user-scoped act)
    → Content Source (global identity; process once when possible)
    → Reuse extract cache / existing pipeline extractors
    → Shared resolution LOOKUP (LocalCatalogSearch + enrichment)
         ├─ VERIFIED/acceptable catalogue hit → bind canonical product
         └─ miss → Discovered Product (NOT catalog_products)
    → Bag item (canonical OR discovered) + source attribution
```

Rules:

- One shared URL may yield **multiple** products.  
- Internal fields (match confidence, verification, completeness, processor version, promotion eligibility) stay **server-side**.  
- User UX: “Saved to Bag” — no UNVERIFIED / confidence / incomplete-metadata surfaces for this flow.  
- Client never picks merchant destinations — continue using ShoppingResolver for catalogue-backed buys; define later policy for discovered-only buy (e.g. stored merchant URL via backend redirect wrapper, or buy disabled until promotion).

**Explicit incompatibility to resolve in implementation phases:**  
Calling today’s `resolveIngestDrafts` on user imports would **create catalogue rows on miss**, violating the product rule. Implementation must add a non-promoting resolve path that still **reuses** normalizer, local search, and enrichment.

---

# 12. Proposed Minimal Data Model Additions

Do **not** implement. Prefer additive tables over overloading creator ingest rows as global discovery SoT.

## 12.1 User import / submission

**Proposed:** `user_imports` (name illustrative)

| Concern | Proposal |
|---------|----------|
| Why | Persist “this user shared this URL” independently of processing outcome |
| Existing? | Closest: `ingest_requests` — **creator-curation owned**, status machine tied to collection publish; RLS owner-only; 24h per-user reuse. Reusing it would conflate creator pipeline with personal Discover Anywhere |
| Scope | **User-scoped** |
| Uniqueness | Idempotent `(user_id, canonical_source_key)` or allow multi-share with soft dedupe; link to global content source id |
| Fields (sketch) | id, user_id, raw_url, content_source_id, status (`accepted|processing|ready|failed`), error_class, created_at |

## 12.2 Globally identifiable content / source

**Proposed:** `content_sources` (or `shared_sources`)

| Concern | Proposal |
|---------|----------|
| Why | “URL/content X has been processed”; enable cross-user reuse |
| Existing? | `video_extraction_cache` covers **extract payload** for supported videos but not a full process graph (products extracted, discovered ids, catalogue binds). `collection_media` is per-collection |
| Scope | **Global** |
| Uniqueness | UNIQUE `(provider, external_id)` for YT/IG; UNIQUE `canonical_url` for product pages / other hosts |
| Fields (sketch) | identity, media_kind, processing_status, pipeline_version, last_processed_at, extraction_cache_key ref |

## 12.3 Products extracted from that content

**Proposed:** `content_source_products` (join)

| Concern | Proposal |
|---------|----------|
| Why | Many products per source; order; link to catalogue **or** discovered |
| Existing? | `ingest_draft_products` is ingest-scoped + CASCADE; not global. `collection_product_tags` are creator-collection scoped |
| Scope | **Global** (tied to content_source) |
| Uniqueness | `(content_source_id, extract_fingerprint)` or external_id within source |

## 12.4 Discovered product (non-catalogue)

**Proposed:** `discovered_products`

| Concern | Proposal |
|---------|----------|
| Why | Persist extract/enrichment when no catalogue hit — **without** writing `catalog_products` |
| Existing? | `ingest_draft_products` / UNVERIFIED catalogue rows are **not** acceptable substitutes (wrong lifecycle / violates catalogue purity) |
| Scope | **Global** (same URL/product extract reusable across users) with optional per-user overlay later if needed |
| Uniqueness | Prefer stable hash of (canonical merchant URL) or (normalized name+brand+source) — exact key TBD in implementation |
| Internal-only fields | match_status, confidence, completeness, missing_fields, extraction_source, processor_version, promotion_eligible_at, catalog_product_id nullable (set on later promotion) |
| User-facing projection | name, image, price, merchant label only |

## 12.5 User Bag relationship

**Proposed change to `cart_items` (or additive bag table if Cart BC must stay catalogue-pure)**

| Option | Tradeoff |
|--------|----------|
| **A. Extend `cart_items`** with nullable `discovered_product_id` + CHECK exactly one of catalogue/discovered | Smallest; keeps Bag UI/API; loosens Cart domain invariant |
| **B. New `bag_items` parallel to cart** | Cleaner domain split; more FE/API duplication |

**Recommendation:** Prefer **A** if product accepts evolving Cart → “personal product memory”; else B with shared hydration. Either way, FE continues to say “Bag”.

Also extend `source_surface` (or additive column) for `USER_IMPORT` / `CONTENT_SOURCE`.

## 12.6 Bag item ↔ original discovery source

| Concern | Proposal |
|---------|----------|
| Why | Product Page needs “original Reel/Short” |
| Existing? | `cart_items.source_collection_*` assumes creator collections |
| Addition | `source_content_id` / `source_user_import_id` on bag line (first-write attribution) |

## 12.7 What not to add

- Second AI extractor / matcher.  
- Prisma.  
- Microservice.  
- New Redis product unless BullMQ capacity forces isolation.  
- User-facing verification tables.  
- Search index redesign in this initiative.

---

# 13. Reuse vs Build

| Capability | Existing Code | Reuse | New Work | Notes |
|------------|---------------|-------|----------|-------|
| URL/share capture | Outbound `shareLinks.ts`; Android `mystash://` VIEW only; **no** `ACTION_SEND` | Partial (deep link scheme) | Android share-intent receiver + RN handler; iOS share extension later | Do not implement in Phase 0 |
| User import | `ingest_requests` (creator) | Pattern only | `user_imports` API + model | Keep separate from creator ingest ownership |
| Content/source identity | `parseSupportedVideoUrl`; `video_extraction_cache`; `collection_media` | Yes for video identity + extract cache | Global `content_sources` registry | Product-page URLs need URL canonicalization already in preview helpers |
| Async processing | BullMQ ingest / product-resolve / AI-review | Yes | User-import job type or reuse ingest-pipeline with different sink | Prefer existing Redis stack |
| Product extraction | Progressive orchestrator + OpenAiReasoner + validators | **Yes** | Wire user content_source into same extractors | No duplicate extractor |
| Existing catalog lookup | `LocalCatalogSearch` / `CatalogService.localSearch` | **Yes** | Call from non-promoting resolve mode | |
| Product matching | `MatchScorer`, specificity, PDP classifier | **Yes** | Same | |
| Existing canonical-product reuse | VERIFIED local hit path in `ProductResolver` | **Yes** | Bind bag to `catalog_products.id` | |
| Existing AI fallback | Reasoner + `previewProductLink` + UNVERIFIED catalogue create | Enrichment **yes**; catalogue create on miss **no** for user | Discovered persistence instead of `createFromResolve` on miss | Critical fork |
| Discovered product storage | None first-class | — | `discovered_products` (+ join) | Do not misuse `canonical_products` or UNVERIFIED catalogue rows |
| Bag insertion | `CartService` / `/cart` / `CartContext` | Yes for catalogue hits | Polymorphic bag line OR parallel bag | Hide distinction in UX |
| Source attribution | `cart_items.source_*` | Partial | Content source / user import FKs | |
| Merchant offers | metadata + ShoppingDestinationResolver | Yes | Multi-offer Product Page UI later | |
| ShoppingResolver | `ShoppingResolver` + `/products/:id/redirect` | **Yes** for catalogue | Policy for discovered-only buy | Client must not invent destinations |
| Product Page | `ProductDetailsSheet` + Collection host | Components yes | Decision-oriented composition + optional `/product/...` route; hide verification for this flow | Specs demoted |
| Reels/media | `CollectionMediaReference`, reel routes, embeds | Yes | Attach source media to Product Page | |
| Reviews | `ai-review` + FE sheets | Yes when catalogue id exists | Discovered review policy TBD | |
| Compare | Search intent label only | Minimal | Future compare surface | Out of early phases |

---

# 14. Scalability Assessment

Assessed from **current** architecture (no invented capacity numbers).

| Pressure | Current reality | Bottleneck risk |
|----------|-----------------|-----------------|
| Millions of users / bag membership | `cart_items` simple unique membership; hydrated via catalogue reads | Manageable if indexes retained; polymorphic bag needs careful indexing |
| Concurrent ingest | BullMQ workers + optional embedded workers; Redis optional | yt-dlp/ffmpeg + OpenAI/Vision are **CPU/GPU and $** bottlenecks, not Postgres row inserts |
| Duplicate URLs across users | Global `video_extraction_cache` helps video extract; ingest rows still per-user | Without `content_sources`, duplicate user imports still create redundant resolve/bag work |
| Duplicate products | Catalogue + aliases + local search; resolver may still create many UNVERIFIED rows today | User path must avoid catalogue pollution; discovered table needs dedupe keys |
| Expensive AI/enrichment | Cached extract + preview TTL + search candidate cache | Good foundations; still need global process memoization for user shares |
| Multiple workers | Supported via BullMQ | Idempotent job ids already used for ingest (`ingest-{id}`); user-import jobs need same discipline |
| Cart/catalogue coupling | Every bag line requires ACTIVE catalogue product | Blocks discovered-only memory until model change |

**Current bottlenecks (observed in design):** external AI/search providers, media download/ffmpeg, lack of global user-share process identity, catalogue write-on-miss behavior amplifying catalogue growth.

---

# 15. Security / Reliability Risks

Accepting arbitrary user URLs (future) raises:

| Risk | Current mitigation | Gap |
|------|--------------------|-----|
| SSRF | `validHttpUrl` allows only http/https; `productLinkPreview` fetch follows redirects | **No** private IP / metadata IP / DNS rebinding controls found |
| Redirect chains | `redirect: 'follow'` on scrape | Need max redirects + final-host policy |
| Timeouts / size | ~18s timeout + ~900KB cap on manual scrape | Keep and apply to all user-fetch paths |
| Unsafe schemes | Protocol check | Continue reject `file:`, `ftp:`, etc. |
| AuthZ | Ingest/cart require JWT | User import must be authenticated; no anonymous durable bag (Cart V1 rule) |
| Abuse / rate limit | **No** HTTP per-user rate limit on `/ingest*` (only provider backoff helpers) | Required before public share-in |
| Provider failure | UNRESOLVED catalogue placeholder (creator) | User path should mark import failed/partial **without** catalogue spam |
| Content safety | Moderation tables exist for creator ingest | Policy for user-shared URLs TBD |

Do not implement controls in Phase 0; track them as Phase gates before enabling arbitrary URL fetch.

---

# 16. Recommended Implementation Phases

Search redesign remains **out of scope**.

### Phase 0 — Architecture audit (this document)
Complete. Stop for review.

### Phase 1 — Share capture (platform plumbing)
- Android `ACTION_SEND` text/URL into app (and later iOS).  
- Authenticated accept endpoint that records User Import only (fast ACK).  
- No processing yet beyond validation of supported URL shapes.

### Phase 2 — User Import + Content Source
- Persist user_imports + content_sources with idempotency.  
- Wire async job on existing BullMQ.

### Phase 3 — Async processing reuse
- For YT/IG: reuse progressive extract + `video_extraction_cache`.  
- For product URLs: reuse `MerchantEnrichmentService` / `previewProductLink`.  
- Multi-product candidates per source.

### Phase 4 — Shared resolution without catalogue pollution
- Extract/reuse `LocalCatalogSearch` + normalizer + enrichment.  
- Add **non-promoting** resolve mode.  
- On hit → canonical product; on miss → discovered_products.

### Phase 5 — Bag
- Extend Bag membership for canonical OR discovered.  
- Attribution to content source / user import.  
- UX: “Saved” only.

### Phase 6 — Product Page (decision-oriented)
- Reorder surfaces: merchants/prices, original media, related media, reviews, compare, specs last.  
- Hide verification/confidence for Discover Anywhere.  
- Keep ShoppingResolver as buy authority for catalogue-backed items.

### Phase 7 — Merchant prices / multi-offer presentation
- Present existing shopping candidate metadata; still resolve clicks server-side.

### Phase 8 — Media / Reels attachment on Product Page

### Phase 9 — Reviews (catalogue-backed first)

### Phase 10 — Compare
- Product Page → `/compare?ids=` (2–4 products).
- Reuse `GET /products/:id/page` + existing product search picker.
- Facts only; missing cells stay empty; no winner/score.

Optional later: promotion pipeline discovered → catalogue (ops/AI quality gates) — **not** automatic on user share.

---

# 17. Final Recommendation

Proceed with Discover Anywhere as an **addendum** that converges on existing Product Intelligence **lookup/enrichment**, Collection media patterns, Cart/Bag UX, and ShoppingResolver — while introducing **minimal new models** for User Import, global Content Source, and Discovered Product, plus a **non-promoting resolve mode**.

Do **not** call today’s full `resolveIngestDrafts` for user misses. Do **not** redesign Search. Do **not** implement until this audit is reviewed.

## REUSE

- `parseSupportedVideoUrl` / `sourceIdentity`  
- Progressive ingest stages + `OpenAiReasonerProvider` + validate/rank  
- `video_extraction_cache` / `extractionCache.ts`  
- `ProductNormalizer`, `scoreProductSpecificity`, `LocalCatalogSearch`, `MatchScorer`, PDP classifier / enrichment (`MerchantEnrichmentService`, `previewProductLink`)  
- `CatalogService` for **reads** and **canonical updates on verified hits only** (user path)  
- BullMQ + Redis workers (`ingest-pipeline`, patterns from `product-resolve`)  
- `ShoppingResolver` + `/products/:id/redirect` + `shoppingClick` client  
- Cart/Bag UI (`app/cart.tsx`, `CartContext`, commerce components) for membership UX  
- `ProductDetailsSheet`, `MerchantSection`, `CollectionMediaReference`, AI review stack (catalogue-backed)  
- Supabase Auth / `UserService`  
- Observability patterns (`ingestLog`, PI events, cart events)

## BUILD

- User Import API + `user_imports` (or equivalent) model  
- Global `content_sources` (+ `content_source_products` join)  
- `discovered_products` storage with internal quality/promotion fields  
- Non-promoting product-resolution mode (shared codepath, new sink on miss)  
- Bag membership support for discovered **or** canonical products + source attribution  
- Android (then iOS) share-in plumbing  
- Decision-oriented Product Page composition (and likely a first-class product route) that hides verification/confidence for this flow  
- SSRF / rate-limit / abuse controls before arbitrary URL fetch is production-enabled  
- (Later) discovered → catalogue promotion workflow — explicit, not automatic

---

**STOP.** No implementation until review.

---

# 18. Phase 1 Implementation Addendum

Phase 0 is otherwise unchanged. Three details surfaced while implementing share capture that
the audit could not have known; the Phase 1 developer doc is
[`mystash-user-ingestion-phase-1-share-capture.md`](./mystash-user-ingestion-phase-1-share-capture.md).

1. **`ACTION_SEND` cannot reach React Native unaided.** `expo-linking` only surfaces intents
   that carry a data URI, while a share carries its payload in `Intent.EXTRA_TEXT`. Share-in
   therefore needs a native bridging activity that re-emits the payload as a
   `mystash://import?text=…` `ACTION_VIEW` intent, which the existing deep-link path handles.
2. **`android/` and `/ios` are gitignored prebuild outputs.** Native share-in must be declared
   as an Expo config plugin (`plugins/withAndroidShareIntent.js`) so `expo prebuild`
   reproduces it; hand-edited native files would be lost.
3. **URL canonicalization had to be made importable.** `canonicalizeProductUrl` lived in
   `pipeline/productLinkPreview.ts`, whose module graph pulls in Tavily and OpenAI. It moved
   verbatim to `pipeline/urlCanonicalization.ts` and is re-exported from its old home, so the
   User Import domain can reuse the same tracking-strip rules without depending on the AI
   pipeline. Behaviour and all existing call sites are unchanged.

Model note: Phase 1 implements `user_imports` with per-user idempotency on
`(user_id, sha256(normalized_url))`, reusing the Cart unique-constraint convention
(`201` created / `200` existing) rather than the creator `ingest_requests` 24-hour window.
`discovered_products` remains unbuilt, as planned.

---

# 19. Phase 2 Implementation Addendum

Phase 0/1 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-2-content-source.md`](./mystash-user-ingestion-phase-2-content-source.md).

1. **Queue name vs pipeline.** Domain-specific jobs in this repo already use separate
   BullMQ queue names on the shared Redis (`ingest-pipeline`, `product-resolve`,
   `product-ai-review`). Content Source follows that convention with
   `content-source-processing` rather than stuffing a new payload into `ingest-pipeline`
   (whose worker runs `runProgressiveIngestPipeline`). Same technology, not a second
   extraction pipeline.
2. **No in-process fallback.** Creator ingest falls back to the progressive pipeline when
   Redis is down. User-content handoff must not: that fallback *is* product extraction.
   An enqueue failure leaves `content_sources.processing_status = RECEIVED` so a later
   share (or sweep) can retry. There is no outbox table in the repo; none was added.
3. **Extraction cache is identity-aligned, not called.** `(platform, external_id)` matches
   `video_extraction_cache` / `buildCacheKey`. Phase 2 does not read or write the cache.
4. **`user_imports.status` stays `RECEIVED`.** Processing state lives on `content_sources`.
   Collapsing them would mix user-scoped acknowledgement with global work.

---

# 20. Phase 3 Implementation Addendum

Phase 0–2 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-3-content-processing.md`](./mystash-user-ingestion-phase-3-content-processing.md).

1. **Processing identity is the content source.** The job may still carry `userImportId` for
   tracing. Candidates are persisted on `content_source_products` keyed by
   `content_source_id`. Multiple `user_imports` share one result; they are loaded only so a
   later phase can fan into Bags.
2. **No second extraction pipeline.** Video uses `runProgressiveExtract` (existing cache,
   context builders, `OpenAiReasonerProvider`, stage gates, frame/vision). Web uses
   `canonicalizeProductUrl` + `MerchantEnrichmentService` / `previewProductLink`.
3. **`READY` + `candidate_count = 0` is success.** No product is not a system failure and
   does not invent candidates.
4. **User-controlled fetches go through `safeFetch`.** Scheme, host, DNS, redirect re-check,
   timeout, and response size are applied before HTML scrape. Tavily Extract remains a
   provider-side fetch, not a second in-process scraper.
5. **Catalog, discovered products, and Bag are untouched.** `replaceProducts` writes only
   `content_source_products`. ProductResolver / ShoppingResolver / `resolveIngestDrafts`
   are not invoked on this path.

---

# 21. Phase 4 Implementation Addendum

Phase 0–3 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-4-resolution.md`](./mystash-user-ingestion-phase-4-resolution.md).

1. **One matcher, two sinks.** `ProductResolver.resolveIngest({ promoteOnMiss })` is the
   existing path. Creator default remains `true` (UNVERIFIED/UNRESOLVED catalogue rows).
   User import is `resolveForUserImport` → `promoteOnMiss: false`. A miss returns a
   discovered payload; it never inserts `catalog_products`.
2. **VERIFIED local hit is the only catalogue bind on the user path.** Search-verified new
   products are not silently promoted. That would be catalogue promotion, which Phase 4
   does not do.
3. **Partial unique indexes on Bag.** PostgreSQL `UNIQUE` allows multiple NULLs, so
   `(user_id, catalog_product_id)` and `(user_id, discovered_product_id)` are partial
   unique indexes rather than table constraints.
4. **Late share fan-out.** `requestProcessing` is suppressed when the source is already
   READY. `UserImportService` therefore applies Bag membership after submit when products
   are already bound. The worker still fans out after resolve for the in-flight set.
5. **No Product Page / Search change.** Attribution is stored (`source_content_source_id`,
   `source_user_import_id`) so a later Product Page can show the originating Reel. Bag GET
   does not label items as discovered or surface confidence/completeness.

---

# 22. Phase 5 Implementation Addendum

Phase 0–4 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-5-bag.md`](./mystash-user-ingestion-phase-5-bag.md).

1. **Same Cart/Bag, new presentation.** Phase 4 already owns XOR membership, hydration,
   fan-out, and attribution. Phase 5 maps both product kinds onto `BagItemView` /
   `BagItemCard` and keeps `/cart` as the only Bag surface.
2. **No ProductCard on Bag.** Collection/Search cards still gate price on VERIFIED and
   show `VerificationBadge`. Bag always shows image / name / brand / price / source when
   present, and hides verification, confidence, completeness, and catalogue status.
3. **Share progress is GET `/imports`, not a second bag.** `looking` / `ready` /
   `nothing_yet` / `couldnt_finish` are the only client states. Empty + looking is a
   progress surface, not “Your Bag is empty”.
4. **Tap uses the existing sheet.** `ProductDetailsSheet` with `hideInternalStatus`.
   Shopping remains catalogue-id + ShoppingResolver. Search is unchanged.

---

# 23. Phase 6 Implementation Addendum

Phase 0–5 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-6-product-page.md`](./mystash-user-ingestion-phase-6-product-page.md).

1. **First-class route.** `app/product/[productId].tsx` is the Product Page. Bag navigates
   here. Collection / Search / Creator still use `ProductDetailsSheet`.
2. **One projection.** `GET /products/:id/page` hydrates catalogue or share-imported
   identity into `ProductPageView`. Storage type, verification, confidence, and
   completeness stay off the wire.
3. **ShoppingResolver stays the buy authority** for catalogue ids. Share-imported rows
   with a stored `merchantUrl` use the same redirect as a listing, not a new destination
   picker. Nothing is promoted into `catalog_products`.
4. **Related media is existing tags**, not a new ranker. Reviews reuse AI Review for
   catalogue ids only. Compare is a placeholder. Search is unchanged.

---

# 24. Phase 7 Implementation Addendum

Phase 0–6 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-7-merchant-offers.md`](./mystash-user-ingestion-phase-7-merchant-offers.md).

1. **Projection, not a new store.** Offers come from `metadata.shopping_candidates`,
   `metadata.offer`, and existing merchant columns. No merchant/offers service.
2. **ShoppingResolver stays the click authority** for catalogue ids. An opaque
   `offerId` selects among stored destinations; the client never sends a URL.
   Share-imported Buy CTAs still require a stored merchant destination.
3. **One price is not “the” price.** When more than one offer is shown, the page-level
   price is omitted so a single merchant’s figure is not treated as authoritative.
4. **Search, reviews, related-media ranking, compare, and catalogue promotion** are
   unchanged.

---

# 25. Phase 8 Implementation Addendum

Phase 0–7 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-8-product-media.md`](./mystash-user-ingestion-phase-8-product-media.md).

1. **Same media models.** Original and related rows project `content_sources` and
   published `collection_media`. No new media table, no copied records.
2. **Original stays distinct.** Query `contentSourceId` wins; otherwise the first
   bound source. Related media never repeats that identity.
3. **No ranker.** Collection tags and other bound sources are listed in existing
   order after dedupe and validity checks. Search, reviews, compare, offers, and
   catalogue promotion are unchanged.

---

# 26. Phase 9 Implementation Addendum

Phase 0–8 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-9-reviews.md`](./mystash-user-ingestion-phase-9-reviews.md).

1. **Same AI Review store.** Product Page projects READY `product_ai_reviews`
   rows. It does not enqueue generation or add a review table.
2. **No invented scores.** Stars and review counts are omitted until real
   stored values exist. Generating / failed / empty rows hide the section.
3. **Collection and Creator are unchanged.** They still use `ProductAiReviewCard`
   and `GET /products/:id/ai-review`. Offers, media, Search, compare, and
   catalogue promotion are unchanged.

---

# 27. Phase 10 Implementation Addendum

Phase 0–9 are otherwise unchanged. Developer doc:
[`mystash-user-ingestion-phase-10-compare.md`](./mystash-user-ingestion-phase-10-compare.md).

1. **Same product records.** Compare loads 2–4 `ProductPageView`s from
   `GET /products/:id/page`. No compare table, no second catalog, no
   automatic `catalog_products` write.
2. **Search is a picker only.** Adding a product uses existing
   `searchBlended` / catalog hydration. The Search tab, Collection, and
   Creator still open `ProductDetailsSheet`.
3. **Facts, not a verdict.** Rows come from stored offers, category,
   specification keys, and review overview. Missing values render as
   “Not available”. Copy never names a winner, best pick, score, or
   recommendation.



