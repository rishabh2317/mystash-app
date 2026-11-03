# Creator Studio publication concurrency

Local implementation and verification, 2026-10-28. Nothing deployed.

## Audit

`backend/src/publish.ts` previously used a process-local Set to serialize requests. `ensureCollectionLinkedToIngest` in `backend/src/collection/ingestBridge.ts` creates a legacy draft's Collection, attaches media, then writes `ingest_requests.collection_id` through separate REST transactions. Two replicas could both read NULL, insert different Collections and replace the link. A crash/link-write failure could also leave an unlinked Collection. Reading the link afterward detected some failures but did not prevent them.

The rest of publication also spans transactions. `CollectionService.publish` validates eligibility/ownership/moderation, selects and publishes product tags, updates search/discovery fields and emits diagnostic domain events. Video insertion/update, removal/replacement of video products and ingest finalization previously followed independently. A late failure could leave a damaged old feed projection. The existing `videos(collection_id)` unique index already protects one video per Collection; it does not prevent duplicate Collections for one ingest.

The canonical identity is the **ingest ID**, with its persisted `collection_id`. Source URL equality is not a publication identity: different drafts may intentionally use the same URL. Existing linked Collection IDs and independent video IDs must be preserved. Current client publication targets the Node `/publish` endpoint, with no fallback to the historical Edge function.

## Changes

The new migration `20261028140000_publication_concurrency.sql` introduces:

- One private, service-only lease row per ingest, with a random attempt token, a 120-second expiry and token-checked renew/release RPCs. The API renews every 30 seconds and releases in `finally`. A second active request receives a retryable conflict. No permanent process-crash lock remains.
- A request-specific Supabase transport sends the lease scope to database write guards. Each guarded write **locks the lease row for its entire transaction**, then validates token/expiry. A takeover waits behind in-flight writes. A paused/expired old owner cannot write after takeover or release its successor's token. This is necessary in addition to lease expiry; a timer alone is insufficient.
- Collection insert triggers run only with a publication scope. They check the current draft and creator, prevent a second Collection, and link a newly inserted Collection within that same database transaction. A failed link rolls back the insert itself. The existing CollectionService still supplies all creation fields and slug/snapshot semantics.
- An ingest identity trigger rejects replacing an existing non-NULL Collection link. Existing foreign-key deletion behavior can still clear it. Transition to `published` requires the matching owned published Collection and its actual video.
- `publication_finalize` atomically upserts the existing Collection's video, replaces its video products, marks the ingest published, and records the existing moderation fact. A failure at any point rolls back that entire RPC, retaining the old projection and draft status. A finalized retry returns the original IDs without replacing products or adding another fact.

The API uses the scoped client for both Publish and Discard branches. The default Supabase transport is unchanged for every other caller. If a legacy creation committed before media attachment failed, retry repairs missing primary media on the same Collection. Existing partial-finalization recovery continues to skip republishing an already-published Collection with the same product selection. Resolution jobs and success notification enqueue happen only after finalization commits; existing notification deduplication remains in place.

No client fields, response keys, selection rules, prompts/providers, extraction, UI, Analytics, dependency or native configuration changed. Existing failed-draft retention and successful client cleanup remain intact. The local Set remains only as a fast duplicate-tap guard; correctness comes from PostgreSQL.

## Transaction boundary

This is a fenced, resumable workflow with two explicit atomic boundaries: Collection creation/linkage and final feed projection/ingest finalization. It does **not** pretend that several REST requests form a single long-lived PostgreSQL transaction.

As before, `CollectionService.publish` can commit its published Collection checkpoint before projection finalization. If finalization fails, that owned Collection remains published and linked; its content revision/selection is not rolled back or republished on retry. The finalizer's old video/products and unpublished ingest status are rolled back together. This preserves the existing partial-publication retry semantics while preventing competing replicas from interleaving their writes. External logs/notifications cannot be rolled back by a database transaction; no new event infrastructure was introduced.

## Verification

- Backend and client TypeScript checks passed.
- Changed TypeScript files passed ESLint with zero errors or warnings; `git diff --check` passed.
- The relevant regression sweep covered 493 cases across publication, Collection, Catalog, Places, user-import, Analytics, notifications and client publication/draft cleanup. Two sandbox-blocked local HTTP tests passed when rerun with permission to bind temporary ports. No application backend was started.
- Focused publication tests cover independent process guards sharing one DB claim, request-local headers, transport preservation, late writes after release, renewal loss, successor-safe release, absent-migration failure, malformed/stale finalizer responses, retained ownership/moderation gates, stable IDs and deferred client flow cleanup.
- `python3 backend/scripts/publicationSqlScratch.py` runs the real migration against a newly initialized Unix-socket-only PostgreSQL cluster using the existing local PostgreSQL binaries. It never reads dotenv or database URLs and cleans up only its own temporary cluster. Checks include private grants/RLS, owner/scope/status gates, 12 competing claims, concurrent full publication sequences for both linked and unlinked drafts, Publish/Discard serialization, lost-ack retry, atomic Collection/link rollback, invalid-product rollback, late failure after ingest update, preservation of the old video/products, no duplicate finalization fact, and an in-flight write racing expiry/takeover. All passed.

The full-request SQL tests exercise the same claim/create/checkpoint/finalize/release sequence through independent database connections. They are not a deployed PostgREST or device end-to-end test. Existing CollectionService and client lifecycle behavior is additionally covered by the TypeScript regression suite.

## Later release requirements

1. Pause/drain old `/publish` requests before applying the migration and replacing all API replicas. Headers from the new API fence its writes; an old binary does not supply them. Do not run mixed publisher versions. Verify the historical Edge `publish-ingest` endpoint is not accepting production traffic before rollout; it is unchanged by this scoped implementation.
2. Apply only the prepared migration, then release the matching API. If the migration is absent, the new API fails closed with a retryable unavailable response; it never silently falls back to the old unsafe path.
3. Rehearse through PostgREST in staging: two API replicas publish one draft simultaneously; retry after lost acknowledgement; fail finalization; stop a worker until lease expiry; retry via the successor; confirm stable IDs, one projection and clean active drafts.
4. Keep all replicas on the matching version. To roll back, disable/drain publication first; do not reintroduce an unfenced publisher while allowing traffic. No existing Collections or business records should be deleted to roll back.

No production migration, service restart, deployment, worker run, dependency install, native build or paid provider call was performed in this task.

## Files changed

- `supabase/migrations/20261028140000_publication_concurrency.sql`
- `backend/src/publicationLease.ts`
- `backend/src/publicationLease.test.ts`
- `backend/src/publish.ts`
- `backend/src/publishLifecycle.ts`
- `backend/src/publishLifecycle.test.ts`
- `backend/src/supabase.ts` (optional request-specific transport; same default)
- `backend/scripts/publicationSqlScratch.py`
- `backend/scripts/sql/publication_checks.sql`
- `backend/docs/PUBLICATION_CONCURRENCY.md`
