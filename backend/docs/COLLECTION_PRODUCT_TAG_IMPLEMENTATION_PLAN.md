# CollectionProductTag Implementation Plan

**Spec:** [`COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md`](./COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md) (canonical, frozen)  
**Status:** Implement V1 — no commit until requested  
**Template:** Extend existing Collection aggregate (`backend/src/collection/`) — Tags remain owned children, not a separate microservice

---

## Spec decisions locked (V1)

| Topic | Decision |
|-------|----------|
| Writer | **Only CollectionService** / CollectionRepository |
| Unique | `(collection_id, catalog_product_id)` where catalog not null & not deleted |
| Publish gate | ≥1 included+visible Tag; each **must** have `catalog_product_id` |
| Strength | `recommendation_strength` PRIMARY\|SECONDARY (SoT); `is_primary` synced denorm |
| Selection | Frozen `selection_source` enum |
| Note | `creator_note` nullable, length-capped |
| Timestamps | `accepted_at`, `first_published_at` set once |
| Count | `product_tag_count` = visible + include_in_publish only |
| Snapshots | Refresh on accept / publish / explicit refresh only |
| Price | Never snapshot |
| Soft delete | `tag_status=deleted` + `deleted_at` (no hard delete in service) |
| Events | Structured logs (same pattern as Collection/Media) |

**Out of V1 build:** Search dual-write removal, `product_clicks` column wiring, collaborator ACL, future strength values as writable, PI rematch worker.

---

## Architecture

```text
CollectionService ──► CollectionRepository ──► collection_product_tags
       │
       ├── publish gate (resolved + included)
       ├── search compile (visible+included)
       └── emit ProductTag* events
```

---

## Implementation steps

### 1. Migration

`supabase/migrations/20260806210000_collection_product_tag_domain.sql`

- Add: `recommendation_strength`, `selection_source`, `tag_status`, `visibility`, `creator_note`, `creator_action`, `detection_source`, `reason`, `evidence_refs`, `recommended_by`, `accepted_at`, `first_published_at`, `rejected_at`, `archived_at`, `deleted_at`, `snapshot_updated_at`
- Backfill strength from `is_primary`; `selection_source` from `tag_source`; default statuses
- Keep `is_primary` + `tag_source` as legacy/synced columns
- Unique partial index `(collection_id, catalog_product_id)` where catalog not null and deleted_at is null
- Indexes per spec §13 (subset)

### 2. Domain

- Expand `domain/types.ts` enums + `CollectionProductTag` shape + helpers (`isPrimaryTag`, `isPublishSurfaceTag`, map legacy tagSource)
- `domain/tagLifecycle.ts` + tests
- `domain/tagEvents.ts` + emit via observability
- Update `searchSourceCompile` to filter publish-surface tags (visible + include + not deleted/rejected)

### 3. Persistence

- Extend `CreateTagInput` / `UpdateTagPatch` / InMemory + Supabase mappers
- Soft-delete instead of hard `deleteTag` (or `softDeleteTag`)
- Enforce uniqueness in InMemory; DB unique index for Supabase

### 4. CollectionService

| Method | Behavior |
|--------|----------|
| `applyIngestResult` / propose | `AI_DETECTED`/`CREATOR_MANUAL`, `proposed`/`accepted`, strength PRIMARY on first |
| `addTag` | Manual → `CREATOR_MANUAL`, `accepted`, `accepted_at`; unique catalog check |
| `acceptTag` / `rejectTag` | Status + timestamps + events |
| `updateTag` | note, strength (single PRIMARY), include, sort, snapshots |
| `removeTag` | Soft-delete |
| `publish` | Require included+resolved; set `first_published_at` / `published`; count surface tags |
| `refreshTagSnapshots` | Explicit snapshot refresh |
| `refreshTagSummariesAndSearch` | Count surface only; primary from PRIMARY strength |

### 5. HTTP + ingest

- Routes: accept note, strength, accept/reject endpoints (minimal)
- `ingestBridge`: map to `selection_source` + strength

### 6. Verify

- Lifecycle + service tests  
- `npm run build` + `npm test`  
- No commit  

---

## Explicit non-goals

PI rematch worker, Shopping click schema change, Search dual-write cutover, frontend UI, price snapshots, collaborators.
