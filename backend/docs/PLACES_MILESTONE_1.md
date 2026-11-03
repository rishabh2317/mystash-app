# Places milestone 1 — correctness and result reporting

Deployment update (2026-10-28): the user subsequently approved the two Places migrations,
backend restart, and an internal Android APK. See [device-test release](./PLACES_DEVICE_TEST_RELEASE.md).
The local-only statements below describe the original milestone implementation.

Status: implemented locally; not deployed. No live migrations, provider requests,
tracking changes, dependency installation, or native/cloud builds were performed.

## Scope

- Preserve the existing shared AI extraction, prompts/providers, product validation,
  caps, and Creator ingestion. Downstream product/place resolution stays parallel.
- Add durable, independent user-import product/place outcomes and show partial results.
- Retry a failed downstream branch from persisted evidence while retaining the
  successful sibling. Shared extraction failure still uses the original retry path.
- Attach existing places for late importers without searching/extracting again.
- Preserve saved leads when a less informative re-extraction omits them.
- Restart the user-facing timeout on deliberate retry/re-share. Fence stale timeout
  writes by the expected retry clock; old delayed jobs cannot freeze a new attempt.
- Hide history rather than deleting imports referenced by saved entities.
- Refresh Places on committed discoveries/promotions, fence stale account/request
  responses, and expose a Places destination through the existing Stash screen.

## Additive API contract

`GET /imports` keeps `shares`, the four legacy `state` values, `productCount`,
`products`, `primaryProduct`, acknowledgement bodies, URLs, and authentication.
Legacy product counts/cards remain gated by overall READY and timeout behavior.

New optional fields use `resultVersion: 1`:

- `resultProductCount`, `resultProducts`: distinct persisted catalog/discovered
  bindings, available during partial processing/failure. These mean products found;
  they are not raw AI hypotheses or a guarantee that every Cart fan-out write succeeded.
- `placeCount`, `resolvedPlaceCount`, `unverifiedPlaceCount`: persisted discoveries
  for the imported source, including identities already saved from another source.
  Resolved provider identities count once; unrelated unresolved hypotheses stay distinct.
- `productStatus`, `placeStatus`: running / complete / failed / unknown. Running
  includes scheduled automatic retry backoff. Complete plus zero means empty.
- `hasInFlight`: polling continues while either branch is running, independently of
  the legacy overall state. A user-facing timeout stops it.
- `canRetry`: a branch failed and no sibling is still running, or the attempt timed out.
- `timedOut`: preserve the activity timeout notice even when late results reach Stash.

The API reads completion before entity counts so a commit racing a poll cannot publish
COMPLETE with an older zero count. Counts reflect retained discoveries; reprocessing
does not erase previous user saves merely because the newest model output omitted them.

Historical sources without a branch ledger do not have trustworthy place completion
evidence. Report `unknown` for their completed video Places branch instead of inventing
a successful empty result. New clients understand old API payloads and use neutral
“Results ready” for legacy READY with no known product count. Old clients ignore the
additive fields and keep their existing overall-state behavior.

Provider failure keeps the useful unverified lead and reports verification failure.
The existing Retry action requeues the source; the processor skips the successful
downstream sibling when its extraction-version fingerprint matches. If place evidence
could not be persisted at all, the existing extraction/cache path recovers it without
replacing successful product rows. No second AI extraction method was added.

## Database preparation — deploy later

`supabase/migrations/20261028120000_user_import_result_reporting.sql`:

1. Adds nullable `user_imports.attempt_started_at` and `hidden_at`. Existing records
   retain their creation time; null retry clocks fall back to it.
2. Adds private `content_source_import_progress`, one row per content source, with
   attempt UUID, start time, extraction-version fingerprint, and both branch statuses.
   RLS is enabled; PUBLIC/anon/authenticated have no table access. Only service-role
   backend reads/writes it. No prompts, raw responses, credentials, or user IDs are stored.

No backfill, purge/reset, product/creator/Analytics alteration, or canonical identity
merge is included. Apply this migration before releasing the matching API/worker.
Then deploy API and worker together, and the compatible client afterward. Existing
sources can remain without ledger rows until processed. Do not deploy an old API that
physically deletes hidden history: it can still encounter the existing restrictive FK.
Compatible rollback should retain the additive schema and history/privacy behavior.

Local migration verification uses `python3 backend/scripts/placesReportingSqlScratch.py`.
It initializes its own PostgreSQL cluster under `/private/tmp`, disables TCP listeners,
uses a private Unix socket, and shuts down/removes only that cluster. It does not read
dotenv/connection URLs or use Supabase CLI. PostgreSQL must already be installed;
the script never installs it. It applies the real baseline import/source/place migrations
and the new migration, then verifies preservation, private grants/RLS, service writes,
status constraints, stale reporting, history hide/restore, restrictive provenance FK,
and timeout compare-and-set.

## Local verification

- Final run: 316 Places/import/content-source/product/manual-ingest tests passed,
  plus 132 Analytics/engagement tests passed (448 total). The 24 new milestone
  regressions are included in these totals. No failed or skipped tests in these runs.
- Both TypeScript checks and the disposable PostgreSQL checks passed. Focused lint
  across changed TypeScript files has zero errors and ten pre-existing Array-style
  warnings; none comes from newly introduced Array syntax.
- New fixture regressions cover all result combinations, both partial-completion
  orders, provider/product failures, automatic and explicit retries, source/cache
  call counts, late importers, duplicate canonical discoveries, history restore,
  retry clocks, stale timeout/attempt writes, completion/read races, old/new payloads,
  navigation, polling, promotion refresh, and account/request response fencing.
- Existing Places, import, content-source, product resolver, and manual-ingest tests.
- Existing Analytics/engagement/privacy/worker regression suites.
- Client/backend TypeScript, focused lint, and whitespace checks.
- Preserve the six pre-existing Creator Studio diffs; prompts, provider adapters,
  progressive extraction, creator orchestrator, Analytics sources/migrations,
  Android configuration, identifiers, Expo/EAS configuration, and dependencies unchanged.

## Remaining work and deployment gates

- No real-provider quality, Android/iOS interaction, or hosted-device validation was
  performed. Run those checks under the separately approved rollout after deployment.
- This milestone does not split model discovery or move place work ahead of shared
  progressive extraction. It does not redesign Places cards or unify their sections.
- Cross-source saved provenance and atomic canonical promotion/merge remain the
  next persistence milestone. The existing canonical-save uniqueness/merge behavior
  remains; a duplicate source's direct save attribution can still be lost. Discovery
  reporting now counts that source correctly, without fabricating another card.
- Attempt fencing here protects reporting and timeout writes. It is not a new lease
  protocol for every entity write; existing BullMQ global work identity still applies.
- Source counts mean discoveries, not new saves. Cart fan-out remains its existing
  best-effort behavior. Its attachment-delivery acknowledgement/reconciliation is
  separate from successful product identity resolution.
- Retry timers remain best-effort; GET /imports self-heals at the current attempt's
  deadline. The stable delayed job may be from an older attempt and is safely ignored.
- Retained leads can include older extraction mistakes; a later explicit correction/
  removal policy must not infer deletion from a transient empty model response.
- List/query batching, provider deadlines/budgets, source-thumbnail propagation,
  multi-source attribution, and device UI/accessibility checks remain later milestones.

## Changed files

Backend processing and reporting:

- `backend/src/content-source/jobs/contentSourceWorker.ts`
- `backend/src/content-source/processing/ContentSourceProcessor.ts`
- `backend/src/content-source/processing/createProcessor.ts`
- `backend/src/content-source/processing/createResolvingProcessor.ts`
- `backend/src/place/PlaceResolver.ts`
- `backend/src/place/persistUnresolvedPlaceLeads.ts`
- `backend/src/place/syncImportPlaces.ts`
- `backend/src/user-import/ImportProgressRepository.ts`
- `backend/src/user-import/InMemoryUserImportRepository.ts`
- `backend/src/user-import/SupabaseUserImportRepository.ts`
- `backend/src/user-import/UserImportRepository.ts`
- `backend/src/user-import/UserImportService.ts`
- `backend/src/user-import/domain/shareProgress.ts`
- `backend/src/user-import/domain/types.ts`
- `backend/src/user-import/factory.ts`

Shared Android/iOS presentation:

- `app/(tabs)/stash.tsx`
- `components/search/ShareActivityCard.tsx`
- `components/search/YourActivitySection.tsx`
- `src/hooks/importSharePoll.ts`
- `src/hooks/useImportSharesPoll.ts`
- `src/services/importShareMap.ts`
- `src/ui/bag.ts`
- `src/ui/shareActivity.ts`
- `src/ui/placesRequestScope.ts`

Regression checks, database preparation, and notes:

- `backend/src/place/PlaceResolver.test.ts`
- `backend/src/place/persistUnresolvedPlaceLeads.test.ts`
- `backend/src/user-import/UserImportService.test.ts`
- `backend/src/user-import/resultReporting.test.ts`
- `src/ui/importResultReporting.test.ts`
- `src/ui/placesRequestScope.test.ts`
- `backend/scripts/placesReportingSqlScratch.py`
- `supabase/migrations/20261028120000_user_import_result_reporting.sql`
- `backend/docs/PLACES_MILESTONE_1.md`
