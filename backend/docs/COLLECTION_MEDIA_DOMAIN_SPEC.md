# Mystash CollectionMedia Domain Specification

**Status:** Design specification (no SQL/Prisma/API codegen in this doc)  
**Product:** Mystash is a **commerce discovery** platform. It does **not** host, upload, store, transcode, or stream video.  
**Principle:** A **Collection** is the primary business object. **CollectionMedia** is an **external content reference** plus processing metadata for the source that created that Collection. It is part of the **Collection aggregate** (not a shared media library).  
**Depends on:** [`COLLECTION_DOMAIN_SPEC.md`](./COLLECTION_DOMAIN_SPEC.md)

---

## 0. Definition

```text
Collection (recommendation — primary business object)
      │
      └── Primary CollectionMedia (external source reference; per-Collection row)
                │
                ├── processingStatus / cursors
                ├── Metadata (title, provider creator id/name, thumb, …)
                └── Artifact references → Media Processing BC
```

**CollectionMedia exists to:**
1. Identify the external source content  
2. Hold source metadata useful for Collection, Feed thumb, Search/Recs features  
3. Track AI processing state for **this Collection’s** attachment  
4. Point at processing artifacts for ingest / MU / Admin  

**CollectionMedia must never become a media management or hosting platform.**

### V1 constraint — exactly one primary media

- Design and implement for **one primary CollectionMedia per Collection**.  
- Do **not** optimize for multiple media, carousels, galleries, ordering, or multi-video.  
- Schema may allow a future second media without redesign; V1 application logic assumes **1:1 primary**.

### Aggregate ownership — no shared media rows (resolved)

**Decision:** Always create **one CollectionMedia row per Collection**, even when two Collections reference the same external video `(source_provider, external_id)`.

**Why:** `processingStatus`, `latest_processing_job_id`, artifact refs, and archive/delete semantics are Collection-local. Sharing one row would couple lifecycle across Collections.

**Cross-Collection reuse of expensive extract work** belongs in a **separate extraction/metadata cache** keyed by `(source_provider, external_id)` — not by sharing the aggregate row. Each CollectionMedia may be populated from that cache, then evolve independently.

---

## 1. Responsibilities

### 1.1 Owns

| Responsibility | Meaning |
|----------------|---------|
| External identity | Provider, external media id, canonical URL, embed URL |
| Source metadata | Title, **provider creator id + display name**, thumbnail URL, duration, language, region, published-at |
| Availability | Whether the external source appears reachable / unavailable |
| Processing cursors | **`processingStatus`** + transcript / media-understanding status |
| Sync timestamps | Last metadata sync, last processing timestamp, provider metadata version |
| Artifact references | Ids/refs to jobs and artifact bundles — **not** payloads |

### 1.2 Must NOT own

| Must not own | Owner |
|--------------|--------|
| Collection caption, intent, visibility, lifecycle (`Collection.status`) | **Collection** |
| Products / tags / Catalog | **CollectionProductTag** + **Catalog** |
| Commerce / offers / redirects | **Commerce** |
| Search index | **Search** |
| Recommendations / embeddings | **Recommendations** |
| Analytics events | **Analytics** |
| Feed ranking / cards | **Feed** (reads thumb only) |
| Creator profile SoT | **Creator** |
| Shared extract cache across Collections | **Extraction / metadata cache** keyed by `(provider, external_id)` |
| OCR text, frames, logos, objects, scenes, embeddings, LLM reasoning | **Media Processing / artifact store** |
| Native file bytes, buckets, CDN, HLS/DASH, transcodes, renditions | **N/A — out of product** |

---

## 2. Lifecycle (`processingStatus`)

Simplified — **no upload states**.

**Naming:** The domain field is **`processingStatus`**, not `status`.  
`Collection.status` is the recommendation lifecycle. Using `Media.status` in logs and code is confusing. Persistence may use column `processing_status` (preferred) or map DB `status` → domain `processingStatus`; the **domain object and events must expose `processingStatus`**.

| `processingStatus` | Meaning |
|--------------------|---------|
| `imported` | External source registered; metadata may be partial |
| `processing` | AI / media understanding in progress for this attachment |
| `ready` | Processing succeeded enough for Collection review / publish gates |
| `failed` | Processing failed; retry allowed |
| `archived` | Retained but inactive for this Collection |

```text
attach external URL
        │
        ▼
    imported ──start processing──► processing ──success──► ready
                                      │
                                      └──failure──► failed ──retry──► processing

ready | failed | imported ──archive──► archived
```

**Public playback** is always via **external embed/canonical URL**. Mystash does not “publish” media independently; Collection publish gates on `Collection.status` (+ optionally media `processingStatus === ready`).

---

## 3. Relationships

| Entity | Cardinality (V1) | Notes |
|--------|------------------|-------|
| Collection | 1 Collection → 1 primary CollectionMedia | **Exclusive ownership**; Collection denorm: `primary_media_id`, `hero_thumbnail_url` |
| Same external video, other Collections | Separate CollectionMedia rows | Never share aggregate row |
| Mystash Creator | Via `Collection.creator_id` | Not stored as media ownership |
| Provider creator | `provider_creator_id` + `provider_creator_name` on media | Platform channel/user attribution |
| Products | None directly | Tags stay on Collection |
| Media Processing | 1 media → N jobs/artifacts | Keyed by `media_id` |
| Extract cache | N media → 0..1 cache entry | Key `(source_provider, external_id)` |

```text
Collection A ──1── CollectionMedia A ──┐
                                       ├── same (youtube, videoId) → extract cache hit
Collection B ──1── CollectionMedia B ──┘
```

---

## 4. Media sources (provider-agnostic)

| Field | Role |
|-------|------|
| `source_provider` | Extensible: `youtube`, `instagram`, `tiktok`, `pinterest`, `blog`, `product_page`, `web`, … |
| `media_kind` | Coarse: `video`, `image`, `link` (enough for V1) |

No native upload. No carousel. New providers = new vocabulary + adapter, not redesign.

---

## 5. Core entity

Domain property names below. Prefer matching snake_case columns (`processing_status`, `provider_creator_id`, …).

| Field (domain) | Purpose | Datatype | Nullable | Owner | Populated | Changes | Immutable after Collection publish? |
|----------------|---------|----------|----------|-------|-----------|---------|-------------------------------------|
| `id` | PK | UUID | no | Media | Create | Never | Yes |
| `collectionId` | Parent Collection | UUID | no | Media | Create | Never (V1) | Yes |
| `isPrimary` | Always true in V1 | bool | no | Media | Create `true` | N/A V1 | Yes |
| `sourceProvider` | Platform | string | yes | Media | Detect | Rare | Prefer yes |
| `mediaKind` | video/image/link | string | no | Media | Detect | Rare | Prefer yes |
| `externalId` | Provider media id | string | yes | Media | Detect | Rare | Prefer yes |
| `canonicalUrl` | Normalized URL | string | yes | Media | Detect | Metadata sync | Prefer yes |
| `sourceUrl` | Submitted URL | string | yes | Media | Attach | Rare | Prefer yes |
| `embedUrl` | Embeddable URL | string | yes | Media | Transform | Sync | No |
| `title` | Source title | string | yes | Media | Provider / sync | Sync | No |
| `providerCreatorId` | Stable platform creator id (e.g. YouTube channel id `UC…`) | string | yes | Media | Provider / sync | Sync (rare) | Prefer yes once set |
| `providerCreatorName` | Display name at sync time (e.g. “Marques Brownlee”) | string | yes | Media | Provider / sync | Sync (names change) | No |
| `thumbnailUrl` | External thumb URL | string | yes | Media | Provider / sync | Sync | No |
| `durationMs` | Length if known | int | yes | Media | Probe / provider | Sync / process | No |
| `language` | BCP-47 | string | yes | Media | Detect / captions | Sync | No |
| `region` | Market hint | string | yes | Media | Provider | Sync | No |
| `sourcePublishedAt` | When source published | timestamp | yes | Media | Provider | Sync | Prefer yes once set |
| `sourceAvailability` | `unknown` \| `available` \| `unavailable` \| `restricted` | enum | no | Media | Default unknown | Sync / probe | No |
| `processingStatus` | Lifecycle §2 | enum | no | Media | `imported` | Transitions | No |
| `transcriptStatus` | `not_started` \| `running` \| `succeeded` \| `failed` \| `skipped` \| `unavailable` | enum | no | Media | Default | Processing | No |
| `mediaUnderstandingStatus` | Same enum pattern | enum | no | Media | Default | Processing | No |
| `latestProcessingJobId` | Job correlation | UUID | yes | Media | Job start | Each job | No |
| `latestArtifactBundleRef` | Pointer to artifact bundle | string | yes | Media | Job | Each job | No |
| `providerMetadataVersion` | Provider payload version | string | yes | Media | Sync | Sync | No |
| `lastMetadataSyncedAt` | Last metadata pull | timestamp | yes | Media | Sync | Sync | No |
| `lastProcessedAt` | Last processing settle | timestamp | yes | Media | Process end | Process | No |
| `lastProcessingErrorCode` | Stable error | string | yes | Media | Fail | Clear on success | No |
| `processingAttemptCount` | Retries | int | no | Media | Increment | Retry | No |
| `createdAt` / `updatedAt` | Audit | timestamp | no | Media | Create / write | Write | created immutable |
| `schemaVersion` | Domain version | int | no | Media | Create | Upgrades | No |
| `extensions` | Experimental map | object | yes | Media | Features | Rare | Field-dependent |

### Provider creator fields

| Field | Example (YouTube) | Stability |
|-------|-------------------|-----------|
| `providerCreatorId` | `UCBJycsmduvYEL83R_U4JriQ` | Stable id for attribution / analytics joins |
| `providerCreatorName` | `Marques Brownlee` | Display; changes over time — refresh on metadata sync |

Do **not** collapse these into a single `source_creator` string.

### Explicitly excluded from core

Native upload, storage_bucket/key, playback_url, HLS/DASH, renditions, CDN, checksum/byte_size for hosted masters, sort_order galleries, media version history, upload retry, domain field named `status` (use `processingStatus`).

---

## 6. Processing metadata

Media stores **state + references only**.

| On Media | In Processing / artifact domains |
|----------|----------------------------------|
| `processingStatus`, transcript / MU status | Frame rows, OCR docs, logo boxes, scene JSON |
| `latestProcessingJobId` | Job timeline, stage artifacts |
| `latestArtifactBundleRef` | Bundle contents |
| error code / attempt count | Full error traces |

Must **not** store: OCR text, frames, embeddings, reasoning, object/logo/scene payloads.

---

## 7. Boundaries

Same as §1.2. CollectionMedia never owns products, recommendations, search, commerce, analytics, feed, creator profile, or Collection visibility/caption/`Collection.status`.

Cross-Collection extract reuse = **cache**, not shared CollectionMedia.

---

## 8. Read model

| Consumer | Needs |
|----------|--------|
| **Collection** | Primary media id; thumb for denorm; embed/canonical for review; `processingStatus` for gates |
| **Ingest Pipeline** | source URLs, provider, external_id, processing cursors |
| **Media Processing** | Same + job refs to write back `processingStatus` |
| **Review Queue** | title, thumb, embed, `processingStatus`, error code, provider creator name |
| **Feed** | `thumbnailUrl` only (via Collection `hero_thumbnail_url`) |
| **Search** | title / provider / duration metadata via Collection projection |
| **Recommendations** | light metadata features only |
| **Analytics (future)** | `providerCreatorId` for stable attribution |

---

## 9. Write model

**Only CollectionService** (or an internal helper owned by the Collection aggregate) may mutate CollectionMedia.

| Operation | Owner |
|-----------|--------|
| Attach external source (always **new** row for this Collection) | CollectionService |
| Sync metadata from provider (incl. creator id/name) | CollectionService (from ingest) |
| Start / complete / fail processing | CollectionService API used by ingest/processing |
| Mark source unavailable | CollectionService |
| Archive media | CollectionService |

On attach: optionally **read** extract cache by `(sourceProvider, externalId)` to seed metadata / skip work; **never** attach by linking another Collection’s media row.

No independent Media HTTP write API in V1 beyond Collection-owned routes. No PI/Catalog/Commerce writes to media tables.

---

## 10. Events

| Event | When |
|-------|------|
| `MediaAttached` | Primary external media linked to Collection |
| `MetadataSynced` | Provider metadata fields updated (incl. creator id/name) |
| `MediaProcessingStarted` | → `processingStatus=processing` |
| `MediaProcessingCompleted` | → `processingStatus=ready` |
| `MediaProcessingFailed` | → `processingStatus=failed` |
| `SourceUnavailable` | `sourceAvailability` → unavailable/restricted |

Payload: `mediaId`, `collectionId`, **`processingStatus`**, `occurredAt`, optional `jobId` / `errorCode`.  
Do **not** name the payload field `status` (reserved for Collection).

---

## 11. Performance (lightweight)

- Index: unique `(collection_id) WHERE is_primary`; `(source_provider, external_id)` for **lookup/cache hints** (non-unique — many Collections may share the same external id); `(processing_status, updated_at)` for workers.  
- Hot denorm on Collection: `primary_media_id`, `hero_thumbnail_url`.  
- Extract/metadata cache: keyed by `(source_provider, external_id)` outside the aggregate.  
- No CDN/object-storage strategy — thumbs are external URLs.

---

## 12. Future extensibility

Without redesign: additional providers via vocabulary; optional second media later via `is_primary`; richer artifact refs; analytics on `providerCreatorId`.  
**Do not** pre-build carousels, galleries, ordering, multi-video, hosting, or shared media rows.

---

## 13. Existing architecture mapping

| Piece | Decision |
|-------|----------|
| Today’s thin `collection_media` | **Extend** with metadata + `processing_status` + provider creator fields |
| CollectionService.attachPrimaryExternalVideo | **Extend** → attach external source + events; always insert new row |
| YouTube/Instagram detect + embed + oEmbed | **Reuse** |
| `extractionCache` / video extraction cache | **Extend** as `(provider, external_id)` cache feeding new media rows |
| Progressive ingest / MU / frames / OCR | **Reuse**; correlate with `media_id`; artifacts stay processing tables |
| Collection denorm hero thumb | **Reuse** |
| Native upload / HLS / transcode | **Do not implement** |
| Shared CollectionMedia across Collections | **Do not implement** |

---

## 14. Open Questions

Resolved:
- ~~Dedup / shared row~~ → **Always per-Collection CollectionMedia**; cache by `(provider, external_id)`.

Still open:
1. Exact gate: may Collection publish if media `processingStatus != ready`?  
2. Retry policy and max `processingAttemptCount`?  
3. When source becomes unavailable post-publish — hide Collection, flag only, or no auto action?  
4. Should `latestArtifactBundleRef` point at `ingest_pipeline_runs.id` or a new bundle id?  
5. Event transport V1: structured logs only (match Collection) vs outbox?

---

## Appendix — Non-goals

- Video hosting, uploads, storage, CDN, transcoding, HLS/DASH, renditions  
- Multiple media / carousel / gallery / sort_order UX  
- Shared CollectionMedia rows across Collections  
- Search, Feed, Recs, Analytics, frontend implementations  
- Embedding OCR/frames/reasoning on the media row  
- Domain field `status` on Media (use `processingStatus`)  

---

*End of CollectionMedia Domain Specification.*
