# CollectionMedia Implementation Plan

**Spec:** [`COLLECTION_MEDIA_DOMAIN_SPEC.md`](./COLLECTION_MEDIA_DOMAIN_SPEC.md) (revised)  
**Status:** Ready to implement — no commit until requested

---

## Spec decisions locked

| Topic | Decision |
|-------|----------|
| Lifecycle field | Domain **`processingStatus`** (not `status`); prefer DB `processing_status` |
| Provider creator | **`providerCreatorId`** + **`providerCreatorName`** (no single `source_creator`) |
| Same external video, many Collections | **Always one CollectionMedia row per Collection**; never share aggregate rows |
| Extract reuse | Separate **cache** keyed by `(source_provider, external_id)` |

**Defaults for remaining open questions:**

- Collection publish allowed if media `processingStatus != ready` (backward compatible)
- Source unavailable → flag only on media
- `latestArtifactBundleRef` ← `ingest_pipeline_runs.id` when present
- Events → structured logs; payload uses `processingStatus`

---

## Architecture

```text
CollectionService ──► CollectionRepository ──► collection_media
       ▲
Ingest / Orchestrator
       │
       └── extractionCache (provider, external_id) ── seed metadata only
```

- CollectionMedia remains part of the **Collection aggregate**
- **Only CollectionService** (or internal helper it owns) mutates media
- No Search / Feed / Recs / Analytics / frontend work
- No native upload, CDN, HLS, transcoding, multi-media

---

## Implementation steps

### 1. Migration

New Supabase migration altering `collection_media`:

- Add: `source_provider`, `media_kind`, `external_id`, `canonical_url`, `title`, `provider_creator_id`, `provider_creator_name`, `language`, `region`, `source_published_at`, `source_availability`, **`processing_status`**, `transcript_status`, `media_understanding_status`, job/artifact refs, sync/process timestamps, attempts/error, `schema_version`, `extensions`
- Align/replace legacy thin `processing_status` / `media_type` usage; app stops using `video_native` / gallery `sort_order`
- Indexes: unique `(collection_id) WHERE is_primary`; non-unique `(source_provider, external_id)`; `(processing_status, updated_at)`
- Backfill: `processing_status='ready'`, `is_primary=true`, `media_kind='video'`

### 2. Domain + persistence (`backend/src/collection/`)

- Update `domain/types.ts` to full media shape
- Add `domain/mediaLifecycle.ts` + tests
- Media events (`MediaAttached`, `MetadataSynced`, `MediaProcessing*`, `SourceUnavailable`) with `processingStatus` in payload
- Extend `CollectionRepository`, `SupabaseCollectionRepository`, `InMemoryCollectionRepository`

### 3. CollectionService write API

| Method | Behavior |
|--------|----------|
| Attach primary external | Always **insert new row**; `processingStatus=imported`; emit `MediaAttached`; update Collection denorm |
| Sync metadata | Title, thumb, creator id/name, availability; emit `MetadataSynced` |
| Start / complete / fail processing | Transitions + job/artifact refs + events |
| Mark unavailable / archive | Spec ops |

Optional: read `extractionCache` by `(provider, externalId)` to seed — never link another Collection’s media id.

### 4. Wire ingest

- `ingestBridge.ts` — new attach + metadata
- `orchestrator.ts` — processing start/complete/fail; sync YouTube title/creator id/name/thumb; set artifact ref from pipeline run
- Do not store OCR/frames on media; leave PI/Catalog/Shopping unchanged

### 5. HTTP

- `routes.ts` — Collection-owned external attach only; no upload fields

### 6. Verify

- Tests: lifecycle; two Collections + same external id → two media rows; creator id/name; events
- `npm run build` + `npm test`
- No commit

---

## Files likely touched

| Area | Path |
|------|------|
| Migration | `supabase/migrations/20260806*_collection_media_external_ref.sql` |
| Types / lifecycle / events | `backend/src/collection/domain/*` |
| Repos / service / tests | `backend/src/collection/Collection*.ts`, `*Repository.ts` |
| Ingest | `ingestBridge.ts`, `stages/orchestrator.ts` |
| Routes | `backend/src/collection/routes.ts` |
| Cache (optional clarity) | `backend/src/services/extractionCache.ts` |

---

## Explicit non-goals

Hosting/upload/CDN/HLS, shared media rows, carousels/multi-media, Search/Feed/Recs/Analytics consumers, frontend.
