# Universal Find Phase 2 — queries, history, and result actions

Implemented locally on `codex/share-v2-pilot`, above the uncommitted Phase 1 foundation. No Phase 3 UI,
new capture pipeline, notification producer, analytics event, native change, build, deployment, or live
migration is included. The original Share v2 handoff working file is preserved byte for byte.

## Read architecture

`20261103130000_find_queries.sql` adds service-only query/action functions over existing user imports,
source results, Cart/place memberships, and Share review receipts. It adds no tables, columns, historical
backfill, data reset, or duplicated ingestion state. Existing Share v2 migrations and the Phase 1 foundation
must precede it. It reuses the existing `(user_id, created_at DESC, id DESC)` visible-history index.

`find_project_outcome` is the production outcome authority for both old and new API readers. Filtering,
global counts, list rows, and detail results are evaluated inside the database statement snapshot. The
Phase 1 TypeScript projector remains an offline reference used by in-memory tests and a 1,920-case SQL
parity corpus; production routes no longer calculate a second outcome independently.

The schema preflight now requires version **2** on API and worker entrypoints. Only a separately authorized,
coordinated schema/API/worker/mobile rollout can activate this source. No startup path applies migrations.

- `GET /finds?limit=20&cursor=…&filter=all`: `{items,nextCursor,counts}`. Limit 1–50. Filters:
  `all`, `processing`, `completed`, `attention`, `saved`.
- `GET /finds/counts`: full visible-history `{all,processing,completed,attention,saved}`.
- `GET /finds/:findId`: owned source metadata, private intent, authoritative `outcome`, complete source
  `products`, active source `places`, previously accepted `savedSuggestions`, and feature capabilities.
- `POST /finds/batch` with `{ids:[…]}`: up to 100 unique loaded IDs, returning `{items,unavailableIds}`.
  Hidden, absent, and foreign IDs have the same unavailable treatment; no reason or foreign data is disclosed.

Each list response counts the full visible history, including records outside the cursor and page.
`processing + completed + attention = all`; `saved` overlaps those categories and means a Find with at least
one currently active product/place membership. It is not a unique Stash inventory count. Per-Find product
counts normalize known catalog/discovered aliases; place counts normalize resolved canonical identities
while keeping unrelated unresolved hypotheses separate. Removed items remain found results, with saved
counts reduced. Unbound product evidence can be present in detail without inventing an identified product.

Accepted similar candidates also contribute their known identities and current memberships. They stay
explicitly labeled **similar**, including after removal or restoration; accepted receipt IDs are not turned
into exact source bindings. Their metadata is also included in the old API product-preview arrays so
existing consumers retain their response fields while sharing the authoritative counts.

Keyset cursors reuse the existing parser and preserve PostgreSQL microseconds and ID ties. Pagination is a
live history: a new capture above the current cursor is discovered by head refresh, and a processing record
can move between filters. Page requests are individually coherent, not a long-lived database snapshot.

## Actions and ownership

All routes use the existing verified-email authenticator, derive ownership from that session, and return
private/no-store responses. New RPCs fix their search path and deny execution to PUBLIC, anon, and authenticated;
only service-role execution is granted. Existing RLS and membership-write restrictions remain intact.

- `DELETE /finds/:findId`: hide this user's history entry through the existing import service; Stash remains.
- `POST /finds/:findId/retry` with `{kind:"extraction"}` or `{kind:"saving"}`: reuse the existing fenced
  processing or membership recovery. Active work is not restarted; save retry performs no extraction/provider work.
- `DELETE /finds/:findId/products/:resultId` and `POST …/restore`: remove/restore the owned source result's
  global membership. Supply `{expectedIdentity:"c:<uuid>"}` or `"d:<uuid>"` from detail. A changed binding
  returns 409; known catalog/discovered merges normalize the token rather than guessing identity.
- `DELETE /finds/:findId/places/:resultId` and `POST …/restore`: remove/restore via the current owned hypothesis,
  existing canonical locks, retained memberships, and source attribution. No client identity override is accepted.
- `PATCH /finds/:findId/intent`: existing `{intent:{kind,note},expectedRevision}` and revision conflict behavior.
- `GET /finds/:findId/suggestions` and `POST …` with `{sourceProductId,candidateKey,action}`: reuse the extracted
  Share suggestion service, including existing evidence/merchant validation and review claims.
- `DELETE /finds/:findId/suggestions/:resultId/:candidateKey` and `POST …/restore`, with `expectedIdentity`:
  remove/restore a previously accepted suggestion's membership without re-running suggestion generation.

Core Find reads and membership actions do not depend on capture acceptance, intent, or suggestion flags.
Intent editing retains its own flag. New suggestion decisions retain the suggestion flag. Previously accepted
suggestions remain visible and removable/restorable when new suggestions are disabled. Existing `/imports`,
`/imports/history`, intent and review URIs, acknowledgement shapes, and their feature gates remain intact.

`find_accept_suggestion` commits the existing review receipt and `find_cart_put` membership in one transaction,
using the claimed lease and visibility checks. The service still validates existing candidate evidence first;
no new provider request is added. Lost acknowledgement replay returns the committed receipt and cannot restore
a later removal. An expired lease or failure writing the receipt rolls back the membership as well. Cart
observability retains its existing event after successful finalization.

Explicit result actions affect the single global Stash identity, so another Find referencing that same
identity reflects removal/restoration on its next read. Neither action deletes the extracted evidence.
Automatic saving and subsequent worker replay retain durable removal markers.

## Client data layer for Phase 3

`src/services/findClient.ts` provides the API contract, request bounds, response validation and actions;
`findApi.ts` wires it to the existing Supabase session and ingest endpoint. It starts no polling or UI.
`refreshLoaded` refreshes all loaded active/delayed/save-pending/save-failed records in batches of 100,
including records older than the head page. Terminal history remains in place, unavailable records are removed,
and a failed/incomplete/foreign reply leaves the caller's existing snapshot intact. One authenticated owner is
retained across all chunks, and a session/account change rejects the whole refresh. Client list responses carry
a local `ownerId` stamp; pass that loaded-history owner into `refreshLoaded(items, ownerId)`, including when all
items are terminal. This prevents retaining another account's old terminal history after an account switch. Phase 3 must call it only
while the relevant screen/app is active and refresh authoritative global counts rather than tallying loaded rows.

## Verification and release limits

Reproduce the database/API checks with `python3 -B backend/scripts/findQueriesSqlScratch.py`.
It runs Phase 1 regressions first, then existing Share migrations and Phase 2 in a fresh, self-owned,
Unix-socket-only PostgreSQL fixture. It never loads dotenv or contacts Supabase. It covers 1,205-record history,
microsecond cursor ties, unloaded/filter counts, 1,006 source detail rows, accepted similar identities,
server-route/query/SQL integration, service grants, owner isolation, hidden records, stale actions, expired
Save leases, forced post-membership receipt failure/rollback, removal versus automatic delivery,
place promotion/removal, coherent reads during mutations, intent revision races, and committed Save replay.

Global counts require database work proportional to the visible history and its normalized identities.
The large fixture proves correctness past normal REST row caps; it is not a production load benchmark.
Detail returns complete stored source results, not an invented fixed-size subset. Calls are bounded; real-world
capacity and mobile/device acceptance remain release validation work. Render sleep, volatile Redis limitations,
and the existing YouTube downloader limitation remain. No failed extraction is automatically replayed wholesale.

## Final verification — 2026-11-03

- Affected backend tests: **382/383 passed** across 51 files. The only failure is the unchanged
  `backend/src/content-source/ContentSourceService.test.ts:264` boundary assertion rejecting catalog/discovered
  references in the already-committed source-image projection. No unrelated fix is included.
- Focused client Find/Share/Cart/history/polling tests: **74/74 passed**, eleven files. These include multi-batch
  refresh past the head page, opaque cursors/global counts, incomplete/foreign replies, failed refresh preservation,
  and account changes during requests and with terminal-only loaded history.
- Backend and client TypeScript passed. Repository lint: zero errors and 23 existing warnings. Explicit lint
  of changed/new backend TypeScript plus the new client modules: zero errors and 12 existing array-style warnings.
- The disposable SQL suite and real handler/query/PostgreSQL integration passed every check described above,
  including 1,920 outcome parity cases, 1,205 history records, all source detail rows, suggestion receipt rollback,
  durable removal, promotion, visibility/ownership, microsecond pagination, and concurrent mutations.
- Python syntax and tracked diff whitespace checks passed. No production integration, native/device execution,
  migration rollout, release build or production load test was run.
- The twelve broader client failures recorded in the Phase 1 report remain outside this change: notification
  campaign fixture (one), theme defaults (four), signed-out Stash copy (two), and CommonJS `import.meta.dirname`
  file-loading failures (five). That broad client suite was not rerun in Phase 2; the affected client tests above passed.
- All 65 pre-existing dirty files remain present. The Share v2 handoff's original SHA256 remains
  `9c1d9ade39a3d63b1bb16a1bc8926dabc9f08fc468a2651c7fdb579ca9eb9a43`. Branch remains `codex/share-v2-pilot`,
  HEAD remains `570cf49`; nothing is staged or committed. No files or existing data were deleted or reset.

## Phase 2 source scope

These are the files added or extended during Phase 2 (the larger working tree also retains Phase 1 work):

```text
backend/.env.example
backend/docs/UNIVERSAL_FIND_PHASE_1.md
backend/docs/UNIVERSAL_FIND_PHASE_2.md
backend/scripts/findFoundationsSqlScratch.py
backend/scripts/findQueriesSqlScratch.py
backend/scripts/sql/find_queries_checks.sql
backend/src/index.ts
backend/src/user-import/UserImportService.test.ts
backend/src/user-import/UserImportService.ts
backend/src/user-import/find/contract.ts
backend/src/user-import/find/membershipQuery.ts
backend/src/user-import/find/outcome.test.ts
backend/src/user-import/find/outcome.ts
backend/src/user-import/find/outcomeParityFixtures.ts
backend/src/user-import/find/projectionIntegration.test.ts
backend/src/user-import/find/queries.test.ts
backend/src/user-import/find/queryIntegrationRunner.ts
backend/src/user-import/find/queryService.ts
backend/src/user-import/find/routes.test.ts
backend/src/user-import/find/routes.ts
backend/src/user-import/find/schema.test.ts
backend/src/user-import/find/schema.ts
backend/src/user-import/find/testSnapshot.ts
backend/src/user-import/find/validation.ts
backend/src/user-import/resultReporting.test.ts
backend/src/user-import/share/history.ts
backend/src/user-import/share/reviewRoutes.ts
backend/src/user-import/share/reviewService.test.ts
backend/src/user-import/share/reviewService.ts
src/services/findApi.ts
src/services/findClient.test.ts
src/services/findClient.ts
supabase/migrations/20261103130000_find_queries.sql
```

Stopped after Phase 2 for review. Phase 3 screens/navigation remain unimplemented.
