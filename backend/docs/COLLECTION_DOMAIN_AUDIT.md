# Collection Domain — Current Architecture Audit

**Scope:** Inventory of what exists today if a Collection ≈ one published post/reel (`videos` + related entities).  
**Status labels:** `already exists` · `partially exists` · `derived` · `missing`  
**No redesign. No implementation proposals.**

**Working mapping**
| Collection concept | Closest current entity |
|--------------------|------------------------|
| Published Collection | `videos` |
| Pre-publish Collection draft | `ingest_requests` |
| Tagged products on Collection | `video_products` (+ optional `catalog_products`) |
| Creator (publisher) | `ingest_requests.user_id` (auth); display via `videos.creator_name` / `curator_id` |
| Shareable page | App feed item / WebView of source URL — not a Collection page |

---

## Status legend

| Label | Meaning |
|-------|---------|
| **already exists** | First-class persisted field or API behavior on the Collection (or its direct published join) |
| **partially exists** | Present on ingest/draft/catalog/artifact path but not on published Collection, or incomplete |
| **derived** | Computable from existing data at read time; not stored as Collection field |
| **missing** | Not present in schema, APIs, or runtime persistence |

---

## 1. Collection Identity

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| Collection id | **already exists** | `videos.id` (uuid) |
| Ingest / draft id | **partially exists** | `ingest_requests.id` — pre-publish only; linked via `ingest_requests.video_id` after publish |
| Slug | **missing** | No Collection slug. Product-only: `catalog_products.canonical_slug` |
| Share URL | **missing** | No dedicated Collection share URL. Clients share source video URL / ephemeral Share sheet text |
| Visibility (public/private/unlisted) | **missing** | Published rows are publicly readable via RLS; no visibility enum |
| Status (draft/processing/ready/published/rejected) | **partially exists** | Lifecycle on `ingest_requests.status`. Published Collection has no status column — presence in `videos` implies published |
| Publish date | **partially exists** | `videos.created_at` used as publish time; no separate `published_at` |
| Creator id (auth ownership) | **partially exists** | Auth owner on `ingest_requests.user_id`. **Not** stored on `videos` |
| Display creator name | **already exists** | `videos.creator_name` (from auth metadata at publish) |
| Curator handle | **already exists** | `videos.curator_id` text (`@handle`), not FK to `auth.users` |
| Source platform creator | **partially exists** | `ingest_requests.video_creator` (YouTube channel); not copied to `videos` at publish |
| Ownership (creator-owned) | **partially exists** | Enforced for ingest/draft via `user_id`. Published feed is public; ownership not on Collection row |
| Timestamps created/updated | **already exists** | `videos.created_at`, `videos.updated_at` |
| Language | **missing** | Caption language codes exist only ephemerally in YouTube fetch code |
| Region / country | **missing** | Closest: `product_clicks.country` (click analytics), not Collection locale |
| Platform (youtube/instagram/…) | **partially exists** | `ingest_requests.platform`; not a column on `videos` (inferable from `url`) |
| Source URL | **already exists** | `videos.url` |
| Title | **already exists** | `videos.video_title` |
| Denormalized primary product name | **already exists** | `videos.product_name` (first published product) |
| Stash score | **already exists** | `videos.stash_score` (default 4.5; copied from ingest) |

---

## 2. Collection Media

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| Primary video URL | **already exists** | `videos.url` |
| Embed URL | **already exists** | `videos.embed_url` |
| Thumbnail URL | **already exists** | `videos.thumbnail` |
| Duration | **missing** | Probed in Stage 2/3 runtime (`durationMs`); not stored on Collection |
| Aspect ratio | **missing** | — |
| Captions / transcript text | **partially exists** | Fetched for Stage 1 reasoning; preview in `ingest_stage_artifacts`; not on `videos` |
| Caption language tracks | **partially exists** | Innertube caption track metadata at fetch time only |
| Extracted frames | **partially exists** | `ingest_frame_assets` + Storage `ingest-frames`; ingest-scoped, not published with Collection |
| Frame storage paths | **partially exists** | `ingest_frame_assets.storage_path` |
| Frame timestamps / indices | **partially exists** | `frame_index`, `timestamp_ms` on assets; also draft `frame_refs` |
| Frame SHA256 | **partially exists** | `ingest_frame_assets.sha256` |
| OCR results | **partially exists** | In stage artifact payloads / draft `evidence.ocrMentions`; not Collection columns |
| Logo detections | **partially exists** | Stage artifacts + draft `evidence.logoHits` |
| Object detections | **partially exists** | Stage artifact payloads (Stage 2/3) |
| Scene analysis | **partially exists** | Stage artifact payloads |
| Activity labels | **partially exists** | Stage artifact payloads |
| AI media summary | **partially exists** | Per-product evidence summaries; no Collection-level media summary field |
| Media embeddings | **missing** | — |
| Compression / transcoding assets | **missing** | Relies on source platform playback |
| Signed frame URL TTL | **partially exists** | Runtime 7-day signed URLs for ingest frames |
| Media understanding run metadata | **partially exists** | `ingest_pipeline_runs`, `ingest_stage_artifacts` |

---

## 3. Collection Products

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| Product list on Collection | **already exists** | `video_products` rows for `video_id` |
| Product order | **already exists** | `video_products.sort_order` |
| Primary product | **derived** | First by `sort_order`; also denormalized as `videos.product_name` |
| Product row id | **already exists** | `video_products.id` |
| Product name / price / image | **already exists** | On `video_products` (often denormalized from catalog at publish) |
| Catalog product id | **already exists** | `video_products.catalog_product_id` |
| Merchant URL | **already exists** | `video_products.merchant_url` |
| Affiliate URL on Collection product | **partially exists** | Column exists; Node publish currently writes `null` |
| Provider / merchant label | **already exists** | `video_products.provider` |
| Verification / resolution status | **already exists** | `video_products.resolution_status` (`VERIFIED`\|`UNVERIFIED`\|`UNRESOLVED`) |
| Manual vs AI tagged | **partially exists** | Distinguishes paths (`/ingest` AI vs `/ingest/manual`) and draft `provider`, but no durable `tag_source` on `video_products` |
| Confidence | **partially exists** | On drafts (`confidence`, `ai_confidence`, `match_confidence`); not on `video_products` |
| Frame references | **partially exists** | Draft `frame_refs` / evidence frames; not copied to `video_products` |
| Product timestamps in video | **partially exists** | Legacy prompts/types mention timestamps; not a published Collection product field |
| Brand / model / category | **partially exists** | On drafts + `catalog_products`; not native columns on `video_products` (available via join) |
| Currency | **partially exists** | Draft + catalog; `video_products.price` is text; currency via catalog join |
| Specifications / description | **partially exists** | On `catalog_products` (+ metadata); joined at read |
| Include/exclude at publish | **partially exists** | Client selects draft IDs at publish; no per-product include flag stored after publish |
| Max products constraint | **derived** | Pipeline config / validator caps at extract; not a Collection schema rule |

---

## 4. Collection AI Metadata

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| AI-generated Collection title | **partially exists** | Uses source `video_title` from YouTube/oEmbed, not a separate AI title |
| Collection summary | **missing** | No Collection-level summary field |
| Topics | **missing** | — |
| Brands (Collection-level) | **derived** | Aggregatable from tagged products / drafts |
| Objects detected | **partially exists** | Stage 2/3 artifacts only |
| Activities | **partially exists** | Stage artifacts |
| Scene label | **partially exists** | Stage artifacts |
| Detected entities (logos/OCR) | **partially exists** | Artifacts + draft evidence |
| Keywords | **missing** | — |
| Hashtags | **partially exists** | Typed on `MultimodalContext.metadata.hashtags`; **not persisted** |
| Search terms | **partially exists** | Built at Product Intelligence time per product; not stored on Collection |
| Embeddings (text/media) | **missing** | — |
| Reasoning metadata | **partially exists** | Per-product `reasoning` / evidence in caches/drafts; stage artifacts |
| Confidence (Collection-level) | **missing** | Per-product confidences only |
| Pipeline version / model used | **partially exists** | `ingest_pipeline_runs`, extraction caches |
| Token usage / cost | **partially exists** | Pipeline runs / stage artifacts |
| YouTube description as AI context | **partially exists** | Stored on ingest; used in Stage 1; not on `videos` |
| Extracted product set snapshot | **partially exists** | `ingest_extractions.payload`, `video_extraction_cache.payload` |

---

## 5. Collection Discovery

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| Hashtags | **missing** | Type-only; not stored |
| Categories (Collection) | **missing** | Product categories exist on drafts/catalog |
| Brands index | **derived** | Via product/catalog joins |
| Topics | **missing** | — |
| Product count | **derived** | `COUNT(video_products)` |
| Creator category | **missing** | — |
| Language | **missing** | — |
| Country / market | **missing** | — |
| Search tokens / full-text index | **missing** | Client filters loaded feed on `product_name`, `creator_name` |
| Aliases | **partially exists** | `catalog_aliases` for products, not Collections |
| Semantic vectors | **missing** | — |
| Ranking features | **partially exists** | `stash_score` only as stored Collection score |
| Platform facet | **derived** | From URL / ingest platform |
| Public catalog search | **partially exists** | Product discovery (Serper/CSE) for resolution — not Collection search |
| Feed ordering | **partially exists** | App reads `videos` ordered by `created_at` |

---

## 6. Collection Engagement

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| Views | **missing** | — |
| Watch time | **missing** | — |
| Completion rate | **missing** | — |
| Likes | **missing** | — |
| Comments | **missing** | — |
| Shares (persisted) | **missing** | Client can invoke OS share; not recorded |
| Saves / bookmarks | **missing** | — |
| Follows (creator or Collection) | **missing** | — |
| Purchases / conversions | **missing** | — |
| CTR | **missing** | Could be derived if impressions + clicks existed |
| Outbound clicks | **partially exists** | `product_clicks` linked by optional `video_id` — product/commerce click, not Collection engagement aggregate |
| Impressions | **missing** | — |
| Trending score | **missing** | — |
| Engagement aggregates on Collection | **missing** | — |

---

## 7. Collection Commerce

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| Product shopping links | **already exists** | `video_products.merchant_url` + catalog `merchant_url` / `preferred_shopping_url` |
| Merchant links | **already exists** | Catalog + video_products |
| Affiliate links | **partially exists** | Columns on catalog/video_products/`affiliate_links` table; publish often null; affiliate mint stub not wired; gate via `AFFILIATE_ENABLED` |
| Redirect API | **already exists** | `GET /products/:id/redirect` (catalog id, not Collection id) |
| Click analytics | **already exists** | `product_clicks` (destination type, providers, optional `video_id`, `creator_id`, user, country) |
| Price on Collection product | **already exists** | `video_products.price` (text snapshot) |
| Price freshness | **partially exists** | Catalog `last_verified_at` / enrichment timestamps; no Collection-level freshness |
| Offer freshness | **partially exists** | Enrichment `price_last_verified_at` in candidate meta / canonical cache |
| Currency consistency | **partially exists** | Catalog currency + commerce evidence validation; Collection product currency via join |
| Commerce score | **partially exists** | Runtime `shoppingScore` / provider priority during resolve — not stored on Collection |
| Shopping provider | **partially exists** | On `catalog_products.shopping_provider` |
| Preferred shopping URL | **partially exists** | On catalog; used by redirect resolver |
| Offer object (atomic price+currency+merchant) | **partially exists** | In catalog `metadata.offer` / field provenance after PI — not a Collection-native field |

---

## 8. Collection Moderation

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| Review state (ready_for_review / review_required) | **already exists** | `ingest_requests.status` |
| Draft | **already exists** | Ingest status / drafts UI |
| Processing / queued / failed | **already exists** | Ingest statuses (+ pipeline run statuses) |
| Published | **already exists** | `ingest_requests.status=published` + `videos` row |
| Rejected | **already exists** | Publish `reject_all` → ingest `rejected` + `moderation_actions` |
| Flags (spam/safety) | **missing** | — |
| Audit trail | **already exists** | `moderation_actions` (`action`, `user_id`, `meta`, timestamps) |
| Manual edits of Collection after publish | **partially exists** | App helpers can update/delete `videos`; not a full moderation edit API |
| Manual product URL curation | **already exists** | `POST /ingest/manual` |
| Product include selection at publish | **already exists** | Publish body selects draft external IDs |
| Catalog lifecycle moderation | **partially exists** | `catalog_products.status` (`ACTIVE`/`HIDDEN`/…) — product, not Collection |
| Content policy / takedown state on Collection | **missing** | — |

---

## 9. Collection Analytics

| Field / capability | Status | Where / notes |
|--------------------|--------|---------------|
| Collection score (`stash_score`) | **already exists** | Stored; currently defaulted (~4.5), not a computed engagement model |
| Quality score | **missing** | — |
| Freshness score | **derived** | Could use `videos.created_at` / catalog `last_verified_at` |
| Velocity | **missing** | — |
| Creator authority | **missing** | — |
| Product authority | **partially exists** | Runtime `sourceAuthority` / verification during PI |
| Search popularity | **missing** | — |
| Recommendation signals | **missing** | — |
| Outbound commerce clicks | **already exists** | `product_clicks` |
| Pipeline cost / tokens | **partially exists** | Ingest run analytics, not Collection KPI |
| Product count | **derived** | From `video_products` |
| Verification mix | **derived** | From product `resolution_status` / catalog verification |

---

## 10. Relationships

Cardinality from the Collection (`videos`) perspective.

| Related entity | Cardinality | Link | Notes |
|----------------|-------------|------|-------|
| `videos` (Collection) | 1 | self | Published Collection |
| `video_products` | 1 → N | `video_products.video_id` | Tagged products |
| `catalog_products` | N → 0..1 each | `video_products.catalog_product_id` | Shared global catalog |
| `ingest_requests` | 0..1 → 1 | `ingest_requests.video_id` | Provenance draft; one ingest typically publishes one video |
| `ingest_draft_products` | via ingest 1 → N | `ingest_request_id` | Pre-publish tags |
| `auth.users` (publisher) | via ingest N → 1 | `ingest_requests.user_id` | Not FK on `videos` |
| Display creator | 1 → text | `creator_name`, `curator_id` | Not a `creators` table |
| `product_clicks` | 1 → N | `product_clicks.video_id` (optional) | Commerce clicks attributed to Collection when provided |
| `moderation_actions` | via ingest 1 → N | `ingest_request_id` | Publish/reject audit |
| `ingest_pipeline_runs` | via ingest 1 → N | `ingest_request_id` | Extract runs |
| `ingest_stage_artifacts` | via ingest 1 → N | | Stage payloads |
| `ingest_frame_assets` | via ingest 1 → N | | Frames |
| `ingest_extractions` | via ingest 1 → N | | Extract snapshots |
| `video_extraction_cache` | 0..1 logical | platform + external video id | Cross-ingest cache, not FK |
| `catalog_aliases` | via catalog 1 → N | | Product aliases |
| `product_match_history` | via drafts 1 → N | `draft_id` | Match audit |
| Comments | — | — | **Do not exist** |
| Likes / saves / follows | — | — | **Do not exist** |
| Collections table | — | — | **Do not exist** (Collection is conceptual over `videos`) |
| Collection ↔ Collection edges | — | — | **Do not exist** |

```text
auth.users 1 ──< ingest_requests 1 ──< ingest_draft_products
                      │
                      │ publishes
                      ▼
                   videos 1 ──< video_products >── 0..1 catalog_products
                      │                              │
                      └──── < product_clicks >───────┘
```

---

## 11. Reusable Components

Modules that already operate as building blocks a Collection domain would continue to call (unchanged inventory — not a redesign):

| Module | Why it is Collection-relevant today |
|--------|-------------------------------------|
| Progressive ingest orchestrator (`stages/orchestrator`) | Builds media context + product candidates for a post |
| YouTube context (`pipeline/youtubeContext`) | Primary media metadata/description/transcript gather |
| Context builder + reasoner + validator + ranker | AI product tagging for a post |
| Media / frame extraction + MU providers | Frames, OCR, logos, scene for a post |
| Product persist (`products/productPersist`) | Draft products for a post |
| Product Intelligence factory + resolver | Catalog attachment / verification for tagged products |
| Search stack (query builder, Serper/CSE, shortlist, PDP classify) | Finding merchants for tagged products |
| Enrichment (`productLinkPreview`, Tavily extractor, merge, trust policy) | Product/offer metadata |
| Shopping destination resolver + ShoppingResolver + redirect | Commerce outbound for products on a post |
| Catalog repository / aliases / search-candidate cache | Shared product identity |
| Publish (`publish.ts`) | Materializes Collection (`videos`) + attachments |
| Manual ingest | Human-tagged products on a post |
| Extraction / canonical / rate-limit caches | Cost control around post extract |
| Observability / stage artifacts | Post extract auditability |
| BullMQ ingest-pipeline + product-resolve | Async work for posts and product resolution |

---

## 12. Missing Components

Capabilities that do **not** exist today as Collection-domain primitives (inventory only):

### Identity / page
- First-class `collections` (or equivalent) entity distinct from raw `videos`
- Collection slug + stable shareable Collection URL/page
- Visibility / audience controls
- Auth ownership column on the published Collection
- Language / region on Collection
- Dedicated `published_at` vs created

### Media product
- Duration, aspect ratio, playback analytics hooks on Collection
- Published transcript/captions attachment
- Published media embeddings
- Collection-owned media asset pipeline beyond source URL + thumbnail
- Promoting ingest frames into Collection media gallery

### Products on Collection
- Explicit `tag_source` (manual vs AI) on published attachments
- Persisted confidence / frame cues / timestamps on published attachments
- First-class primary-product flag
- Rich product fields without mandatory catalog join

### AI metadata at Collection level
- Collection title/summary/topics/keywords generated and stored for the post
- Persisted hashtags
- Collection-level embeddings
- Unified AI metadata document for the Collection (not only per-product + artifacts)

### Discovery / search / recommendations
- Collection search index / tokens / facets
- Semantic search
- Recommendation model, candidate generation, ranking features store
- Trending / popularity tables
- Creator graph / creator category taxonomy

### Engagement social graph
- Views, watch time, completion
- Likes, comments, saves/bookmarks
- Shares (persisted)
- Follows (creator and/or Collection)
- Impressions and CTR aggregates
- Purchases / conversion events beyond outbound redirects

### Commerce (Collection-native)
- Collection-level commerce score
- Freshness jobs bound to Collection offers
- Affiliate link minting/caching actually wired to Collection products
- Redirect keyed by Collection+product (today catalog id)

### Moderation / trust & safety
- Collection flags, appeals, takedown states
- Post-publish edit/moderation workflow API
- Safety classifiers persisted on Collection

### Analytics platform
- Quality / freshness / velocity / creator authority scores
- Recommendation and search feedback loops
- Aggregated engagement + commerce dashboards keyed by Collection

### Relationship entities not present
- `comments`, `likes`, `saves`, `follows`, `impressions`, `collection_events`
- Collection↔Collection relations (related, series, remix)
- First-class `creators` profile entity (only free-text handles + auth users)

---

## Summary matrix (high signal)

| Area | Already strong | Partial / ingest-only | Largely missing |
|------|----------------|------------------------|-----------------|
| Identity | id, url, title, display creator, timestamps | ownership, status lifecycle, platform | slug, share page, visibility, language/region |
| Media | source video, embed, thumbnail | frames, OCR, logos, scene, transcript | duration, embeddings, Collection media gallery |
| Products | ordered attachments, catalog link, shopping URLs, verification | confidence, frames, manual/AI tag, rich attrs | primary flag as first-class, full denorm |
| AI metadata | per-product extract + artifacts | MU payloads, caches | Collection summary/topics/embeddings/hashtags |
| Discovery | stash_score, client text filter | product facets via join | search index, vectors, recsys |
| Engagement | — | outbound clicks via products | all social + view metrics |
| Commerce | redirect + click log + catalog offers | affiliate columns, freshness | Collection commerce KPIs, wired affiliate mint |
| Moderation | ingest review + publish/reject audit | catalog status | flags/T&S on Collection |
| Analytics | stash_score, product_clicks | pipeline cost | quality/velocity/authority/rec signals |

---

*Audit only. Current architecture from a Collection perspective. No redesign included.*
