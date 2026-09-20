# Discover Anywhere — Phase 2: Content Source + Async Handoff

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 1: [`mystash-user-ingestion-phase-1-share-capture.md`](./mystash-user-ingestion-phase-1-share-capture.md).

Phase 2 evolves capture into durable global identity plus a processing handoff:

```
User Share
  → user_import          (user-scoped: "this user submitted this content")
  → content_source       (global: "this content is identifiable and reusable")
  → BullMQ job           (work identity = content_source, not the user)
  → fast acknowledgement
```

Nothing is fetched, extracted, resolved, written to Catalog, or added to the Bag.
The Phase 2 job only proves the handoff.

---

## 1. Content source model

`supabase/migrations/20260920140000_content_sources.sql` adds `public.content_sources`
and `user_imports.content_source_id`.

| Column | Role |
| --- | --- |
| `id` | UUID PK |
| `platform` | `youtube` \| `instagram` \| `web` — same lowercase values as `detectPlatform` / `video_extraction_cache.platform` |
| `external_id` | Video: `parseSupportedVideoUrl.externalId`. Web: `externalIdForProductUrl` |
| `canonical_url` | Video: `parseSupportedVideoUrl.canonicalUrl`. Web: `canonicalizeProductUrl` |
| `media_kind` | `VIDEO` \| `WEB_PAGE` |
| `processing_status` | `RECEIVED` \| `QUEUED` \| `PROCESSING` \| `READY` \| `FAILED` |
| `pipeline_version` | From existing `getPipelineConfig().pipelineVersion` |
| `queued_at` | Set when the row moves to `QUEUED` |
| `last_processed_at` | Reserved for Phase 3 |
| `created_at` / `updated_at` / `schema_version` | Same convention as Cart / User Import |

Durable uniqueness: `UNIQUE (platform, external_id)`. That is the identity of a content
source. BullMQ `jobId` uniqueness is a best-effort overlay and is lost after
`removeOnComplete`.

RLS is on with **no client policies**. Content sources are global and written only by the
service-role backend, matching other pipeline tables.

`user_imports.content_source_id` is a nullable FK (`ON DELETE RESTRICT`). New imports
always set it; NULL is only for any pre-Phase-2 rows.

The two records are not collapsed: a user import remains "this user submitted this
content"; a content source remains "this content is globally identifiable".

---

## 2. Content identity

`backend/src/content-source/domain/identity.ts` (`resolveContentSourceIdentity`) reuses
the existing helpers. It does not invent a second canonicalizer and does not fetch or
resolve DNS.

| Input | Identity |
| --- | --- |
| `youtu.be/XYZ?si=abc` | `youtube` + `XYZ` + `https://www.youtube.com/watch?v=XYZ` + `VIDEO` |
| `youtube.com/shorts/XYZ` | same |
| `youtube.com/watch?v=XYZ` | same |
| Instagram reel / reels / p URLs with the same shortcode | `instagram` + shortcode + reel canonical URL + `VIDEO` |
| Product / web URL | `web` + `externalIdForProductUrl(canonicalizeProductUrl(url))` + `WEB_PAGE` |

`videoExtractionCacheLookup` maps a `VIDEO` identity onto
`{ platform, externalVideoId }`, which is exactly what `buildCacheKey` /
`getVideoExtractionCache` already consume. Phase 2 does not read or write
`video_extraction_cache`; Phase 3 can call those helpers with no extra normalizer.

---

## 3. State machine

Modelled on `ingest_requests.status` / `extraction_jobs.status`:

```
RECEIVED → QUEUED → PROCESSING → READY
                      ↘ FAILED → QUEUED   (retry)
READY → QUEUED                            (future re-process on new pipeline version)
```

Phase 2 **writes** only `RECEIVED` (insert) and `RECEIVED|FAILED → QUEUED` (after a
successful enqueue). `PROCESSING` / `READY` / `FAILED` transitions belong to Phase 3.

`shouldEnqueueProcessing` is true only for `RECEIVED` and `FAILED`. `RECEIVED` is also
the durable re-enqueue signal: if the queue was down, the row stays `RECEIVED` so the
next share (or a later sweeper) can hand it off again.

`markQueued` is a single conditional `UPDATE … WHERE processing_status IN ('RECEIVED','FAILED')`.
A concurrent winner leaves the loser with `null`; both shares still collapsed onto one
BullMQ `jobId`.

---

## 4. Queue

New queue name on the **existing** BullMQ + Redis stack — the same pattern as
`product-resolve` and `product-ai-review`. This is not a second ingestion pipeline and
not a new queue technology.

| | |
| --- | --- |
| Queue | `content-source-processing` |
| Job name | `process` |
| `jobId` | `content-source-{contentSourceId}` |
| Payload | `{ contentSourceId, userImportId, traceId? }` — stable ids only |
| Options | 3 attempts, exponential backoff, `removeOnComplete: 100` |

Work identity is the content source, never the user. Three users sharing Source X produce
three `user_imports` rows and **one** job.

The worker (`startContentSourceProcessingWorker`) delegates to `ContentSourceProcessor`.
Phase 2 only proved the handoff; Phase 3 owns extraction and `QUEUED → PROCESSING → READY|FAILED`.

Registered:

- dedicated process: `backend/src/worker.ts`
- embedded API process: `backend/src/index.ts` (skipped when Redis is unavailable, same
  as product-resolve)

Enqueue uses `resolveRedisAvailability` / `REDIS_UNAVAILABLE_ENQUEUE_ERROR` from
`workers/redisConnection.ts`. There is **no** in-process fallback: Phase 2 has no
processing to run inline. Creator ingest still falls back to
`runProgressiveIngestPipeline`; this path must not.

---

## 5. API

`POST /imports` is still a fast acknowledgement. Internally it now:

1. Authenticate (unchanged)
2. Validate / normalize (unchanged Phase 1 input layer)
3. Get-or-create `content_source` (`UNIQUE` + `23505` re-read)
4. Insert `user_import` pointing at it (`UNIQUE (user_id, dedupe_key)` + `23505` re-read)
5. Enqueue global work (best-effort; never fails the request)
6. Return

Response contract is **unchanged**:

```json
{ "importId": "e3f1…", "status": "RECEIVED", "created": true }
```

`201` new submission / `200` same user already submitted. Errors are the Phase 1 set.
A queue failure is **not** an HTTP error: the import is already durable.

---

## 6. Failure semantics

There is no outbox table in this repository and none was added. The durable SoT is
Postgres; the queue is a best-effort overlay. Recovery is the existing unique-constraint
+ re-share (and later, a `RECEIVED` status sweep).

| Case | What happens |
| --- | --- |
| Content source created, enqueue fails | Import is committed. Source stays `RECEIVED`. Event `ContentSourceEnqueueFailed`. Next share of the same source (any user) re-hands off. |
| Enqueue succeeds, HTTP response interrupted | Rows and job exist. Client retry is a duplicate user import → `200` + suppressed enqueue. |
| Two users, same source, concurrent | One `content_sources` row (`23505` loser re-reads). Two `user_imports`. One job (`jobId` + `markQueued` CAS). |
| Same user, same source, concurrent | One `user_imports` row (`23505` loser re-reads). At most one job. |
| Redis unavailable | Same `REDIS_UNAVAILABLE_ENQUEUE_ERROR` as product-resolve. Request still `201`. Source stays `RECEIVED`. No in-process processing. |
| DB unavailable | Request `500 { "error": "Could not accept the shared link" }`. No job. |

Creator ingest's in-process fallback is **not** used here: that fallback runs product
extraction.

---

## 7. Observability

Same `ingestLog` convention as Phase 1 (`svc` + `domain` + event name):

| Event | When |
| --- | --- |
| `UserImportReceived` | Submission accepted (now includes `contentSourceId`) |
| `UserImportRejected` | Input rejected before any write |
| `ContentSourceCreated` | First row for an identity |
| `ContentSourceReused` | Subsequent share of the same identity |
| `ContentSourceProcessingQueued` | Job handed to BullMQ, row `QUEUED` |
| `ContentSourceProcessingSuppressed` | Source already `QUEUED` / `PROCESSING` / `READY` |
| `ContentSourceEnqueueFailed` | Queue threw; row left `RECEIVED` |

---

## 8. Running the tests

From `backend/`:

```bash
./node_modules/.bin/tsx --test \
  src/content-source/domain/identity.test.ts \
  src/content-source/ContentSourceService.test.ts \
  src/content-source/jobs/contentSourceQueue.test.ts \
  src/user-import/domain/sharedInput.test.ts \
  src/user-import/UserImportService.test.ts \
  src/user-import/routes.test.ts
```

---

## 9. Phase 2 limitations

- The worker processes content through `ContentSourceProcessor` (Phase 3).
- `video_extraction_cache` is aligned, not read or written.
- No `RECEIVED` sweeper yet — recovery is a re-share (or a later ops sweep on
  `content_sources_status_created_idx`).
- No rate limiting. SSRF / DNS re-validation for user URL fetch is Phase 3 (`safeFetch`).
- Pre-Phase-2 `user_imports` rows (if any) have `content_source_id` NULL.
- Android share target is unchanged.

## 10. What Phase 3 adds

For YT/IG: reuse progressive extract + `video_extraction_cache` via
`videoExtractionCacheLookup`. For product URLs: reuse `MerchantEnrichmentService` /
`previewProductLink`. Still no automatic promotion into `catalog_products`.
