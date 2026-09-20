# Discover Anywhere — Phase 3: Content Source Processing

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 1: [`mystash-user-ingestion-phase-1-share-capture.md`](./mystash-user-ingestion-phase-1-share-capture.md).  
Phase 2: [`mystash-user-ingestion-phase-2-content-source.md`](./mystash-user-ingestion-phase-2-content-source.md).

Phase 3 makes the global `content-source-processing` job extract reusable product candidates
for one `content_source`. It does not resolve Catalog, write `discovered_products`, or insert
Bag items.

```
User Share
  → user_import
  → content_source
  → BullMQ content-source-processing
  → source extraction
  → product candidate extraction
  → persist candidates on the content_source
```

The processing unit is the global content source. User A, User B, and User C sharing Reel X
produce three `user_imports`, one `content_source`, one job, and one candidate set.

---

## 1. Data model

`supabase/migrations/20260920160000_content_source_products.sql` is additive.

`content_sources` gains:

| Column | Role |
| --- | --- |
| `candidate_count` | Size of the last persisted candidate set. `READY` + `0` = processed with no product |
| `failure_reason` | Set on `FAILED`; cleared on `READY` |

`content_source_products` is the durable global result:

| Column | Role |
| --- | --- |
| `content_source_id` | Owner. Not `user_import_id` |
| `position` | Detectable order |
| `external_id` | Stable within a source; `UNIQUE (content_source_id, external_id)` |
| `name` / `brand` / `model` / `category` / `price` / `currency` / `image` / `merchant_url` / `confidence` | Extracted fields only — missing stays null |
| `extraction_method` | `ai_extract` \| `cache` \| `merchant_enrichment` |
| `sources` / `evidence` | Existing pipeline evidence, plus source metadata |
| `processor_version` | `content-source-processor.v1/{pipelineVersion}` |

RLS is on with **no client policies**. Rows are written by the service-role worker.

Not used as SoT: `ingest_draft_products`, `catalog_products`, `discovered_products`, `cart_items`.

---

## 2. Processing flow

`ContentSourceProcessor` (`backend/src/content-source/processing/`):

1. Load `content_sources` by id. Missing source: log and return (job succeeds).
2. Skip unless status is `QUEUED` or `PROCESSING` (crash/retry claim). `READY` is not reprocessed.
3. `QUEUED|PROCESSING → PROCESSING` (compare-and-set).
4. Load `user_imports` for the source (count/ids for logs; not owners of the result).
5. Dispatch:
   - `VIDEO` → existing `runProgressiveExtract` (`video_extraction_cache` + stage gates)
   - `WEB_PAGE` → existing `canonicalizeProductUrl` + `MerchantEnrichmentService` / `previewProductLink`
6. `replaceProducts` (delete + insert for that source) then `PROCESSING → READY`.
7. Terminal failure → `FAILED`. Retryable failure stays `PROCESSING` and is rethrown for BullMQ (3 attempts, exponential backoff). Exhausted attempts → `FAILED`.

Empty extraction is success: `READY` + `candidate_count = 0`. No fake candidates.

---

## 3. Video processing

`createVideoExtractionAdapter` maps `videoExtractionCacheLookup` onto
`runProgressiveExtract` in `backend/src/stages/progressiveExtract.ts`.

That helper is the existing progressive loop: cache hit/miss, YouTube/Instagram context
builders, `OpenAiReasonerProvider`, `ProductValidator` / `ProductRanker`, `needsStage2Enrichment`
/ `stagePass`, frames/vision only when the existing gates require them, then
`setVideoExtractionCache`. It does not write `ingest_draft_products`, Catalog, or Bag.

Correlation id is `content_source.id`, never `userImportId`.

Private / restricted sources (`source_unavailable`) are terminal.

Creator ingest still runs `stages/orchestrator.ts` for `ingest_drafts` + `resolveIngestDrafts`.
User-content processing does not call that orchestrator and does not invoke ProductResolver.

---

## 4. Web / product URL processing

`createWebEnrichmentAdapter`:

1. `canonicalizeProductUrl` (existing helper — not a second canonicalizer)
2. `MerchantEnrichmentService` + `TavilyMerchantExtractor` (which already calls `previewProductLink`)
3. `previewProductLink` HTML scrape now goes through `safeFetch`

A failed enrichment with no usable title is `READY` + 0 candidates. Thrown network errors are retryable unless `SafeHttpError` is `PRIVATE_DESTINATION` / `UNSUPPORTED_SCHEME` (terminal).

---

## 5. SSRF / fetch protections

`backend/src/pipeline/safeHttp.ts` is the fetch path for user-controlled product URLs.

| Control | Behaviour |
| --- | --- |
| Scheme | `http` / `https` only; userinfo rejected |
| Literal host | Existing `isPubliclyRoutableHost` (loopback / private / link-local / metadata / reserved suffixes) |
| DNS | Resolve, then `isPubliclyRoutableAddress` (IPv4 + IPv4-mapped IPv6) |
| Redirects | Manual, max 5; every hop re-checked |
| Timeout | 18s (same as existing product-preview timeout) |
| Response size | 900KB (same as existing HTML cap) |

Bot protection, CAPTCHA, robots, and access restrictions are not bypassed.

---

## 6. Observability

Same `ingestLog` convention (`svc: content-source`):

| Event | When |
| --- | --- |
| `ContentSourceProcessingStarted` | Claimed `PROCESSING` |
| `ContentSourceExtractionCacheHit` / `Miss` | Video cache lookup |
| `ContentSourceExtractionCompleted` | Extract/enrich finished |
| `ContentSourceCandidatesDetected` | Candidate count (may be 0) |
| `ContentSourceCandidatesPersisted` | Rows written for the source |
| `ContentSourceProcessingCompleted` | `READY`, includes `durationMs` |
| `ContentSourceProcessingRetryableFailure` | Thrown for BullMQ retry; status stays `PROCESSING` |
| `ContentSourceProcessingTerminalFailure` / `Failed` | `FAILED` |

---

## 7. Idempotency

- BullMQ `jobId` remains `content-source-{contentSourceId}`.
- `READY` sources are not claimed again (no implicit reprocess).
- `replaceProducts` deletes then inserts for that `content_source_id` only, so a redelivered in-flight job cannot accumulate duplicate rows.
- `UNIQUE (content_source_id, external_id)` backs that up.
- Two users of the same source share the same `content_source_products` rows. There is no per-user candidate copy.

---

## 8. Running the tests

From `backend/`:

```bash
./node_modules/.bin/tsx --test \
  src/content-source/domain/identity.test.ts \
  src/content-source/ContentSourceService.test.ts \
  src/content-source/jobs/contentSourceQueue.test.ts \
  src/content-source/processing/ContentSourceProcessor.test.ts \
  src/content-source/processing/videoAdapter.test.ts \
  src/content-source/processing/webAdapter.test.ts \
  src/content-source/processing/mapCandidates.test.ts \
  src/pipeline/safeHttp.test.ts \
  src/user-import/UserImportService.test.ts
```

---

## 9. Phase 3 limitations

- Creator ingest still has its own inline progressive loop in `orchestrator.ts` (writes `ingest_drafts` / `resolveIngestDrafts`). User-content processing uses the extracted shared helper and does not share that persist path.
- No `RECEIVED` sweeper. Recovery for never-queued rows is still a re-share.
- No Catalog matching, `discovered_products`, Bag insertion, or Product Page. That is Phase 4+.
- `userImportId` remains on the job payload for tracing only.
- Overlapping in-flight workers can both extract; last `replaceProducts` wins. Cache makes the second extract cheap for videos.

## 10. What Phase 4 adds

Non-promoting resolve of these candidates into Catalog hit vs discovered product, then Bag membership. Phase 3 stops at reusable candidates on the content source.
