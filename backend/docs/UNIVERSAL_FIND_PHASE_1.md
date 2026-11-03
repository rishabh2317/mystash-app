# Universal Find phase 1 — consistent outcomes and reliable automatic saving

Local implementation only. No live migration, deployment, build, or release activation is part of this change.
The existing Share v2 handoff's working modification is preserved separately.

## Scope and compatibility

Capture still means background extraction followed by automatic saving of eligible products and places.
No review queue, mandatory selection, Find screens, image inputs, navigation changes, new notification producers,
or measurement events are introduced here. Those belong to later phases.

Removal-safe persistence is mandatory. The historical foundations switch and its unsafe alternatives have
been removed; Share acceptance/intent/suggestion switches remain independent capture capabilities.
The API checks the read-only `find_schema_version()` at startup and returns 503 before serving feature requests
if the exact schema is missing. `/health` remains liveness only. Embedded and both dedicated ingestion-worker
entrypoints require the same check before starting consumers. No startup code applies migrations.

`/imports` and `/imports/history` require one owner-scoped database snapshot of processing facts and membership
counts. Both use the same outcome projection. Existing screen fields are aliases derived from that outcome,
not independent legacy calculations. The current mobile app requires this outcome contract and derives its
screen model from it; old mobile binaries are outside this release's compatibility scope.

Ten minutes produces a derived delay notice while work remains active. Reporting does not write timeouts,
and new captures no longer schedule presentation-timeout jobs. Previously queued timers drain harmlessly;
late success clears the delay notice and active finds continue polling. Actual extraction deadlines,
leases, cancellation, retry backoff, and stale-worker fencing are unchanged. Explicit retry rejects active
or successfully completed extraction; a save-only failure retries membership without re-extraction.

The new outcome separates processing category, extraction outcome/branches, extracted counts, current saved
counts, synchronization state, terminal timestamp, and available retry kinds. Removed items remain extracted
results but are not counted as saved. Canonical product merges and canonical place deduplication are included
in database counts; names are never identity evidence. Successful zero-result extraction is complete, not failed.
Incomplete historical rows are isolated at one boundary as unavailable/attention, without automatic backfill.
An explicit retry of an owned terminal historical source can initialize a current attempt. No old rows are deleted,
reset, or blanket-resaved; no existing migration is rewritten.

## Storage and recovery

Prepared migration: `supabase/migrations/20261103120000_find_foundations.sql`.

- Existing Cart/place membership rows gain `removed_at` and `explicit_action_at`. Unique identity constraints
  and provenance remain. Catalog merges/place promotions retain the latest explicit action; tied actions
  conservatively retain removal. Automatic delivery cannot clear a removal; explicit add/restore can.
- Place evidence can be retired rather than deleted, preserving removal markers through re-extraction.
  Reappearing evidence reuses its hypothesis. Unrelated unresolved places are never merged by name.
- Existing import rows gain attempt-linked synchronization state, revision, next attempt time, and a claim lease.
  New submissions, processing attempts, and changed source results mark affected visible imports pending.
  Existing historical records are not blanket-marked for saving.
- Existing processing-attempt rows gain a stable terminal timestamp. New attempts clear it.
- New RPCs are service-role-only. User identity comes from verified API authentication. The membership query
  and place mutation RPCs validate ownership; automatic writes serialize visibility with history deletion.
  Direct client writes to Cart and place memberships are revoked so they cannot erase removal markers.
  Owner-scoped reads and existing RLS remain in place.

The existing ingestion consumer's recovery timer claims at most 25 terminal-source deliveries at a time.
It reapplies already-bound product memberships and already-persisted place hypotheses, verifies remaining
missing memberships, then acknowledges only the claimed revision/lease. No search, reasoning, video download,
new extraction, or merchant enrichment is requested by this recovery path. It runs independently of the native
share acceptance switch. Each failed or lost acknowledgement remains recoverable; failed deliveries retry after
30 seconds, and abandoned claims become reclaimable after two minutes.

Normal extraction continues saving partial results immediately. A single user's membership failure does not
fail successful product identification or stop other users' delivery. Place membership failures similarly remain
delivery failures rather than provider failures. A successful sibling branch remains available.

## Existing membership interfaces

- `DELETE /cart/items/:catalogProductId` keeps its existing response; the parameter still accepts discovered
  product IDs through the established fallback. It always records durable removal.
- `POST /cart/items` explicitly adds/restores a catalog product. It also accepts
  `discoveredProductId`, mutually exclusive with `catalogProductId`. Request bodies cannot set the internal
  `automatic` flag; only worker fan-out uses it.
- `DELETE /places/:saveId` removes an owned place membership; `POST /places/:saveId/restore` restores it.
  Existing save redirects remain valid; another user's save returns 404. Retired results cannot be restored
  until they become available again. Storage outages return 503; invalid or retired restorations return 409.

No new `/finds` API is introduced in phase 1. Dashboard queries/result UI remain phase 2 onward.

## Verification and later rollout gates

Focused tests cover extraction-versus-membership counts, late completion, partial/zero failures, mandatory
current DTOs, list/history projection parity, save failure/recovery without provider replay, removal/restoration,
owner checks, and catalog/place merge behavior. The disposable SQL harness additionally validates real grants,
concurrent automatic-save/removal, concurrent recovery claims, stale acknowledgement rejection, history hiding,
retirement/reappearance, stable terminal timestamps, historical preservation, and catalog/discovered aliases.

Reproducible checks include backend/client TypeScript, repository lint, focused backend tests, the existing
Share/Places render adapters, and `python3 -B backend/scripts/findFoundationsSqlScratch.py`. The SQL harness
uses existing local PostgreSQL binaries, a new temporary cluster and private Unix socket; it never loads dotenv,
contacts Supabase, or accesses an existing database. PostgreSQL shared memory requires sandbox approval.

Before a later authorized rollout, apply the additive migration in validation first, then deploy matching API
and ingestion-worker code. Verify active memberships, owned endpoints, existing extraction and recovery there.
Deploy the matching schema, API, worker, and current mobile app as a coordinated release. Once removals exist,
older persistence code cannot safely interpret retained removed rows. Capture flags remain independent of these
mandatory safeguards. Rollback needs a compatible code release; it must not delete retained memberships.

## Limits

- Existing deleted memberships cannot be reconstructed. The durable removal guarantee begins with the matching schema/code rollout.
- Unknown aliases and unrelated unresolved place mentions cannot be suppressed without identity evidence.
- The existing Render sleep/volatile Redis limits and YouTube downloader restriction remain. This phase
  repairs delivery of persisted results, not lost active extraction or provider availability.
- The phase does not add a historical backfill, change identity thresholds, or automatically retry failed
  extraction. Explicit extraction retry continues through the existing fenced processing path.
- Native/device compilation and acceptance are not performed as part of this source-only phase.

## Local verification results — 2026-11-03, approved cleanup

- Affected backend regression run: **371/372 passed**, 48 files. The sole failure remains
  `backend/src/content-source/ContentSourceService.test.ts:264`: its boundary regex rejects the catalog/discovered
  names used by the already-committed repository image projection. Both test and repository match HEAD.
- Focused current-mobile Share/Find, Cart, polling, and activity tests: **67/67 passed**, ten files.
- Expanded client/plugin run: **527/539 passed**, 111 files (before adding the final passing place-promotion case).
  This wider selection exposes twelve failures in unchanged test/implementation files:
  - `src/notifications/linking.test.ts:31`: promo fixture lacks required campaign data (one failure).
  - `src/theme/tokens.test.ts`: four expectations disagree with the committed monochrome/card defaults.
  - `src/ui/chrome.test.ts` and `src/ui/contracts.test.ts`: two expectations still require the old signed-out Stash copy.
  - Five files fail to load under the current TS/CommonJS harness because `import.meta.dirname` is undefined:
    `src/services/reelLikeEngagement.test.ts`, `src/ui/collectionProductCard.test.ts`,
    `src/ui/collectionTileNavigation.test.ts`, `src/ui/feedShop.test.ts`, `src/ui/searchReelNavigation.test.ts`.
  These are additional findings from broader coverage, not fixes included in Phase 1 cleanup.
- Backend/client TypeScript passed. Repository lint: zero errors, 23 existing warnings. Explicit lint of all
  52 changed/new backend TypeScript files: zero errors, 12 array-style warnings.
- All **32 Share + 60 Places/Create/Profile** render-adapter checks passed; no native/device execution.
- Disposable PostgreSQL checks passed ownership/grants, restricted direct membership writes, exact schema version,
  discovery/saved/verified-place counts, promotion, removal/restoration, catalog/discovered aliases, provenance,
  retirement/reappearance, expired/stale claim rejection, concurrent add/remove, concurrent recovery claims,
  hidden imports, stable terminal timestamps, and preservation without historical backfill.
- The original Share v2 handoff working file retains SHA256
  `9c1d9ade39a3d63b1bb16a1bc8926dabc9f08fc468a2651c7fdb579ca9eb9a43`.
  Branch remains `codex/share-v2-pilot`, HEAD remains checkpoint `570cf49`; nothing is staged or committed.

No live migration, deployment, build, data reset/deletion, or Phase 2 implementation was performed.

## Phase 2 supersession

The local Phase 2 query/action implementation is documented in `UNIVERSAL_FIND_PHASE_2.md`. It advances the
required schema version to 2 and centralizes production outcomes in the database so global filters/counts and
both API generations agree. The TypeScript projection above is retained as an offline parity reference.
Phase 1 behavior, removal protections and the original verification record remain preserved.
