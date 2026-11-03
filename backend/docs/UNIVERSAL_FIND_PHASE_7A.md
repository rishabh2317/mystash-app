# Universal Find Phase 7A — Integrated Hardening and Release Readiness Assessment

Assessment date: 2026-11-03. Branch: `codex/share-v2-pilot`.
Starting checkpoint: `bf3d47e31b75267f268a41fd352ad746dbf3dd87`.

## Decision

**Suitable for continued local development; not ready for a production release.**

Local contracts for capture, private upload, automatic Stash saving, history, removal/restoration,
notification handoff, and consent withdrawal passed integrated verification. This is not physical-device,
actual queue-worker, live authentication/Storage, provider-quality, deployment, or release-build acceptance.
Existing regression failures and the measurement coverage gap below remain unresolved release gates.

Phase 7A covers a focused recovery fix, connected offline integration tests, and this readiness assessment.
It does not change product UX, historical migration policy, notification campaigns, provider thresholds,
application identifiers, signing, permissions, dependencies, existing migrations, or rollout flags.

## Hardening performed

### Accepted-history failures could stall pending image uploads — fixed

`createCaptureDelivery` previously reconciled an already accepted record outside its per-record error
boundary. A failed history request aborted the entire drain, so an old accepted receipt could repeatedly
prevent later pending captures from uploading, even when upload endpoints were healthy.

The accepted-record path now catches reconciliation failures per record, retaining its acceptance metadata
and proceeding to later records. Pixels remain purged only after server acceptance. Ownership/epoch fencing,
serialized pumping, retry state, and existing encrypted native persistence remain unchanged.

A new regression test placed an accepted record before a pending one and made every history request fail.
Before the fix it failed with zero uploads instead of one. After the fix, the pending capture uploads and is
accepted, both receipt records remain retryable for history reconciliation, and no pixels remain. All 13
capture-delivery/security/permission tests pass. This was a pre-existing Phase 5 defect discovered in 7A.

## New connected integration evidence

Reproduce with:

```sh
python3 -B backend/scripts/findReadinessSqlScratch.py
```

The existing disposable PostgreSQL harness now optionally invokes
`scripts/findReadinessIntegration.cjs` after applying the combined Phase 1/2/4/6 schema and running earlier
query, media, security, ownership, and concurrency checks. No production database, dotenv, push provider,
paid extraction, or external service is accessed. PostgreSQL tools and FFmpeg are existing local dependencies.

Five additional connected scenarios pass:

1. Reel URL: real URL normalization/acceptance service and SQL receipt replay -> persisted source/result
   facts -> automatic Stash repair -> owned Find detail -> notification materialization and measurement.
2. YouTube URL with mixed branch results: partial outcome is retained, automatic saving succeeds,
   and the capture receives one completion summary.
3. Supported web URL with zero results: successful empty completion is distinct from extraction failure.
4. Gallery image producing five products/two places: mobile delivery/transport -> actual image API/service,
   codec and SQL acceptance -> automatic memberships -> one completion, rather than seven item notices.
5. Camera image: the same connected path with independent image bytes and camera origin.

For URL captures, the actual Share acceptance service and store RPC execute; native URL delivery and its
HTTP authentication/admission wiring are covered separately by existing tests, not this connected fixture.
For images, the actual client delivery/transport, API handlers, verifier/normalization codec, receipt commands,
Find query service, membership counts, synchronization coordinator, result actions, and notification registry
and materialization RPC execute. The integration also exercises offline retry, controller restart, account
switch protection, a lost finalization reply, single upload after replay, and byte purge after acceptance.

Persisted extraction facts, authentication, object storage, and native persistence are injected fixtures.
The test does **not** instantiate BullMQ workers or invoke real camera/gallery APIs, hardware encryption,
Supabase Auth/Storage, APNs/FCM, or paid providers. Existing worker/image-pipeline tests independently exercise
the real processor/adapter with recorded/in-memory provider and repository fixtures. These boundaries must
not be described as a full live capture-to-Stash test.

The connected cases additionally verify:

- A failed product-membership write produces failed synchronization; recovery completes without replacing
  source results or requesting new extraction.
- Product/place removal survives automatic fan-out replay; explicit restoration works and extracted counts
  remain separate from saved counts.
- Cross-account Find/media access is rejected. Disabling new image ingestion preserves existing private
  media reads, while new allocation is rejected. Existing cleanup/delete gate tests remain in the earlier suite.
- Global history counts include unloaded records; keyset pages do not overlap.
- Each of the five Finds materializes exactly one completion notification and one accepted/completed
  operational event. Worker facts have no fabricated client session; withdrawal removes actor linkage.

## Verification results

- Client TypeScript: passed (`npm run typecheck:client`).
- Backend TypeScript: passed (`npm run typecheck`).
- Repository lint: **0 errors, 23 existing warnings**. Changed delivery code/test and new integration script
  lint pass without warnings. Node/Python syntax and Git whitespace checks pass.
- Client source suite: **565/577 passed, 12 pre-existing failures**. This adds one passing starvation regression
  to the Phase 6 checkpoint's 564/576 baseline.
- Backend non-live source suite: **1166/1169 passed, 3 pre-existing failures**.
- Ingestion-runtime tests, run from repository root: **9/9 passed**. These are separate from the backend
  suite above: combined backend/runtime total **1175/1178**, with the same three baseline failures.
- Native configuration/plugin/endpoint and original capture integration checks: **14 passed, 1 skipped**.
  The existing skip requires an Xcode project fixture; no native project was generated.
- Render/interaction adapters: **348 Find + 32 Share + 60 Places/Create/Profile = 440 passed**.
  These cover both theme/platform adapters, narrow widths, large type, loading/empty/error/permission states,
  and account filtering. They do not establish physical accessibility, gesture, image-loading, or layout acceptance.
- Offline native source compatibility passed: actual Android ShareStore compiles against cached SDK/Kotlin
  classes with only the unchanged URL validator stubbed; Swift module/test sources parse; actual ShareCore
  typechecks against the installed iOS simulator SDK. No app linking, native runtime/instrumentation, APK/IPA,
  prebuild, provisioning, or release build was performed.
- Disposable database suite passed: 1,920 SQL/reference outcome cases; 1,205-record pagination fixtures;
  query/API/media/codec integrations; RLS and service-role grants; stale-worker/removal/restoration races;
  terminal notification privacy/deduplication; quiet hours/preferences; consent withdrawal/account erasure;
  concurrent recovery; plus the five new connected contracts above.

No newly introduced failing test remains. No live OpenSearch/Supabase integration suite was run.

## Existing failures: classification and disposition

The following predate 7A and are not evidence of a newly introduced runtime regression:

- `backend/src/config/pipeline.test.ts`: a static assertion expects `places-v2`; the implementation uses
  the already-committed `places-v3` extraction scope.
- `backend/src/content-source/ContentSourceService.test.ts`: a broad source-code ban rejects existing
  read-only catalog/discovered projection references. Repair should retain meaningful checks against writes,
  provider invocation, and cross-domain orchestration rather than simply remove the boundary test.
- `backend/src/prompts/productReasoner.test.ts`: a regex expects an older progressive-call argument list.
- `src/notifications/linking.test.ts`: the shared fixture omits the existing promo campaign fields.
  The Find allowlist/rejection test passes; campaign production code was not changed.
- Four assertions in `src/theme/tokens.test.ts` expect older theme defaults.
- Two assertions in `src/ui/chrome.test.ts` / `src/ui/contracts.test.ts` expect older signed-out Stash copy.
- Five client test modules fail under the current TS/CommonJS harness because `import.meta.dirname`
  is undefined: reelLikeEngagement, collectionProductCard, collectionTileNavigation, feedShop, and
  searchReelNavigation. Their intended tests therefore have not all executed; they are a coverage gap.

These unrelated baseline assertions/harness files were preserved. They should be reconciled against approved
current behavior before declaring the complete regression suite green. Existing warnings were not mass-fixed.

## Measurement coverage gap against the approved architecture

The architecture's measurement section additionally calls for acceptance-to-results/Stash latency and
newly saved / already saved / intentionally removed / failed-to-save breakdowns. Current Find event contracts
and admin reporting do **not** expose those complete measurements:

- Terminal events have bounded extracted-result count buckets, outcome, origin and failure class.
- There is no Find acceptance-to-results or acceptance-to-Stash latency bucket in the event allowlist/report.
- The Stash event uses the extracted-result bucket, not a full saved-membership disposition breakdown.
- Result remove/restore metrics count acknowledged commands, including no-op repeats, not exactly-once
  membership transitions. The admin report totals completions/failures without a full/partial/zero rate split.
- Device native external URL secure-queue acknowledgements are not all represented by the in-app capture
  submission event. They must not be counted as a measured total of local capture success.

Server timestamps exist, but activity-off events deliberately discard private Find identity, so the missing
latency measurement cannot be safely assumed recoverable by later joining account-linked events. A follow-up
must compute bounded summaries at the authoritative server boundary and extend SQL/TS validators, consent/
withdrawal handling and aggregate reporting together. Any required schema change needs a new additive
migration and separately approved application. No migration or measurement contract was modified in 7A.

Until that follow-up or an explicit scope decision, measurement release acceptance is **incomplete**.

## Remaining release gates

### Matching environment and real queue pipeline — not verified

A separately approved validation rollout must apply the prepared migrations/storage setup and run matching
schema-version-4 API, ingestion consumer and notification worker code. Confirm PostgREST schema reload and
RPC deadlines, service-role grants, actual private signed PUT/read/delete behavior, immutable conflict recovery,
provider credentials, FFmpeg/FFprobe on both API and worker, and consumer-driven orphan/account cleanup.
The checked-in Dockerfile installs FFmpeg; deployed runtime parity was not inspected.

Run actual queue-driven URL/image extraction -> Stash -> notification/measurement with recorded or approved
providers. Prove recovery across worker/process restarts and real Redis interruption. The existing ingestion
consumer owns dispatch, Stash repair, cleanup and notification handoff; liveness alone is not readiness.
Sleeping services and volatile Redis remain documented reliability limits. YouTube downloader restrictions
and representative provider identity/venue accuracy remain independent unresolved gates.

### Physical Android/iOS and pending-record upgrades — not verified

Use later-approved native test installations to verify camera/gallery permissions/cancellation, Android Activity
recreation, image orientation/HEIC/metadata, memory pressure, offline/process death/reboot/Doze, foreground resume,
account switches, encrypted persistence/backup exclusion, upgrade with existing assigned/unassigned `.share`
records and pending `.image` records, iOS App Group/Keychain/provisioning/background limitations, and notification
cold/warm/foreground taps. Validate VoiceOver/TalkBack, safe areas, Dynamic Type, gestures and keyboard behavior.

Older Android/iOS binary API compatibility and historical data reconstruction are not required by the user's
updated release priorities. Preservation of existing pending URL records, ownership, removal/restoration and
non-destructive rollout remain mandatory. The current APK versionCode 4 does not contain Phase 5 native capture
bridge methods; an OTA update cannot supply them. This assessment did not change build numbers or start builds.

### Capacity, latency and final UX — not measured

Measure capture acknowledgement, time-to-results/Stash, scrolling, memory/decoder concurrency, upload bandwidth,
private Storage quotas/cleanup backlog, large-history query plans/count latency, and outbox lag on representative
hardware and intended infrastructure. The 25-import bounded reconciliation loop and provider notification retry
policy must be observed under expected load. Local fixture timings are not production latency evidence.
One logical completion does not guarantee exactly-once delivery by an external provider or one delivery across
multiple registered installations; existing ambiguous-send retry policy remains unchanged.

Subsequent approved UI refinements, full native/device acceptance, and final Android/iOS release builds remain
later work. No feature is activated by this assessment. Keep rollback compatible with retained removal markers,
private media ownership/deletion and accepted pending captures; disabling intake must not disable cleanup.

## Working state and scope

Phase 7A changes:

- `src/services/captureDelivery.ts`
- `src/services/captureDelivery.test.ts`
- `backend/scripts/findFoundationsSqlScratch.py`
- `backend/scripts/findReadinessSqlScratch.py`
- `scripts/findReadinessIntegration.cjs`
- `backend/docs/UNIVERSAL_FIND_PHASE_7A.md`

The Share v2 handoff file remains byte-for-byte preserved with SHA256
`9c1d9ade39a3d63b1bb16a1bc8926dabc9f08fc468a2651c7fdb579ca9eb9a43`.
No new dependency or migration is introduced. Nothing was staged/committed, pushed, merged, deployed,
applied to a live database, enabled in production, or built as an application/release artifact.
