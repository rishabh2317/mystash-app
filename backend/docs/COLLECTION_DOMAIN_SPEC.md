# Mystash Collection Domain Specification

**Status:** Design specification (no SQL, no APIs, no migrations, no code)  
**Audience:** Platform architecture for Feed, Search, Recommendations, Analytics, Commerce (5–10 year horizon)  
**Principle:** A Collection is a creator’s published **recommendation**, not a video file.  
**Revision note:** Incorporates Recommendation Intent, Search Source Fields, Materialized Counters, Creator Snapshot, and extensible Quality Signals (pre–database design).

Related inventories:
- Current backend: `backend/docs/ARCHITECTURE.md`
- Collection-perspective audit: `backend/docs/COLLECTION_DOMAIN_AUDIT.md`

---

## 0. Definition

A **Collection** is the primary business object of Mystash: a creator-owned, shareable recommendation package that binds:

1. **Recommendation intent** — structured intent metadata (e.g. Review, Comparison, Gift Guide) plus free-text title/caption
2. **Evidence media** — one or more media items that substantiate the recommendation (video today; images/PDFs/native uploads/external links later)
3. **Tagged products** — references to global Catalog products the creator is recommending (with Collection-local presentation: order, primary, confidence, frame cues)
4. **Discovery source surface** — canonical search source fields, quality signals, and creator/engagement snapshots that Feed, Search, and Recommendations consume **without** owning those systems
5. **Lifecycle & ownership** — who owns it, who can see it, whether it is draft/live/archived

A Collection is **not**:
- a Catalog product
- a shopping offer
- a search **index** or search engine (it only owns search **source** fields)
- a recommendation engine or embedding store
- an analytics event stream (it only owns materialized counters)
- an AI pipeline run
- a User or Creator profile (it only owns a creator display snapshot)

Those remain separate bounded contexts that **reference** Collections.

---

## 1. Responsibilities

### 1.1 What a Collection owns

| Responsibility | Meaning |
|----------------|---------|
| **Identity** | Stable id, public slug, share identity, ownership |
| **Lifecycle** | Draft → processing → review → published → edited → archived → deleted (and rejection/unpublish paths) |
| **Visibility & eligibility** | Who may see it (visibility) and whether it is eligible for Feed/Search/Recs |
| **Creator ownership + snapshot** | Hard FK to Creator; denormalized creator display snapshot for Feed/Search latency |
| **Recommendation intent** | Structured intent vocabulary + free-text title/caption, language, locale |
| **Media membership** | Ordered list of media attachments; which one is primary; media type/source pointers (not raw OCR/frames) |
| **Product membership** | Ordered tagged products; primary product; tag provenance (AI vs manual); Collection-local confidence/frame cues |
| **Publish snapshot contract** | What was true at publish (and at subsequent edits) for the recommendation surface |
| **Search source fields** | Canonical text/keyword fields from which future SearchDocuments are built (not the index) |
| **Materialized engagement counters** | Latest cached views/likes/saves/shares/product_clicks/purchases (not the event log) |
| **Quality signals** | Extensible score slots for ranking gates (`quality_score` first; others reserved) |
| **Moderation state** | Review/reject/flag/takedown state that gates publication |
| **Cross-context correlation ids** | Links to ingest run, extraction cache keys, etc., without embedding those payloads |

### 1.2 What a Collection must NOT own

| Must not own | Why | Owning context |
|--------------|-----|----------------|
| Global product truth (brand, model, specs, canonical identity) | Shared across Collections; dedupe & merge live elsewhere | **Catalog** |
| Merchant offer resolution (price, currency, merchant URL, affiliate minting) | Changes independently of recommendation intent; commerce volatility | **Commerce / Shopping** (+ Catalog offer fields) |
| Product search / PDP enrichment / verification decisions | Pipeline concern; many Collections share one Catalog product | **Product Intelligence** |
| Raw AI reasoning traces, prompts, token usage | Operational/debug; high volume; not user-facing | **Ingest / Pipeline Observability** |
| Frame bitmaps, OCR lines, logo boxes, scene JSON | Ephemeral extract evidence; huge; versioned by pipeline | **Media Understanding / Ingest Artifacts** |
| Search indexes, inverted postings, query serving, embeddings | Query-optimized projections built **from** Collection search source fields | **Search** |
| Recommendation engine, candidate generation, ranking models, embeddings | Model-owned, retrainable, high churn; may later write `recommendation_score` back by contract | **Recommendations** |
| View/like/comment/save/click/purchase **event streams** and historical aggregates | Write-heavy; retention & privacy; Analytics is SoT for events | **Engagement / Analytics** |
| User auth credentials, sessions, preferences | Identity platform | **User** |
| Creator bio, follower graph, verification SoT, creator category authority | Profile & social graph; Collection only mirrors a display snapshot | **Creator** |
| Affiliate network credentials / click redirect logs as SoT | Commerce infrastructure | **Commerce** |

### 1.3 Boundary map (responsibility separation)

```text
┌─────────────────────────────────────────────────────────────┐
│                     COLLECTION DOMAIN                        │
│  identity · lifecycle · intent · media · product tags       │
│  search source fields · quality signals · counters snapshot │
│  creator snapshot · visibility · moderation · share         │
└───────────────┬───────────────────────────┬─────────────────┘
                │ references                │ emits events to
                ▼                           ▼
        ┌───────────────┐           ┌──────────────────┐
        │   CATALOG     │           │ SEARCH / RECS /  │
        │  product SoT  │           │ ANALYTICS / FEED │
        └───────▲───────┘           └──────────────────┘
                │ resolves
        ┌───────┴───────┐
        │   PRODUCT     │◄── Ingest / Media Understanding
        │ INTELLIGENCE  │
        └───────▲───────┘
                │ offers / redirects
        ┌───────┴───────┐
        │   COMMERCE    │
        │  / SHOPPING   │
        └───────────────┘
```

| Context | Owns | Relationship to Collection |
|---------|------|----------------------------|
| **Collection** | Recommendation package, intent, search source fields, membership, snapshots, counters | Primary |
| **Product Intelligence** | Finding/verifying Catalog products for draft tags | Upstream producer of tag candidates; may suggest intent |
| **Catalog** | Canonical product identity & durable product metadata | Downstream shared entity referenced by tags |
| **Commerce / Shopping** | Destination selection, affiliate, redirects, click logging | Side-effect of shopping from a Collection product tag; events feed Analytics → counter refresh |
| **Search** | Index documents & query serving | Builds SearchDocuments from Collection **search source fields** (+ joins) |
| **Recommendations** | Ranking models, embeddings, candidate sets | Consumes intent, quality signals, counters; does not live inside Collection |
| **Analytics** | Event SoT, funnels, historical aggregates | Asynchronously refreshes Collection **materialized counters** and may write quality signals by contract |
| **User** | Account identity | Actor on engagement & authorship via Creator |
| **Creator** | Public creator profile & social edges (SoT) | Owner of Collection; profile changes refresh Collection creator snapshot |

---

## 2. Lifecycle

### 2.1 States

| State | User-visible? | Feed/Search/Recs eligible? | Meaning |
|-------|---------------|----------------------------|---------|
| `draft` | Creator only | No | Created; media/source attached or pending; no successful AI pass required yet |
| `processing` | Creator only | No | Ingest / Product Intelligence / media understanding in progress |
| `ready_for_review` | Creator only | No | AI pipeline completed with acceptable confidence; awaiting creator publish decision |
| `review_required` | Creator only | No | Pipeline finished degraded (low confidence / empty / failed enrichment); needs manual curation |
| `rejected` | Creator only | No | Creator or moderator discarded before publish (or soft-rejected) |
| `published` | Per visibility | Yes if `visibility=public` (or audience rules) and not flagged | Live recommendation |
| `unpublished` | Creator only | No | Was published; intentionally removed from public surfaces without deleting |
| `archived` | Creator only (or admin) | No | Long-lived retention; not editable as a normal draft; hidden from active creator workspace defaults |
| `deleted` | No | No | Soft-deleted tombstone (hard delete is a separate irreversible ops action) |

Optional sub-status (not a separate lifecycle state): `moderation_hold` flag while published content is under trust & safety review.

### 2.2 State machine

```text
                    create
                      │
                      ▼
                   draft ──────────────────────────────┐
                      │                                │
                      │ start processing               │ abandon / reject
                      ▼                                ▼
                 processing ──(fail hard)──► review_required
                      │                          │
                      │ success                  │ manual fix → reprocess
                      ▼                          │
              ready_for_review ◄─────────────────┘
                      │
          ┌───────────┼────────────┐
          │ publish   │ reject     │ edit & reprocess
          ▼           ▼            ▼
     published     rejected      processing / draft
          │
          ├─ edit content ──────► published (new revision; see §8)
          ├─ unpublish ─────────► unpublished ──publish──► published
          ├─ archive ───────────► archived
          └─ soft delete ───────► deleted

archived ──restore──► unpublished or draft (policy choice — see Open Questions)
deleted ── (no automatic restore; ops restore only)
```

### 2.3 Transitions (normative)

| From | To | Trigger | Guards | Side effects (conceptual) |
|------|----|---------|--------|---------------------------|
| — | `draft` | Creator creates Collection (URL ingest, manual, future native upload) | Authenticated Creator | Allocate id/slug candidate; attach source media pointer |
| `draft` | `processing` | Enqueue ingest / AI | Has required source or media | Emit `CollectionProcessingStarted` |
| `processing` | `ready_for_review` | Pipeline success gate | Specificity/confidence thresholds met | Attach AI tag candidates; set review payloads |
| `processing` | `review_required` | Pipeline degraded / empty / soft-fail | — | Keep partial tags; flag needs_manual |
| `processing` | `draft` | Cancel processing (if allowed) | No publish yet | Cancel jobs |
| `ready_for_review` / `review_required` | `processing` | Creator re-run or add products | — | New pipeline run correlation id |
| `ready_for_review` / `review_required` | `published` | Creator publish | ≥1 product tag OR explicit allow-empty policy; moderation clear; intent policy TBD | Freeze publish snapshot; compile search source fields; refresh creator snapshot; emit `CollectionPublished`; notify Search/Recs/Feed |
| `ready_for_review` / `review_required` / `draft` | `rejected` | Creator reject / discard | — | Emit `CollectionRejected` |
| `published` | `published` | Edit caption/title/intent/tags/media membership | Ownership; optional re-moderation | Bump `content_revision`; recompile `search_*`; emit `CollectionUpdated`; reindex |
| `published` | `unpublished` | Unpublish | Ownership or admin | Remove from public indexes |
| `unpublished` | `published` | Republish | Same publish guards | Reindex |
| `published` / `unpublished` | `archived` | Archive | Ownership or admin | Drop from active lists; retain for analytics |
| any non-deleted | `deleted` | Soft delete | Ownership or admin | Tombstone; purge from indexes; retain minimal audit |
| `archived` | `unpublished` or `draft` | Restore | Policy TBD | See Open Questions |

### 2.4 Invariants

1. Only `published` Collections with eligible visibility appear in public Feed/Search/Recs.
2. Catalog product resolution may continue asynchronously after publish (`UNRESOLVED` → later verified) **without** changing Collection lifecycle state (commerce freshness ≠ Collection state).
3. Soft delete never removes audit/analytics historical references; it removes public addressability.
4. A Collection always has exactly one **owner Creator** (collaborative authorship is future — see §8).

---

## 3. Relationships

### 3.1 Direct relationship diagram

```text
Creator (1) ──────── owns ──────── (*) Collection
User (1) ────────── engages ────── (*) Collection   (via engagement edges)
Collection (1) ──── has ────────── (*) CollectionMedia
Collection (1) ──── tags ───────── (*) CollectionProductTag
CollectionProductTag (*) ─ refs ─ (0..1) CatalogProduct
Collection (1) ──── generates ──── (0..1) SearchDocument     (Search BC)
Collection (1) ──── features in ── (*) RecommendationSlot    (Recs BC)
Collection (1) ──── accrues ────── (*) EngagementEvent       (Analytics BC)
Collection (1) ──── accrues ────── (*) CommerceClick         (Commerce BC)
Collection (1) ──── correlated ─── (0..*) IngestRun          (Ingest BC)
Collection (1) ──── may have ───── (0..*) CollectionRevision (future)
Collection (1) ──── may have ───── (0..*) ModerationCase
```

### 3.2 Cardinality table

| Entity | Cardinality vs Collection | Nature |
|--------|---------------------------|--------|
| **Creator** | N Collections → 1 Creator | Ownership (required) |
| **User** (viewer) | M:N via likes/saves/views/comments | Engagement edges; User ≠ Creator necessarily |
| **CollectionMedia** | 1 Collection → N media; exactly 1 primary today (N≥1 when published with media) | Owned child of Collection |
| **CollectionProductTag** | 1 Collection → N tags; 0..1 primary tag | Owned child; references Catalog |
| **CatalogProduct** | N tags → 0..1 Catalog product (unresolved allowed) | Shared global entity |
| **SearchDocument** | 1:0..1 projection | Owned by Search BC |
| **Recommendation artifacts** | 1:N scores/candidates over time | Owned by Recs BC |
| **Analytics events / aggregates** | 1:N | Owned by Analytics BC |
| **Comments** | 1:N | Engagement BC (or Collection-adjacent); not core fields |
| **Likes / Saves** | M:N edges | Engagement BC |
| **Views / Impressions** | 1:N events | Analytics BC |
| **Commerce clicks / conversions** | 1:N | Commerce BC (should carry `collection_id`) |
| **Ingest / pipeline runs** | 1:N correlation | Ingest BC |
| **Moderation cases** | 1:N | Trust & Safety |
| **Campaign / sponsorship** | 0..N (future) | Growth/Commerce campaign BC |
| **Collaborators** | 0..N (future) | Extends ownership model |

---

## 4. Collection Core

Design of the **core Collection entity only** (not child tables’ full schemas). Child membership is summarized where the core must point to it.

### 4.1 Identity & ownership

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `id` | Stable primary key | UUID | no | Collection | On create | Never | Yes (always) |
| `public_id` / `slug` | Shareable human-stable address | string (unique) | no | Collection | On create (generated); optional creator customize pre-publish | Rarely (slug change policy TBD) | **Policy:** preferably immutable after first publish |
| `creator_id` | Owning Creator | UUID FK → Creator | no | Collection | On create from auth→Creator | Only transfer (ops; rare) | Yes for normal edits |
| `created_at` | Creation time | timestamp | no | Collection | On create | Never | Yes |
| `updated_at` | Last mutation of Collection-owned fields | timestamp | no | Collection | On any core/membership write | Continuously | No |

### 4.2 Lifecycle & visibility

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `status` | Lifecycle state | enum (see §2) | no | Collection | `draft` on create | Per transitions | No |
| `visibility` | Audience | enum: `public` \| `unlisted` \| `private` | no | Collection | Default `private` until publish; set at publish | On visibility change | No |
| `published_at` | First successful publish time | timestamp | yes | Collection | On first publish | Never after first set | Yes once set |
| `unpublished_at` | Last unpublish time | timestamp | yes | Collection | On unpublish | On each unpublish | No |
| `archived_at` | Archive time | timestamp | yes | Collection | On archive | Clear on restore | No |
| `deleted_at` | Soft delete time | timestamp | yes | Collection | On soft delete | Ops restore clears | No |
| `content_revision` | Monotonic edit counter for cache/index invalidation | int | no | Collection | 0 on create; +1 on publish-affecting edits | On content edits | No |

### 4.3 Recommendation content (free text)

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `title` | Primary headline | string | yes | Collection | Source media title and/or creator edit / optional AI suggestion accepted by creator | Creator edit; optional AI assist | No |
| `caption` | Creator recommendation text / body | string | yes | Collection | Creator input; may be empty at draft | Creator edit | No |
| `language` | Primary language of title/caption | BCP-47 string | yes | Collection | Detected or creator-set | On edit / detection refresh | No |
| `primary_locale` | Intended market/locale hint | locale string | yes | Collection | Creator or inferred | On edit | No |

### 4.4 Recommendation Intent (structured)

Structured intent powers Feed filters, Search facets, and Recommendation features. This is **domain metadata only** — not a recommendation engine, not embeddings.

**Controlled vocabulary (extensible):** values may be added over time without redesigning the Collection core. Initial examples:

| Kind | Examples |
|------|----------|
| Editorial format | `review`, `first_impression`, `comparison`, `buying_guide`, `best_of`, `favorites`, `setup`, `gift_guide`, `budget_pick`, `premium_pick` |
| Use-context / lifestyle | `everyday_carry`, `travel`, `gaming`, `photography`, `workspace` |

Format and use-context values share one extensible vocabulary so a Collection can declare a primary intent and optional additional intents (e.g. primary `comparison` + secondary `gaming`).

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `recommendation_intent` | Primary structured intent | enum string (controlled vocabulary) | yes (required before publish is an Open Question) | Collection | AI suggestion at processing; creator accept/override at review | Creator edit; optional re-infer on reprocess | No |
| `recommendation_intents_secondary` | Additional intents (multi-label) | enum string[] | yes | Collection | Same as primary | Same | No |
| `recommendation_intent_source` | Provenance of current intent | enum: `ai` \| `creator` \| `hybrid` \| `system` | yes | Collection | When intent set | When intent changes | No |
| `recommendation_intent_confidence` | AI confidence when AI-suggested | number (0–1) | yes | Collection | Ingest / classifier | On reprocess; cleared if creator overrides | No |

**Rules:**
- Intent is Collection-owned. Search and Recommendations **read** it; they do not invent a parallel taxonomy on the Collection row.
- Vocabulary growth is additive (new enum values). Deprecation is soft (stop suggesting; keep stored values readable).
- Do not store ranking model outputs or embeddings here.

### 4.5 Creator snapshot (denormalized)

Creator Profile remains the source of truth. Collection stores a **lightweight display snapshot** so Feed and Search cards avoid joining Creator on every read.

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `creator_name` | Display name snapshot | string | yes | Collection (copied from Creator) | On create / publish / Creator profile sync | When Creator profile changes (async refresh) or on publish | No |
| `creator_username` | Handle / username snapshot | string | yes | Collection (copied from Creator) | Same | Same | No |
| `creator_avatar` | Avatar URL snapshot | string URL | yes | Collection (copied from Creator) | Same | Same | No |
| `creator_verified` | Verified badge snapshot | bool | no (default false) | Collection (copied from Creator) | Same | Same | No |
| `creator_snapshot_updated_at` | When snapshot was last refreshed | timestamp | yes | Collection | On snapshot write | On each refresh | No |

**Rules:**
- `creator_id` (§4.1) is the ownership SoT. Snapshot fields must never disagree on *identity*; they may lag on *display*.
- Stale snapshots are acceptable briefly; refresh is event-driven from Creator BC (and at publish).

### 4.6 Media pointers (core-level)

Core stores **membership summary**, not blob payloads.

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `primary_media_id` | FK to CollectionMedia that is hero | UUID | yes until media attached | Collection | When media attached / reordered | On replace primary | No |
| `media_count` | Denorm count | int | no | Collection | Maintained on membership writes | On media add/remove | No |
| `hero_thumbnail_url` | Fast feed thumbnail | string URL | yes | Collection | Copied from primary media | When primary media changes | No |

*(Full media item fields live on `CollectionMedia` — see boundaries §5 and child implications §11.)*

### 4.7 Product tag summary (core-level)

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `primary_product_tag_id` | FK to primary CollectionProductTag | UUID | yes | Collection | On tag set / publish selection | On product edits | No |
| `product_tag_count` | Denorm count | int | no | Collection | Membership writes | On tag add/remove | No |
| `primary_product_name_snapshot` | Feed card text without joins | string | yes | Collection | From primary tag/catalog at publish/edit | When primary tag changes | No |

### 4.8 Search source fields (canonical inputs to Search — not an index)

These are the **canonical source fields** from which future SearchDocuments / indexes are generated. Collection owns them. Search BC owns the index.

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `search_title` | Canonical title string for indexing | string | yes | Collection | Compiled from `title` (and optional overrides) at publish / content edit / recompile job | When title or compile inputs change | No |
| `search_text` | Canonical body / blob for full-text | string | yes | Collection | Compiled from caption + accepted excerpts (not full transcript/OCR dumps) | On content/intent/tag changes that affect compile | No |
| `search_keywords` | Keyword tokens / phrases | string[] | yes | Collection | AI + creator + intent vocabulary labels; creator-editable | On edit / recompile | No |
| `search_brands` | Brand tokens for brand facets | string[] | yes | Collection | Rolled up from CollectionProductTag / Catalog brand + creator edits | On tag/catalog updates | No |
| `search_categories` | Category tokens for category facets | string[] | yes | Collection | Rolled up from Catalog categories + intent/use-context + creator edits | On tag/intent updates | No |
| `search_source_updated_at` | Last compile time | timestamp | yes | Collection | On search-source recompile | On each recompile | No |

**Rules:**
- These fields are **not** inverted indexes, postings lists, or embeddings.
- Search BC projects `SearchDocument` **from** these fields (+ slug, creator snapshot, intent, eligibility).
- Prefer compiling search source fields in Collection Service (or a dedicated compile step owned by Collection) so Search never scrapes caption/OCR ad hoc.
- Heavy raw text (full transcript, OCR) stays in Ingest artifacts; only curated excerpts may enter `search_text`.

### 4.9 Materialized engagement counters

Analytics / Engagement remain the source of truth for **events**. Collection stores only the **latest materialized counter values** for Feed cards and ranking gates.

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `views_count` | Cached view count | int | no (default 0) | Collection (written by Analytics contract) | Async materialization from events | Continuously (batched) | No |
| `likes_count` | Cached like count | int | no (default 0) | Collection (Analytics contract) | Same | Same | No |
| `saves_count` | Cached save count | int | no (default 0) | Collection (Analytics contract) | Same | Same | No |
| `shares_count` | Cached share count | int | no (default 0) | Collection (Analytics contract) | Same | Same | No |
| `product_clicks_count` | Cached outbound product click count | int | no (default 0) | Collection (Analytics/Commerce contract) | Same | Same | No |
| `purchases_count` | Cached attributed purchase count | int | no (default 0) | Collection (Analytics/Commerce contract) | Same | Same | No |
| `counters_updated_at` | Last materialization time | timestamp | yes | Collection | On counter write | On each refresh | No |

**Rules:**
- Never treat Collection counters as audit or billing SoT.
- Counter writes are **contractual denorm** from Analytics/Commerce — not creator edits.
- Comment threads and per-user like edges stay outside Collection core.

### 4.10 Quality signals (extensible)

Replaces a single opaque score with named, extensible signal slots. **Only `quality_score` is expected to be populated initially.** Other scores are reserved extension points for future Analytics / Commerce / Search / Recs / Trust writers.

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `quality_score` | General content/editorial quality for eligibility and ranking gates | number | yes | Collection (written by Analytics/Ingest contract) | Pipeline / quality scorer | Recompute jobs | No |
| `commerce_score` | Commerce readiness / conversion potential (future) | number | yes | Collection (future Commerce/Analytics contract) | **Unpopulated initially** | Future recompute | No |
| `search_score` | Searchability / index quality hint (future) | number | yes | Collection (future Search/Analytics contract) | **Unpopulated initially** | Future recompute | No |
| `recommendation_score` | Recs prior / affinity prior written back (future) | number | yes | Collection (future Recs contract) | **Unpopulated initially** | Future recompute | No |
| `trust_score` | Trust & safety / authenticity prior (future) | number | yes | Collection (future T&S/Analytics contract) | **Unpopulated initially** | Future recompute | No |
| `quality_signals_updated_at` | Last signal write | timestamp | yes | Collection | On any signal write | On recompute | No |

**Rules:**
- Do not overload `quality_score` with commerce or trust meaning; use the dedicated slots when those systems exist.
- Legacy `stash_score` on today’s `videos` row maps to `quality_score` during migration (see Open Questions) — it is **not** retained as a separate Collection core field.
- Scores are scalars only. No embedding vectors on Collection.

### 4.11 Eligibility gates

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `feed_eligible` | Materialized gate | bool | no | Collection | Derived from status+visibility+moderation (+ optional quality floor) | On those changes | No |
| `search_eligible` | Materialized gate | bool | no | Collection | Same | Same | No |
| `recs_eligible` | Materialized gate | bool | no | Collection | Same + quality thresholds | Same | No |

### 4.12 Moderation

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `moderation_state` | `clear` \| `needs_review` \| `rejected` \| `takedown` | enum | no | Collection / T&S | Default `clear` | Moderation actions | No |
| `moderation_notes_ref` | Pointer to moderation case | UUID | yes | T&S | On case open | Case updates | No |

### 4.13 Provenance / correlation

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `origin_type` | How Collection was born | enum: `url_ingest` \| `manual_curation` \| `native_upload` \| `import_*` \| `ai_generated` (future) | no | Collection | On create | Never (origin is historical) | Yes |
| `origin_platform` | youtube/instagram/pinterest/native/… | string | yes | Collection | On create from detect | Only if source replaced pre-publish | Prefer immutable after publish |
| `origin_source_url` | External source URL if any | string | yes | Collection | On create | Replace source pre-publish | Prefer immutable after publish |
| `latest_ingest_run_id` | Correlation to pipeline | UUID | yes | Collection | On processing | Each reprocess | No |
| `schema_version` | Domain schema version for migrations of meaning | int | no | Collection | On create | Platform upgrades | No |

### 4.14 Extensibility bag (controlled)

| Field | Purpose | Datatype | Nullable? | Owner | Populated | Changes | Immutable after publish? |
|-------|---------|----------|-----------|-------|-----------|---------|--------------------------|
| `extensions` | Versioned key-value for rare/future attributes without core churn | map/object | yes | Collection | Feature flags / imports | Feature-specific | Field-dependent |

**Rule:** Prefer first-class fields for anything Feed/Search/Recs read on the hot path (intent, search source fields, counters, quality signals, creator snapshot). Use `extensions` only for low-cardinality experimental attributes.

---

## 5. Collection Boundaries

What lives **outside** the Collection core (and why).

| Information | Lives in | Why outside Collection |
|-------------|----------|------------------------|
| AI reasoning text, prompts, token counts | Ingest stage artifacts / pipeline runs | High volume, debug-only, pipeline-versioned |
| Frame images, OCR lines, logo bounding boxes, raw scene JSON | Media Understanding artifacts + object storage | Large binary/structured blobs; not needed for every Collection read |
| Transcript full text | Media/Ingest artifact (optional curated excerpt into `search_text`) | Large; language tooling separate; Collection keeps language + search source compile |
| Offer history, price time series | Commerce / Catalog offer history | Volatile; many Collections share one product |
| Current merchant/affiliate destination | Commerce resolver + Catalog shopping fields | Must stay fresh independently of caption edits |
| Product brand/model/specs canonical | Catalog | Shared identity; Collection `search_brands` / tag snapshots are derived |
| Search inverted index / vectors / query serving | Search BC | Built **from** Collection search source fields; different storage & reindex cadence |
| Recommendation embeddings, candidate sets, online ranking state | Recommendations BC | Model-specific; may later write `recommendation_score` only |
| View/like/comment/save/click/purchase **event streams** | Engagement / Analytics | Write-heavy; privacy retention differs; Collection keeps counters only |
| Click redirect logs (append-only) | Commerce (`product_clicks` today) | Audit trail; counters are a projection |
| Creator bio, followers, verification SoT | Creator BC | Profile ≠ Collection; Collection keeps creator snapshot only |
| User preferences | User BC | Personalization input to Recs, not Collection data |
| Affiliate network credentials | Commerce config | Secrets |
| Extraction caches keyed by source video | Ingest cache | Cross-Collection reuse of extract cost |

### 5.1 Child entities owned *by* Collection domain (but not “core columns”)

These are Collection-bounded aggregates, still **not** Catalog/Search:

1. **CollectionMedia** — media type, source, playback URLs, duration, aspect, thumbnails, sort order, primary flag, processing status  
2. **CollectionProductTag** — catalog_product_id (nullable), sort order, primary flag, tag_source (`ai`\|`manual`\|`import`), confidence, frame cues, include_in_publish, snapshots for name/image/brand/category at attach time  
3. **CollectionRevision** (future) — immutable snapshots for audit/rollback (should include intent + search source fields)  
4. **CollectionCollaborator** (future) — ACL beyond owner  

See **§11** for implications of the new core fields on these children.

### 5.2 Projection entities owned by other domains

| Projection | Owner | Built from |
|------------|-------|------------|
| SearchDocument | Search | Collection **search source fields** + intent + creator snapshot + eligibility + slug/id |
| FeedCardView | Feed/BFF | Creator snapshot + hero media + primary product snapshot + intent + counters + `quality_score` |
| RecsFeatureVector | Recommendations | Intent + quality signals + counters + search categories/brands (features only; vectors stay in Recs) |

---

## 6. Read Model

Screens and the Collection fields they need (conceptual; not API shapes).

### 6.1 Feed

**Needs:** `id`, `slug`, `title`, `recommendation_intent`, `hero_thumbnail_url`, primary media playback pointer, **creator snapshot** (`creator_name`, `creator_username`, `creator_avatar`, `creator_verified`), `primary_product_name_snapshot`, `product_tag_count`, **materialized counters** (at least likes/saves/views), `quality_score`, `published_at`, eligibility flags  
**Must not load:** OCR, reasoning, offer history, event streams, Creator profile join (snapshot is enough)  
**Join/enrich at edge:** Optional live price from Commerce/Catalog for product dock

### 6.2 Collection Page (shareable)

**Needs:** Full recommendation content (`title`, `caption`, language), **structured intent**, all media in order, all product tags in order (with Catalog join for brand/specs), creator snapshot (+ optional live Creator profile teaser), share identity (`slug`), `published_at`, **materialized counters**, commerce CTAs (resolved at read via Commerce)  
**Optional:** Related Collections (Recs BC)  
**Must not embed:** Pipeline artifacts, Analytics event logs

### 6.3 Creator Profile

**Needs:** List of creator’s Collections: `id`, `slug`, `thumbnail`, `title`, `recommendation_intent`, `status` (for owner), `published_at`, `visibility`, materialized counters  
**Owner view additionally:** `processing`/`review` states, `review_required` badges

### 6.4 Search Results

**Needs:** From SearchDocument projection built from Collection **search source fields** + intent + creator snapshot + thumbnail/slug  
**Collection core is the compile source for reindex**, not the serving index itself

### 6.5 Recommendations surfaces

**Needs:** Same card fields as Feed; ranking features come from Recs BC  
**Collection provides:** eligibility, stable id, **recommendation intent**, quality signals, counters, search brands/categories as features  
**Collection does not provide:** embeddings or online ranking state

### 6.6 Admin / Trust & Safety

**Needs:** Core identity, status, visibility, moderation_state, origin_*, creator_id + snapshot, intent, quality/trust signals, correlation `latest_ingest_run_id`, links to moderation cases and artifact browsers  
**May deep-link:** Ingest artifacts (separate UI)

### 6.7 Draft Review (creator)

**Needs:** Status, pipeline progress (from Ingest projection), proposed product tags with confidence, **proposed recommendation intent**, media preview, ability to include/exclude tags, caption/title editors, intent editor, publish CTA  
**Reads Catalog** for enriched product cards when resolved  
**May preview** compiled `search_*` fields before publish (optional)

### 6.8 Product Detail (Catalog-centric)

**Needs:** Reverse index: Collections featuring this Catalog product  
**Collection fields shown:** thumbnail, title, intent, creator snapshot, slug  
**Does not make Catalog own Collections**

### 6.9 Commerce redirect interstitial (optional)

**Needs:** `collection_id` for attribution; product tag id; destination resolved by Commerce — Collection is attribution context only  
**Side effect:** Commerce/Analytics events eventually refresh `product_clicks_count` / `purchases_count`

---

## 7. Write Model

Every mutation that changes Collection-owned state, and which service owns the write.

| Operation | What changes | Owning service / BC | Notes |
|-----------|--------------|---------------------|-------|
| **Create Draft** | Insert Collection `draft`; optional media stub; seed creator snapshot | **Collection Service** | May call Ingest to detect platform |
| **Attach / Replace Source Media** | CollectionMedia + core primary pointers | **Collection Service** + **Media Ingest** | Pre-publish flexible; post-publish policy TBD; may trigger search-source recompile |
| **Start AI Processing** | `status=processing`; set `latest_ingest_run_id` | **Collection Service** orchestrates; **Ingest Pipeline** executes | Reuses progressive orchestrator |
| **Ingest completes** | `ready_for_review` or `review_required`; propose tags; propose intent | **Ingest** emits result; **Collection Service** applies | Collection owns final tag rows and intent |
| **Accept / Edit AI tags** | CollectionProductTag rows; refresh search brands/categories | **Collection Service** | May call Product Intelligence to resolve Catalog ids |
| **Add Manual Product URL** | New tag + PI resolve; refresh search brands/categories | **Collection Service** + **Product Intelligence** | Reuses manual ingest enrichment |
| **Remove Product Tag** | Tag membership; refresh search brands/categories | **Collection Service** | |
| **Set Primary Product** | `primary_product_tag_id` + snapshot | **Collection Service** | |
| **Set / Edit Recommendation Intent** | Intent fields; may refresh `search_keywords` / `search_categories` | **Collection Service** | Creator override sets `recommendation_intent_source` |
| **Edit Title / Caption** | Content fields; bump revision; recompile search source fields | **Collection Service** | Emits update for Search/Recs |
| **Recompile Search Source Fields** | `search_*` + `search_source_updated_at` | **Collection Service** (compile step) | Triggered by content/intent/tag changes |
| **Publish** | `published`; visibility; snapshots; eligibility; freeze search source compile | **Collection Service** (evolves today’s publish) | Triggers indexers; refresh creator snapshot |
| **Reject / Discard Draft** | `rejected` | **Collection Service** | |
| **Unpublish** | `unpublished`; eligibility false | **Collection Service** | |
| **Republish** | `published` | **Collection Service** | |
| **Visibility Change** | `visibility` + eligibility | **Collection Service** | |
| **Archive / Restore** | archived flags/status | **Collection Service** | |
| **Soft Delete** | `deleted_at` | **Collection Service** | |
| **Moderation Takedown** | `moderation_state`; may write `trust_score` later | **Trust & Safety** via Collection API | |
| **Async Catalog resolution update** | Tag’s catalog_product_id / resolution; may refresh search brands/categories | **Product Intelligence** updates tag; Collection recompiles search source | Does not change Collection `status` |
| **Refresh Creator Snapshot** | Snapshot fields | **Collection Service** (triggered by Creator events) | Creator BC remains SoT |
| **Materialize Counters** | Counter fields + `counters_updated_at` | **Analytics** (contractual write) | Events remain in Analytics/Commerce |
| **Write Quality Signals** | `quality_score` (initially); other scores later | **Analytics / Ingest / future BCs** via contract | Never creator-direct |
| **Engagement writes** (like/save/comment/view) | Event streams only | **Engagement / Analytics** | Then async counter materialization |
| **Commerce click / purchase** | Event streams only | **Commerce** (+ Analytics) | Must include `collection_id`; then counter refresh |

**Rule:** Product Intelligence, Catalog, and Commerce never directly mutate Collection title/caption/status/intent except through defined Collection application services / events. Analytics may write counters and quality signals only through the contractual denorm fields above.

---

## 8. Future Extensibility

Design constraints that avoid core redesign:

### 8.1 Mechanisms

1. **CollectionMedia polymorphism** — `media_type` discriminator (`video_external`, `video_native`, `image`, `pdf`, `link`, …) with type-specific payload in media child, not in Collection core.  
2. **Origin enum expansion** — `origin_type` / `origin_platform` absorb Instagram/Pinterest/native/AI-generated without new core entities.  
3. **Tag source enum expansion** — collaborative/import/campaign tags.  
4. **Recommendation intent vocabulary expansion** — additive enum values (new formats/contexts) without schema redesign.  
5. **Search source compile** — `search_*` fields absorb new token sources without Search owning Collection storage.  
6. **Quality signal slots** — `commerce_score` / `search_score` / `recommendation_score` / `trust_score` reserved; populate later without new core redesign.  
7. **`content_revision` + optional Revision aggregate** — versioning/rollback without rewriting history (include intent + search source).  
8. **`extensions` map** — experimental attributes with `schema_version` gates.  
9. **Eligibility flags** — new surfaces (e.g. `ads_eligible`) add flags without status enum explosion.  
10. **Events as integration** — Search/Recs/Analytics subscribe to Collection lifecycle events; Analytics pushes counters/signals.  
11. **Locale fields** — `language`, `primary_locale`, future `localized_content[]` child for multi-language (and localized search source compile).  
12. **Collaborators ACL child** — keeps single `creator_id` owner while allowing editors.  
13. **Campaign association** — external join table Collection↔Campaign for sponsorship/affiliates.

### 8.2 Feature → extension point

| Future feature | Extension point |
|----------------|-----------------|
| Native uploads | New `CollectionMedia` type + Media processing pipeline |
| Instagram / Pinterest imports | `origin_type=import_*`; importer writes draft Collection + intent guess |
| Collaborative collections | `CollectionCollaborator` + ACL checks on writes |
| Collection versions | `CollectionRevision` snapshots on publish/edit (intent + search_*) |
| Multiple media | Already N media; UI + primary pointer; search_text compile policy |
| Affiliate campaigns | Commerce campaign BC + tag-level campaign ids; may feed `commerce_score` later |
| Brand sponsorship | extensions or Campaign join; disclosure fields on Collection |
| AI-generated collections | `origin_type=ai_generated`; intent often system/AI-sourced |
| Multi-language | `localized_content` child; per-locale `search_*` compile or Search projection |
| Regional metadata | `primary_locale` + optional geo eligibility in Recs/Feed |
| New intent types | Add vocabulary values; no core field change |
| Recs / Search engines | Consume existing fields; write only reserved score slots back |

---

## 9. Existing Architecture Mapping

Map proposed domain onto Mystash **as it exists today**.

| Responsibility | Decision | Existing piece to reuse / extend |
|----------------|----------|----------------------------------|
| Progressive extract Stage 1–3 | **reuse** | `stages/orchestrator`, providers, youtubeContext, media MU |
| Draft product candidates | **extend** | `ingest_draft_products` → become / feed `CollectionProductTag` proposals |
| Ingest request lifecycle | **extend** | `ingest_requests` correlates to Collection processing; Collection status becomes SoT for product lifecycle |
| Publish to feed object | **extend** | `publish.ts` + `videos` evolve into Collection publish (or Collection table superseding `videos` as SoT) |
| `video_products` attachments | **extend** | Evolve into `CollectionProductTag` with richer provenance |
| Catalog identity & metadata | **reuse** | `catalog_products`, aliases, repository |
| Product Intelligence resolve | **reuse** | factory, resolver, search, enrichment, merge, trust policy |
| Shopping redirect & clicks | **reuse / extend** | `ShoppingResolver`, `productRedirect`; **extend** attribution to require `collection_id`; events → counter materialization |
| Search candidate cache / Serper | **reuse** | Remains PI discovery — **not** Collection search |
| Collection search **source fields** | **extend** (new Collection core fields) | Compile from title/caption/tags/intent; no index yet |
| Collection search **index** | **create new BC** | Does not exist today; will consume `search_*` |
| Recommendations engine | **create new BC** | Does not exist today; will consume intent + signals + counters |
| Engagement events (likes/comments/saves/views) | **create new BC** | Does not exist today; materializes Collection counters |
| Analytics aggregates / quality signals | **create new BC** (with contractual denorm writes) | Today: `stash_score` + clicks → map `stash_score` → `quality_score` |
| Creator profile SoT | **create new BC** (or extend User) | Today free-text `creator_name`/`curator_id` on videos → Creator + Collection snapshot |
| Recommendation intent | **create** (Collection core) | Missing today; AI may suggest during ingest |
| User auth | **reuse** | Supabase Auth |
| Stage artifacts / frames / OCR | **reuse** | Remain Ingest/Media Understanding; linked by `latest_ingest_run_id` |
| Manual curation | **reuse / extend** | `/ingest/manual` becomes a Collection write path |
| Affiliate minting | **extend** when enabled | Keep in Commerce; Collection only stores tag references |
| Feed read | **extend** | App feed currently reads `videos`; becomes Collection read model |
| Moderation actions | **extend** | `moderation_actions` → Collection moderation cases |

### 9.1 Explicit non-duplication

- Do **not** put Serper/Tavily/offer merge inside Collection Service.  
- Do **not** store Catalog specs on Collection tags beyond snapshots needed for offline display and search-source compile.  
- Do **not** make Collection the SoT for prices.  
- Do **not** build a second product resolver inside Collection.  
- Do **not** build a search engine or recommendation engine inside Collection.  
- Do **not** store embeddings on Collection.  
- Do **not** treat materialized counters as the event SoT.  
- Do **not** treat creator snapshot as the Creator profile SoT.

### 9.2 Suggested bounded contexts (logical)

```text
[Collection] [Creator] [User]
[Ingest/Media Understanding] → feeds → [Collection]
[Product Intelligence] → [Catalog] ← [Collection tags]
[Commerce/Shopping] ← [Catalog] + Collection attribution
[Search] [Recommendations] [Feed] [Analytics] [Engagement] [Trust&Safety]
```

---

## 10. Open Questions

Finalize before implementation. No assumptions locked in this spec.

### Identity & addressing
1. Is `videos.id` migrated in-place to Collection id, or is a new Collection id introduced with a mapping table?  
2. Are slugs immutable after first publish, or renamable with redirects?  
3. What is the canonical public URL shape (`/c/:slug`, `/@creator/:slug`, …)?  
4. Does unlisted Collection require a secret token beyond slug?

### Ownership & actors
5. Is Creator a separate entity from User, or a role/profile on User?  
6. When source platform creator (YouTube channel) ≠ Mystash Creator, do we store both, and which is public attribution?  
7. Are collaborative editors in v1 scope or explicitly deferred?

### Lifecycle & publish rules
8. Can a Collection publish with zero products?  
9. Does async Catalog verification after publish change any user-visible Collection state?  
10. Archive vs unpublish vs soft-delete: exact semantics for restore and analytics retention?  
11. Is `review_required` creatable into `published` without re-entering `ready_for_review`?

### Media
12. Post-publish: can primary media be replaced without new Collection?  
13. For external embeds vs native uploads, which is SoT for playback URL?  
14. Do we retain ingest frames after publish, and for how long?

### Products & commerce
15. Snapshot policy: which Catalog fields are frozen on the tag at publish vs always live-joined?  
16. Primary product: required or optional?  
17. Should Commerce redirects be keyed by `collection_product_tag_id`, `catalog_product_id`, or both?  
18. Affiliate: Collection-level campaign override vs per-tag only?

### Discovery, intent & scores
19. Is primary `recommendation_intent` required before publish?  
20. Single vocabulary for format + use-context, or two separate taxonomies?  
21. Who wins on conflict: AI-suggested intent vs creator override vs product-derived categories?  
22. How is `search_text` compiled — caption only, or caption + curated transcript/OCR excerpts? Max size?  
23. Are `search_brands` / `search_categories` creator-editable, or strictly derived from tags/Catalog?  
24. Map legacy `videos.stash_score` → `quality_score` only, or also seed another signal?  
25. Multi-language: single caption with `language`, or immediate localized children + localized `search_*`?

### Moderation & compliance
26. Who can takedown (creator, admin, automated classifier)?  
27. Regional legal eligibility: Collection field vs Recs/Feed policy layer?  
28. Sponsorship disclosure: required field on Collection core or campaign join?

### Consistency & scale
29. Event bus vs synchronous indexer calls on publish / search-source recompile?  
30. Counter materialization cadence (near-real-time vs batched) and conflict/replay rules?  
31. Creator snapshot refresh: every Creator edit vs debounce vs only on publish?  
32. Read path: Postgres primary + CDN for media, or separate Feed materialization store in year 1?  
33. Soft delete retention and GDPR erasure interaction with Analytics/Commerce logs?  
34. Idempotency keys for create-from-URL to prevent duplicate Collections per creator+source?

### Migration
35. Compatibility period: dual-write `videos` + Collection, or big-bang cutover?  
36. How do existing `product_clicks.video_id` map to `collection_id` and `product_clicks_count` backfill?  
37. Backfill strategy for intent, search source fields, and creator snapshots on existing published rows?

---

## Appendix A — Design principles (normative)

1. **Recommendation-first:** Media evidence supports the recommendation; structured intent + caption define it.  
2. **Single write SoT for lifecycle:** Collection Service owns status/visibility/intent/search source compile.  
3. **Share nothing that churns:** Prices, OCR, embeddings, event streams stay outside.  
4. **Snapshot at the edge of uncertainty:** Creator snapshot, product name snapshot, and counters for Feed cards; live join for Product Detail/Commerce/Creator profile.  
5. **Search source ≠ search index:** Collection owns `search_*`; Search BC owns documents/indexes.  
6. **Counters ≠ analytics:** Collection owns latest integers; Analytics owns events.  
7. **Events over entanglement:** Search/Recs/Analytics subscribe; Analytics/Commerce push counters/signals.  
8. **Extend before replace:** Progressive ingest, PI, Catalog, Shopping remain.  
9. **Eligibility is explicit:** Never infer feed membership from “row exists.”  
10. **Quality signals are named slots:** Do not overload a single score; leave future scores null until owned.

## Appendix B — Non-goals of this specification

- SQL / Prisma / migrations  
- API routes / protobufs  
- UI wireframes  
- Ranking model / recommendation engine design  
- Search engine / embedding design  
- Infra capacity planning numbers  

---

## 11. Implications for future child entities

The five additions live primarily on **Collection core**. They still constrain how `CollectionMedia`, `CollectionProductTag`, and future children should be designed.

### 11.1 CollectionMedia

| Implication | Guidance |
|-------------|----------|
| Search source compile | Media does **not** own `search_*`. At most it contributes optional curated excerpts (e.g. alt text, transcript pointer) that Collection compile may read. |
| Intent | Media does not store recommendation intent. Intent is Collection-level (one recommendation package, many media). |
| Creator snapshot | Unaffected; media has no creator denorm of its own. |
| Counters | Do **not** put Collection-level views/likes on each media row in v1. If per-media analytics are needed later, they belong to Analytics projections or a future media-counter denorm — not duplicated as Collection SoT. |
| Quality signals | Collection-level only. Media may later have processing quality flags (encode success), which are operational — not `quality_score`. |
| Primary media | Changing primary media refreshes `hero_thumbnail_url` and may trigger search-source recompile if title defaults from media. |

### 11.2 CollectionProductTag

| Implication | Guidance |
|-------------|----------|
| Search brands/categories | Tags (via Catalog joins + local snapshots) are the **primary input** to `search_brands` and `search_categories`. Tag add/remove/resolve must trigger Collection search-source recompile. |
| Intent | Product mix may **suggest** intent (e.g. many products → `comparison` / `best_of`) but does not override creator-accepted Collection intent. |
| Snapshots on tag | Keep lightweight name/image/brand/category snapshots on the tag for offline display **and** to compile search source without live Catalog dependency. Catalog remains SoT for truth. |
| Counters | Per-product click counts may exist later in Analytics. Collection `product_clicks_count` is the **sum/attribution rollup** for the Collection card — not stored as the only click log. Optional future: tag-level materialized `clicks_count` as denorm, still not event SoT. |
| Commerce score (future) | Tag-level commerce readiness may inform Collection `commerce_score`, but the Collection signal remains the rollup slot. |
| Primary tag | Changing primary tag updates `primary_product_name_snapshot` and may bias search_title/keywords compile. |

### 11.3 CollectionRevision (future)

Revisions should snapshot **intent**, **search source fields**, **title/caption**, and **tag membership**, not materialized counters or quality signals (those are live operational denorm). Creator snapshot at revision time is optional for audit.

### 11.4 What children must not become

- Children must not grow a parallel search index.  
- Children must not store embeddings for Recs.  
- Children must not own Creator profile fields beyond any media-uploader attribution that is not the Collection owner.  
- Children must not become the Analytics event store.

---

*End of Collection Domain Specification.*
