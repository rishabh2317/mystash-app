# Universal Find Phase 6 — Notifications and Measurement

Implemented locally on `codex/share-v2-pilot`, based on checkpoint `ab6df7c89c7d36f582c10456cbd5e139ebc923ea`.
This is an implementation and verification record, not rollout approval. No Phase 7 work, dependency installation, native changes, builds, deployments, production flags, live migrations, commits, or pushes were performed.

## Capture-level notifications

- Added `find.completed` and `find.failed` to the existing task notification registry, rendering, push text, and client/server deep-link allowlists.
- Completion uses one capture summary for found, partial, or zero-result outcomes. Failure uses generic needs-attention copy. Payloads carry only an opaque Find ID and a bounded outcome; no URLs, thumbnails, OCR, filenames, notes, hashes, or private media paths.
- The existing ingestion consumer's bounded reconciliation loop reads the authoritative Phase 2 outcome, waits for terminal extraction and terminal Stash synchronization, then hands off to the existing notification outbox. Processing updates and delayed active work do not send terminal alerts.
- Persisted receipt markers and outbox enqueue commit in the same transaction. An enqueue failure leaves the receipt retryable. Concurrent consumers use locks and deterministic recipient/import/attempt keys. One successful completion is permitted per import, including across explicit retries; distinct failed attempts can generate their own needs-attention event.
- Cached/shared sources notify each new importer once without pretending that cached extraction started again. Pre-release imports are not backfilled; an explicit retry can observe its new attempt without backfilling historical acceptance.
- Existing task inbox policy, task push preferences, OS permission/registration rules, quiet hours, provider policy, retry limits, and kill switches remain authoritative. Creator Studio ingest producers, social producers, and campaigns are unchanged.
- Hidden Find records are fenced before materialization and again before beginning a push. Hiding a record removes existing Find inbox visibility. Restoration does not resend an already acknowledged event.
- This guarantees a deduplicated logical capture event, not exactly-once delivery by an external push provider. Existing task policy can retry an ambiguous provider send; multiple registered installations retain the existing per-installation delivery behavior.

## Measurement and privacy

Client observations reuse the existing consent-aware analytics queue: Find opened, capture action chosen, capture submitted, explicit cancellation, and owned results opened. Capture submitted means a local submission/secure enqueue action, not server acceptance or successful extraction. Camera/gallery cancellation is observed when the picker returns cancellation; URL cancellation is observed through the explicit capture-screen Back action.

Existing product/place exposure policies, product-open measurements, and merchant outbound measurements are reused with the Find surface. Only existing canonical product/place identities are used; unresolved place identities are not fabricated. The existing visible-dwell, foreground, focus, consent, and session deduplication rules still apply.

The existing analytics store, validator, RPC, consent preferences, retention/erasure paths, and aggregate admin report now accept bounded Find events. No separate analytics store or reporting dashboard was added.

- Accepted, actually started, terminal processing, and Stash synchronization facts are derived from persisted server outcomes and timestamps. Operational event IDs are deterministic per import/attempt/event and are atomically acknowledged by reconciliation.
- Worker facts have **no client session ID**. They require current account measurement consent matching the revision captured at acceptance or explicit retry. Activity identity is included only with the separate account activity opt-in; aggregate-only events discard the private Find ID.
- `find.processing_failed` covers a terminal Find pipeline failure and carries `failure_class=extraction|saving`; a saving failure is not represented as successful extraction-to-Stash delivery. Partial extraction with successful saving is a completed event with `outcome=partial`. Counts are extracted-result buckets (`0`, `1`, `2-5`, `6+`), not saved-stock counters.
- Result removal/restoration observations run server-side only after an authorized successful action, using the existing request consent/session context. Observer failure cannot turn a successful business action into a failed response. These count acknowledged actions, including repeated no-op commands; they are not an exactly-once membership-transition ledger. An optional request observation ID supports analytics deduplication when supplied.
- Consent-off requests cannot collect Find measurement. Withdrawal, expiration/deidentification, and account erasure clear private Find identifiers through the existing analytics lifecycle. Withdrawal and operational reconciliation share the existing consent lock and were raced in tests.
- Operational processing and Stash facts continue using the existing consumer. Disabled rollout gates acknowledge observed facts without later replay/backfill. Backend collection depends on account consent; client-only observations additionally depend on device analytics consent/readiness.
- SQL and TypeScript validators reject raw evidence, extra identifiers, malformed classifications, non-string enums, cross-owner Find IDs, and client-forged authoritative events. Find data is never credited to a creator or used as an aggregate dimension.

## Migration and rollout requirements

New additive migration: `supabase/migrations/20261103160000_find_notifications_measurement.sql`.
It adds receipt fields/indexes to existing imports, wake-up/visibility/privacy triggers, service-only reconciliation helpers, Find event/metric allowlists, and narrow wrappers around existing materialization/send RPCs. Existing notification implementations remain the delegated authority. Existing RLS and service-only RPC boundaries are preserved.

The API/consumer preflight now requires **Find schema version 4**. A separately approved rollout must coordinate this migration with the matching API, ingestion consumer, and notification worker registry. The migration extends known existing analytics function definitions and aborts if their expected contracts have drifted. Existing function configuration is retained. PostgREST schema reload is requested by the migration.

All new rollout flags default off:

- Backend `FIND_NOTIFICATIONS_ENABLED`, in addition to existing notification producer/push gates.
- Backend `FIND_MEASUREMENT_ENABLED`, in addition to `ANALYTICS_ENABLED` and account consent.
- Client `EXPO_PUBLIC_FIND_MEASUREMENT_ENABLED`, in addition to the existing client analytics/device consent gates.

Only `backend/.env.example` was edited; no real environment file or production feature flag was changed. No dependency, Android/iOS permission, application identifier, signing, native module, or native configuration change is required by Phase 6. Client JavaScript changes still need normal approved distribution before device validation.

## Verification

- Client and backend TypeScript passed (`npm run typecheck:client`, backend `npm run typecheck`).
- Repository lint passed with 0 errors and 23 pre-existing warnings. Scoped changed/new backend TypeScript lint passed without warnings.
- Focused notification, analytics, Find, client analytics, and root ingestion-runtime run: **282/282 passed** across 43 files. The nine ingestion-runtime checks are included in that total.
- Full backend non-live suite: **1166/1169 passed**, with the same three baseline assertion failures as the Phase 4/5 checkpoint.
- Full client source suite: **564/576 passed**, with the same twelve baseline failures as Phase 5.
- Disposable PostgreSQL run passed Phase 1–4 SQL/API/codec integrations, 1,920 reference/SQL outcome parity cases, 1,205-record history checks, ownership/RLS checks, automatic saving/removal/restoration races, and the new notification/measurement checks.
- New SQL coverage includes source-attachment/final-saving fences; five products plus two places -> one notification; retries/replay; concurrent consumers; cached importer notification; partial/empty/failed/delayed states; task preferences; quiet hours; hidden before enqueue/materialize/send; enqueue failure rollback/recovery; raw-property/forged-event rejection; owned/cross-owner access; aggregate-only consent; withdrawal/account erasure; concurrent withdrawal; private aggregate dimensions; and service-only grants. This runs in a self-owned Unix-socket-only throwaway PostgreSQL cluster without dotenv, live services, or provider sends.
- Render checks passed: **348 Find + 32 Share + 60 Places/Create/Profile = 440**. Both theme/platform adapters remain covered. Existing React Native Web deprecation messages are not native runtime validation.
- Client Find deep-link rejection and the existing consent/account-scoped analytics queue checks passed. Git whitespace checks passed.

Baseline failures remain unchanged:

1. Backend cache-key assertion expects the older Places pipeline version.
2. Backend content-source static boundary assertion rejects existing catalog/discovered projection references.
3. Backend product reasoner static assertion expects older progressive extraction arguments.
4. Client notification link fixture omits existing campaign-required fields; its new Find link test passes separately.
5. Four client theme-default assertions.
6. Two client signed-out Stash-copy assertions.
7. Five client TS/CommonJS `import.meta.dirname` module-loading failures.

No new failing test remains. No baseline failure was repaired as unrelated Phase 6 work.

## Remaining validation and risks

- A separately approved test rollout must verify actual PostgREST RPC discovery/deadlines, notification-worker materialization, Expo/APNs/FCM delivery/receipts, task push toggles, quiet hours, cold/warm/foreground notification taps, account switching, and hidden/deleted Find navigation on physical Android/iOS devices.
- Exercise a real URL and a private image producing multiple products and places. Verify one logical completion event, automatic Stash saving, replay recovery after worker restart, cached imports, partial/zero results, and persisted removal protection.
- Reconciliation is bounded to 25 imports per existing consumer tick; notification lag includes that loop and existing outbox/provider delay. Large import cohorts and external-provider ambiguous-send recovery need operational observation after approval.
- Validate real account consent withdrawal and admin aggregates across API/consumer restarts. Metrics are opt-in, gate-dependent observations, not a census of all captures. No disabled-window or historical backfill is attempted.
- Phase 4 private-image rollout, Phase 5 physical-device/native validation, existing extraction/provider limitations, and the documented baseline test failures remain outstanding. Phase 7 release hardening has not started.

## Preserved working state

`backend/docs/SHARE_TO_MYSTASH_V2.md` was not edited. Its SHA256 remains `9c1d9ade39a3d63b1bb16a1bc8926dabc9f08fc468a2651c7fdb579ca9eb9a43`.
All Phase 6 changes remain uncommitted and unstaged on the current branch.

## Phase 6 file inventory

The pre-existing Share v2 handoff modification is excluded from this inventory.

- `app/(tabs)/find/[findId].tsx`
- `app/(tabs)/find/capture.tsx`
- `app/product/[productId].tsx`
- `backend/.env.example`
- `backend/docs/UNIVERSAL_FIND_PHASE_6.md`
- `backend/scripts/findDeliverySqlScratch.py`
- `backend/scripts/findFoundationsSqlScratch.py`
- `backend/scripts/sql/find_delivery_checks.sql`
- `backend/scripts/sql/find_delivery_fixture.sql`
- `backend/src/analytics/adminReport.ts`
- `backend/src/analytics/contracts.ts`
- `backend/src/analytics/serverEvents.ts`
- `backend/src/analytics/service.ts`
- `backend/src/notifications/domain/deepLinks.ts`
- `backend/src/notifications/domain/eventTypes.ts`
- `backend/src/notifications/domain/idempotencyKeys.ts`
- `backend/src/notifications/domain/notificationDomain.test.ts`
- `backend/src/notifications/domain/pushContent.ts`
- `backend/src/notifications/domain/types.ts`
- `backend/src/user-import/find/delivery.test.ts`
- `backend/src/user-import/find/routes.test.ts`
- `backend/src/user-import/find/routes.ts`
- `backend/src/user-import/find/schema.test.ts`
- `backend/src/user-import/find/schema.ts`
- `backend/src/user-import/find/terminalDelivery.ts`
- `backend/src/user-import/share/recovery.ts`
- `components/find/FindDetailView.tsx`
- `components/find/MeasuredFindResult.tsx`
- `components/product/ProductPage.tsx`
- `scripts/check-find-ui.cjs`
- `src/analytics/findMeasurement.test.ts`
- `src/analytics/findMeasurement.ts`
- `src/analytics/hooks.ts`
- `src/hooks/useFindCapture.ts`
- `src/hooks/useFindHistory.ts`
- `src/hooks/useFindImageCapture.ts`
- `src/notifications/linking.test.ts`
- `src/notifications/linking.ts`
- `src/services/findApi.ts`
- `src/services/findClient.ts`
- `src/services/shoppingClick.ts`
- `src/ui/adminAnalytics.ts`
- `src/ui/findDetail.ts`
- `supabase/migrations/20261103160000_find_notifications_measurement.sql`
