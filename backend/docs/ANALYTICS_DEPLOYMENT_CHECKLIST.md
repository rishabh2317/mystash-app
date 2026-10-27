# Mystash Analytics — Consolidated deployment checklist, Phases 1–5

**Status: controlled rollout authorized by the user on 2026-10-28; preparation and staged verification are in progress. Optional collection/personalization/admin access remain disabled pending pilot acceptance.** All optional analytics/reporting/personalization flags remain absent/false locally. Admin membership is unassigned in the real project. No build, account provisioning, migration push, service deployment or paid service has been started.

This is one coordinated release plan with ordered migration/backend/worker/client steps. All unchecked steps require future operator execution after explicit approval. Do not treat local fixture success or this document as permission to change production. Preserve both application identifiers, the existing Android share target and all existing business functionality.

Current execution record: [controlled rollout status and recovery protocol](./ANALYTICS_ROLLOUT_STATUS.md). Earlier phase/audit authorization statements below describe their historical scope; the current user instruction authorizes the controlled rollout subject to its gates.

## R1–R7 resolution — 2026-10-27

All seven findings have local fixes and permanent regressions. [Fix details, verification, preserving counter cutover and optional reset assessment](./ANALYTICS_READINESS_FIXES.md) are the current readiness record. The original reproductions below remain as audit history.

- [x] R1: flag-independent consent recovery/disable controls, actual private settings, stale-enable revision guard and bounded requests.
- [x] R2: every merchant store enforces current optional identity consent regardless of headers; withdrawal races covered.
- [x] R3: idempotent `deleted_at` and status erasure across all phases; restoration requires fresh consent.
- [x] R4: independently scheduled maintenance, abortable RPC deadlines and scoped SQL deadlines implemented. Live PostgREST timeout enforcement/worker evidence is still required.
- [x] R5: preserving projection initialization, explicit legacy baselines, stock/drift guards, inventory and opt-in cutover preparation implemented. No reset/purge executed. Live all-counter parity and drained writers are still required.
- [x] R6: clean separate client/backend no-emit checks; minimal existing type issues fixed and locked file-system dependency declared directly.
- [x] R7: valid offline scope/revision queues held without collection; withdrawals, mismatches, invalid policies/receipts and TTL still purge.

**Deployment blockers remaining:** reviewed release checkpoint; full-schema/actual-role rehearsal and migration history; backed-up, drained, approved counter cutover; live API deadline enforcement; worker/retention/alert/capacity proof; privacy/logging/flag and Android/iOS/old-client validation. Do not treat the local checkmarks as production acceptance.

## Original readiness audit — 2026-10-27 (historical reproductions)

**Decision: HOLD the coordinated deployment and keep optional collection disabled.** The earlier local completion reports describe implemented scope and selected passing tests. They do not establish deployment readiness. The additional audit below reproduced gaps that those tests do not cover. That original review made no implementation fix, production query, deployment, environment change, install or build; it only updated this checklist. The subsequent local resolution above supersedes its code-blocker status. Reproduction harnesses used synthetic data in a disposable PostgreSQL cluster or mocked execution of the current TypeScript source, and live production drift/permissions/capacity have not been asserted.

The checkout is `codex/cross-platform-development` at base HEAD `e787627f20eadf837e4f379c73624a6eb6eec5cd`. Analytics implementation/migrations are still local modified/untracked files, alongside the preserved prior Creator Studio changes. A reviewed release commit is still required.

### Original findings and minimum fixes (resolved locally as recorded above)

- [x] **R1 — P1: Complete general measurement consent recovery and stale-enable protection (Phases 2/5).** General measurement withdrawal replay is inside the `EXPO_PUBLIC_ANALYTICS_ENABLED` gate; the host skips that initializer entirely with the public flag off. The unflagged recovery effect covers personalization only. Source execution with a saved full-withdrawal marker and the client flag false produced **0 network attempts and a still-pending marker**. With the server flag off, `{measurement_enabled:true, activity_enabled:false}` is also rejected even when it represents only reducing an existing permission; controls become unavailable and hide under the public flag. Separately, the general preferences RPC has no expected-revision precondition: an older enable request arriving after withdrawal sets account activity true again. The purpose-specific Phase 5 RPC already guards its own epoch; that protection does not cover general measurement.

  Minimum fix: provide account-scoped, flag-independent general withdrawal recovery and disable controls for previously consenting devices; permit genuinely decreasing permissions during shutdown; require a fresh expected revision for any permission increase. Return actual authenticated privacy settings during shutdown with private/no-store headers, while still blocking new collection/opt-in. Add bounded request timeouts. Test both flags off, activity-only withdrawal, reconnect/account switch, and delayed enable versus withdrawal without creating new measurement identifiers. Sources: [host](../../src/analytics/AnalyticsHost.tsx#L9), [client initialization](../../src/analytics/client.ts#L50), [controls](../../src/analytics/PrivacyControls.tsx#L12), [preferences HTTP route](../src/analytics/routes.ts#L22), [preferences RPC](../../supabase/migrations/20261027130000_behavioral_measurement.sql#L52).

- [x] **R2 — P1: Enforce optional merchant identity consent on every server path (Phases 1/2).** The redirect handler uses a raw header's presence to choose its consent-aware legacy writer. With a verified bearer but no measurement header it writes `clickRow.user_id` directly. The engagement wrapper strips merchant identity only when `measurement_context=true`. A synthetic account with measurement/activity both false retained **one new actor-linked merchant fact** when context was false. The current app normally omits the bearer in this case; server enforcement must also hold for other/older callers. Anonymous business click counts/navigation can remain functional.

  Minimum fix: always evaluate live consent/revision before retaining merchant actor/session linkage in either legacy or engagement records, including absent/malformed headers and global shutdown. Preserve event dedupe, destination resolution and unlinked counters. Add bearer-without-context, opt-out, stale receipt and withdrawal-race tests. Sources: [legacy writer branch](../src/shopping/productRedirect.ts#L95), [engagement consent wrapper](../../supabase/migrations/20261027130000_behavioral_measurement.sql#L230).

- [x] **R3 — P1: Make `deleted_at`-only erasure complete (Phases 1/2/5).** The Phase 1 engagement and Phase 2 optional-event erasure triggers watch only `account_status` and require its transition to DELETED. The later admin/interest triggers do handle `deleted_at`, but do not erase the earlier layers. Setting only `deleted_at` left **one linked optional event and one linked business fact** in the audit fixture. The current normal account-deletion service sets both fields, so this is an alternate-path/restore/privacy-contract gap, not evidence that the normal route failed.

  Minimum fix: share an idempotent deletion predicate/erasure path across both deletion fields, cover historical actor linkage, preferences/search correlation and relationship-stock reconciliation, and ensure restoring the row does not restore consent/history. Add isolated `deleted_at` and repeated-erasure regressions as well as the existing DELETED/hard-delete cases. Sources: [Phase 1 trigger](../../supabase/migrations/20261027120000_engagement_atomic_foundations.sql#L207), [Phase 2 trigger](../../supabase/migrations/20261027130000_behavioral_measurement.sql#L177), [later interest erasure](../../supabase/migrations/20261027160000_interest_profiles.sql#L47).

- [x] **R4 — P1: Prevent aggregation from starving privacy maintenance (Phases 2–5).** Maintenance runs only after awaited creator/admin/profile work, inside the same `busy` loop. A never-settling creator RPC in the source-level test resulted in **only the creator call; maintenance never started**. Catching rejected promises is insufficient for a hung request, and the busy guard then skips every later tick.

  Minimum fix: give maintenance an independently scheduled/recoverable path, plus actual cancellable RPC deadlines and database statement/lock timeouts for all background work. Do not use a timeout race that merely abandons still-running SQL. Test a never-resolving RPC, a held database lock and partial profile failures; verify retention still executes without overlapping unbounded cleanup. Source: [worker ordering/busy guard](../src/analytics/worker.ts#L20).

- [x] **R5 — P1 conditional cutover hold: Prove or bootstrap existing counters before new writes (Phase 1).** On a valid fixture row with mirror `views_count=42` and no projection, one view resulted in **1 instead of 43**. The increment helper inserts the delta as its initial projection value, and the commit then replaces the mirror with that value. Existing nonzero/drifted projections can likewise override inconsistent mirrors. This does **not** prove the deployed database currently has such drift; it proves the release requires a complete parity/coverage check and an approved baseline rule. The new production factory is unconditional, so optional flags off do not protect these operational writes. Reconciliation currently reports drift without repairing/rejecting it.

  Minimum fix: explicitly pause/drain old writers, inventory projection coverage/parity for all affected collection/user counters, and resolve any missing/drifted baseline through an approved preservation/seed procedure before the first new write. Add a guard/initialization path if parity cannot be guaranteed. Do not replace historical totals with zero or reconstruct undocumented historical truth automatically. If live parity is proven, this condition can close without a data rewrite. Restore explicit pause/drain/no-mixed-writer instructions to the consolidated cutover runbook; they currently appear only in the Phase 1 notes. Sources: [counter initializer](../../supabase/migrations/20261027120000_engagement_atomic_foundations.sql#L17), [mirror replacement](../../supabase/migrations/20261027120000_engagement_atomic_foundations.sql#L149), [unconditional factory](../src/engagement/factory.ts#L38), [Phase 1 rollout](./ANALYTICS_PHASE_1.md#reconciliation-and-rollout).

- [x] **R6 — P1 release gate: Obtain clean project-scoped compiler checks.** The earlier root count of 270 unchanged diagnostics mixes client/backend configuration and missing worktree dependency resolution; unchanged is not clean. A no-emit check using the backend's production compiler options and the already-installed matching-lockfile backend dependencies confirms **three pre-existing errors, zero new analytics errors**. Both installed compilers are TypeScript 5.9.3. They are `loadHarness.ts:232` (`'default'` is outside `'high'|'normal'`) and `outboxMaterializer.ts:159–160` (writable number variables were inferred as literals 1000/100). Two initially apparent provider import errors disappeared when dependency subpaths were correctly resolved; those are not code findings.

  Minimum backend fix: use the domain-supported fixture priority (`normal`) and annotate the materializer's mutable numeric locals as `number`. Run the real locked dependency/production-config `tsc --noEmit` gate in CI, without emitting build artifacts during this audit. Sources: [load harness](../src/notifications/jobs/loadHarness.ts#L232), [materializer locals](../src/notifications/jobs/outboxMaterializer.ts#L151).

  A client-root-scoped check also reports **four pre-existing diagnostics**: `profilePhotoUpload.ts:1` cannot resolve a direct `expo-file-system` import; `tokens.ts:407,450` compares a narrowed outline-only constant with raised; `productPage.ts:266` passes an optional collection ID where the type requires nullable-but-present. `expo-file-system` exists only nested under Expo in the lock/install (19.0.24), and is not a declared root dependency.

  Minimum client fix: declare the SDK-compatible direct file-system dependency through the approved lockfile workflow, make the two intentional card-variant comparisons type-correct without changing the selected design, and normalize the optional collection ID to `null` at the existing helper boundary. Then run clean client and backend checks separately. No package was installed and none of these unrelated source fixes was applied by the audit. Sources: [photo upload](../../src/services/profilePhotoUpload.ts#L1), [theme](../../src/theme/tokens.ts#L407), [media helper](../../src/ui/productPage.ts#L266).

### Additional reliability follow-up

- [x] **R7 — P2: Preserve a valid offline queue while consent verification is unavailable.** A failed foreground/startup preference fetch leaves `preferences=OFF`, then calls `configure(...,false)`, which deletes persisted events. This can lose previously queued consented observations rather than retry within their 24-hour TTL. Treat unavailable verification as pause/no-send, preserving only the same account/revision's bounded queue; continue purging on explicit withdrawal, identity switch, invalid receipt or TTL. Cover this when fixing R1's lifecycle. Sources: [initialization](../../src/analytics/client.ts#L72), [queue configure/save](../../src/analytics/queue.ts#L26).

### Remaining evidence and operational gates

- [ ] Create a reviewed release checkpoint containing the intended analytics files, excluding credentials/temporary files and preserving the separate Creator Studio edits.
- [ ] Complete a full-schema rehearsal against representative isolated data and actual service/anon/authenticated roles. Minimal fixture success does not establish deployed migration compatibility, role defaults, trigger interactions or index-lock duration.
- [ ] Verify the target migration history, backup/restore point, write-drain/counter baseline, private credential presence, approved admin identity, gateway log redaction and rollback owner. These live prerequisites were not queried or changed by this audit.
- [ ] Verify a running independent maintenance/reconciliation worker with failure alerts, RPC/SQL deadlines, matched API/worker collection flags and measured 1k-DAU storage/query/WAL headroom. 10k/100k figures remain planning estimates, not measured capacity or free-tier guarantees.
- [ ] Perform new Android/iOS UI and old-client compatibility checks for consent/settings, dashboards, Creator Studio, share target, saved items and merchant navigation. The previously successful iOS build predates this implementation; Node/SQL tests do not validate the new native UI.
- [x] Re-run existing and permanent R1–R7 regressions after fixes: 378 selected tests pass, both disposable SQL suites pass, and separate project-scoped compilers are clean. Historical audit reproductions were coverage gaps now covered.

### Phase assessment and minimum sequence

Phase 1 is held on counter cutover/compile/erasure evidence; Phase 2 on general consent and merchant identity enforcement; Phases 3–4 have locally tested report math/authorization but still require maintenance guarantees, role/schema rehearsal and device QA; Phase 5's separate purpose epoch/reset/stale-commit guards pass locally but depend on the earlier activity/privacy layer being corrected. No current recommendation consumer is connected. Unsupported monthly/returning-user/conversion metrics remain intentionally unavailable; adding playback or extra infrastructure is not a readiness requirement.

Minimum sequence: fix R6's small existing compile/dependency issues; implement/test R1–R4 (include R7 while changing the lifecycle); close R5 with approved counter parity/baseline and write-drain evidence; checkpoint the reviewed release; complete schema/role rehearsal and Android/iOS/operational gates. Keep optional flags off throughout preparation. This audit does not authorize any repair against production or a build/deployment.

---

## 1. Review and preflight gates

- [x] Complete local implementations and per-phase reports: [Phase 1](./ANALYTICS_PHASE_1.md), [Phase 2](./ANALYTICS_PHASE_2.md), [Phase 3](./ANALYTICS_PHASE_3.md), [Phase 4](./ANALYTICS_PHASE_4.md), [Phase 5](./ANALYTICS_PHASE_5.md).
- [x] Keep all playback analytics excluded. Embedded YouTube/Instagram players and Product Page embed match original Git source.
- [x] Run selected regressions (378 passing), both disposable SQL suites including readiness/timeout/counter checks, clean client/backend no-emit checks and lint with no new findings. Three existing UI files use documented temporary test-loader copies.
- [ ] Review/checkpoint the entire analytics change set, preserving existing work. Separate analytics changes from the already present Creator Studio UI edits for release review. Exclude environment files, tokens, credentials, temporary tests/logs and native/cloud artifacts. No commit/push is implied by this checklist.
- [x] Resolve R6 project-scoped compilation blockers: client and backend production-option checks both have zero diagnostics. Use `npm run typecheck:client` and `npm --prefix backend run typecheck` in independently installed CI; the mixed root project is not the release gate.
- [ ] Obtain existing CI disposition or separately address ten pre-existing lint findings in the broadened touched-file scope; no new lint findings were introduced.
- [ ] Verify the target Git revision, repository, Supabase project, migration history, backend/worker host and Expo/EAS project. Reuse existing application IDs/project linkage; do not invent or replace them.
- [ ] Inventory pending migrations and schema drift. The local runner uses minimal deterministic business fixtures; it is not a full-schema production replay. Run an approved full-schema dry run against a representative isolated test environment before production approval. Do not blindly push unrelated pending migrations.
- [ ] Obtain an approved backup/restore point using existing available tooling and verify a restore procedure. Do not enable a paid backup plan/service automatically.
- [ ] Review source cardinality/index plans and expected migration locks/duration. New indexes touch existing facts, users, collections, imports/ingests and source tables; schedule an appropriate maintenance/change window if needed.
- [ ] Confirm the budget/capacity envelope. Initial target is 1k DAU; 10k/100k estimates and required benchmarks are in phase notes. No free-tier capacity guarantee is made. Stop for approval if any plan upgrade/payment would be required.

## 2. Ordered migrations

Apply only after schema review and deployment approval, before the new backend/worker needs its RPCs:

- [ ] Pause engagement mutations and drain old/new API instances, retry queues, background/direct legacy counter writers and in-flight transactions. Optional analytics flags do not pause these writes. Record the cutover boundary; never run mixed writers.

- [ ] `20261027120000_engagement_atomic_foundations.sql` — atomic commits/counters, erasure/reconciliation, exact creator summary and server-only grants.
- [ ] `20261027130000_behavioral_measurement.sql` — consent/preferences, bounded ingestion/search correlation, raw/identity retention, optional shopping attribution.
- [ ] `20261027140000_creator_analytics.sql` — private creator rollups, coverage, retention and report RPC.
- [ ] `20261027150000_admin_analytics.sql` — private global rollups, explicit admin membership, access auditing, business cohorts and admin report RPC.
- [ ] `20261027160000_interest_profiles.sql` — separate purpose epoch/policy, bounded interest snapshots, reset/withdrawal erasure, leased worker methods and expiry. Earlier unused personalization bits are explicitly reset false.
- [ ] `20261027170000_analytics_readiness.sql` — scoped background/privacy RPC deadlines, private all-counter inventory, read-only preflight and explicit preserving counter preparation.
- [ ] With writers still drained, inspect `engagement_counter_preflight()`/inventory; stop on any blocking drift. Run the approved preserving preparation transaction only after inspection, then require zero missing projections/baselines and blocking drift, reconcile, and record before/after totals and unchanged authoritative relationship counts. No reset/purge is authorized. See the [R5 runbook](./ANALYTICS_READINESS_FIXES.md#r5-preferred-preserving-cutover).
- [ ] Verify all required functions, constraints, triggers and indexes exist, including renamed compatibility functions and the final maintenance wrapper chain. Each migration must succeed as reviewed; do not continue through a partial failure.
- [ ] Verify RLS/grants as actual roles: PUBLIC/anon/authenticated cannot write/read private analytics tables, self-enroll as admin, or call service-only RPCs. The backend service role can perform intended operations. Do not regrant direct client fact/counter writes as a workaround.
- [ ] Confirm admin membership starts empty and no real user has been silently opted in to any optional purpose. Business saves/follows/counters are preserved.

## 3. Backend release and privacy bridge

- [ ] Deploy the approved compatible backend with all optional flags initially false; no cloud/native app build is implied. Review private environment **names/presence only**; never log values. Existing server Supabase credentials remain server-only; public client configuration contains only approved public values.
- [ ] Reopen engagement entry points only after counter parity/preparation and compatible atomic writers are verified; old non-atomic writers are not a safe implicit rollback target.
- [ ] Verify Phase 1 correctness endpoints and exact creator summary against known records. These foundations are not gated by optional analytics flags; migration/backend order matters.
- [ ] Verify `/analytics/config` reports collection disabled and batches/profile reads fail closed while disabled. No guest/device identifier should be created/sent before measurement opt-in.
- [ ] Verify verified-session authentication and generic/no-store error behavior on private routes. Extra user/creator IDs, raw export selectors and unbounded ranges must be rejected.
- [ ] Verify privacy bridge endpoints remain available to authorized self during shutdown: full/partial measurement withdrawal, actual self-only preference reads, personalization settings/withdrawal and interest reset. Test delayed enables and decrease-only replay after a full withdrawal. An ordinary creator/admin may not read another user's activity or profile.
- [ ] Configure HTTP/edge access logging to redact Authorization, measurement headers, query text, source/merchant URLs and payloads. Application diagnostic counts alone are not complete delivery monitoring.
- [ ] Prove target PostgREST hoists the scoped function statement timeouts into the transaction before RPC execution (v12+ behavior); verify real lock/statement cancellation and bounded retries in the isolated target rehearsal. HTTP abort/races alone are insufficient; stop if this proof fails.
- [ ] Enforce appropriate request/statement timeouts. Transactions must not remain open beyond the seven-day source/catch-up horizon. Set trusted request/rate limits without weakening consent or blocking privacy withdrawal.

## 4. Worker and maintenance release

- [ ] Deploy the compatible existing worker after migrations. No new broker, vector store or external analytics service is required.
- [ ] Enable `ANALYTICS_MAINTENANCE_ENABLED` only as part of the approved rollout so privacy TTL/invalid-profile cleanup runs even if collection and optional computation are off. Alert on maintenance failures; do not turn retention off during rollback.
- [ ] Verify the existing Phase 1 reconciliation job records exact mismatch diagnostics and expires its 30-day records. It starts with the worker and needs the Phase 1 schema.
- [ ] Stage `ANALYTICS_ROLLUPS_ENABLED` and `ANALYTICS_ADMIN_ROLLUPS_ENABLED` under approved load observation. First run can backfill retained operational facts; raw optional data exists only where legitimately collected. Do not backfill fabricated playback or pre-instrumentation observations.
- [ ] Check advisory locks, idempotency, watermarks, normal overlap/daily catch-up, outage-safe dedupe expiry and five-minute availability windows. Match worker `ANALYTICS_ENABLED` to the API's collection flag; coverage is sampling, not proof of complete delivery.
- [ ] For purpose-specific profiling, stage `ANALYTICS_INTEREST_WORKER_ENABLED` only with `ANALYTICS_PERSONALIZATION_ENABLED` and `ANALYTICS_ENABLED` as separately approved. No consent means no claimed profile. Verify 100-account batch limit, four-account concurrency, two-minute leases and hourly freshness target against measured throughput.
- [ ] Confirm independently scheduled privacy maintenance still runs during hung/failed rollup/profile work. Monitor aggregation lag to finish before raw source expiry when possible; cleanup never waits for computation. Exceeding the seven-day source window creates unrecoverable coverage gaps, not estimated data.

## 5. Feature flags and clients

No flag below was changed by local implementation. Public flags are visibility/build-time gates, never authorization or consent.

- [ ] Baseline collection: `ANALYTICS_ENABLED` (backend AND worker configuration) and `EXPO_PUBLIC_ANALYTICS_ENABLED` (shared client). New devices still require explicit matching device consent receipts; guests require local opt-in. Account-linked activity is a separate choice.
- [ ] Creator reporting: `ANALYTICS_CREATOR_REPORTING_ENABLED` and `EXPO_PUBLIC_CREATOR_ANALYTICS_ENABLED`. Worker creator rollups are independent. With client flag false, the preserved prior creator screen remains active.
- [ ] Admin reporting: `ANALYTICS_ADMIN_REPORTING_ENABLED` and `EXPO_PUBLIC_ADMIN_ANALYTICS_ENABLED`; private route `/admin-analytics`, no public navigation entry. Separately approve a real verified internal account ID and provision its membership using trusted database administration. Expo ownership or creator status is not admin authorization.
- [ ] Personalization readiness: `ANALYTICS_PERSONALIZATION_ENABLED`, `ANALYTICS_INTEREST_WORKER_ENABLED`, `EXPO_PUBLIC_PERSONALIZATION_ENABLED`. The purpose remains off for every account until explicit fresh opt-in. Do not infer it from activity/measurement consent.
- [ ] Review the client release mechanism and Android/iOS compatibility. Use existing approved Expo/EAS setup; any build or update needs separate approval and must stop if payment is required. No local Simulator runtimes, CocoaPods or native tooling is required by this implementation.
- [ ] Test both Android and iOS with existing headers/navigation, Creator Studio/drafts/publishing/extraction, authentication, Stash/places, search, merchant navigation and the Android share target. Verify old deployed client compatibility with the new backend/grants. Do not ship solely on the current Node/SQL tests.
- [ ] Verify large fonts, loading/error/empty/access/partial/stale states, chart text alternatives, selected UTC ranges, safe account switches, retry and no hidden/private content in either dashboard. Native/device UI validation remains outstanding locally.
- [ ] No feed/search ranking, recommendation provider or AI model consumes interest profiles. Connecting a future consumer requires another review for live consent, candidate authorization/hides, insufficient-data fallback, sensitive attributes, provider data egress/deletion and cost.

## 6. Privacy validation before broad opt-in

Use approved test accounts/data; never paste credentials or raw personal events into reports/logs.

- [ ] Verify the five separate data layers: unlinked aggregate analytics; authenticated transactional records; optional account activity and separately opted-in profiles; creator-scoped metrics; admin-only aggregate/business reporting.
- [ ] Confirm default off for guests/accounts/new devices and no automatic personalization. Verify mismatched/stale revisions and unknown policy versions fail closed.
- [ ] Verify general measurement/activity withdrawal removes optional identity/session linkage and purpose profiles without deleting functional saves/follows. Verify both soft (`account_status` and `deleted_at`) and hard account deletion behavior. Restoring a suspended/deleted profile must not silently regrant revoked admin/personalization access.
- [ ] Verify purpose reset/withdrawal races with a loaded worker cannot restore old data. Verify delayed/out-of-order jobs cannot overwrite a newer snapshot or label old source data as fresh. Re-enable after withdrawal/reset must start a fresh epoch; delayed old events remain excluded. Current saved intent may remain eligible only as disclosed.
- [ ] Verify offline withdrawal persists without credentials; reconnect/login/foreground sync works with collection/personalization flags off and after account switching. Previously consenting devices retain disable controls when the public feature flag is turned off. Server confirmation is required before claiming completion.
- [ ] Verify source/profile bounds (200 references, 2,000 observations, 50 features/32 KiB), seven-day horizon, daily noise cap/recency, direct-versus-inferred labels and stale/insufficient fallback. Hidden/inaccessible entities and removed explicit boosts must not be served.
- [ ] Verify no playback fields, raw searches/filter values, URLs, names/evidence, precise locations/place identities, unrestricted brand/category text or sensitive-attribute labels enter profiles. No model/provider call is made.
- [ ] Verify retention: raw events and optional merchant actor linkage seven days; session/search correlation 24 hours; measurement health 90 days; creator/admin daily aggregates/windows 13 months; dedupe keys normally nine days with bounded final-overlap preservation during outages; reconciliation/admin access logs 30 days; profiles 24-hour physical TTL and two-hour read freshness. Existing business record retention is separate.
- [ ] Verify privacy erasure across backups/restores: do not reactivate restored consent/profile data automatically. Recover approved erasure/consent state, or invalidate optional consents through supported procedures, purge restored optional data and require fresh opt-in while all optional flags stay off. Do not reset business records to solve analytics erasure.

## 7. Post-deployment validation and observation

- [ ] Record the approved release/migration revisions, actual flag states (names/booleans only), worker versions and rollback owner. Confirm no unexpected spend or plan upgrade occurred.
- [ ] Check migrations/grants, privacy endpoints, queue acknowledgements, duplicate/payload conflict behavior, shutdown gates and SQL reconciliation. Compare known transactional actions/counters without manufacturing historical observations.
- [ ] Check rollup/profile job freshness, lease recovery, retention cleanup, query plans/latency, payload sizes, database storage/WAL/CPU and capped/dropped/invalid counts. Best-effort batch diagnostics and SQL event counters have different units; do not invent an end-to-end delivery rate.
- [ ] Inspect creator scoping and admin denial/revocation with authorized test accounts. Admin reports contain no private audience/profile rows, search text, merchant/source URLs or precise place data.
- [ ] Verify zero-match search counts exclude fallback matches, merchant requests do not become purchases, ingestion status cohorts are labelled current rather than immutable transitions, and binding/resolution is not called extraction accuracy.
- [ ] Verify charts show genuine observed data, unknown gaps and provisional counts. Today is excluded from 7/30/90 complete-day ranges. Full coverage requires 288 enabled samples/day; a seven-day growth comparison generally needs two fully sampled seven-day periods. Pre-rollout dates remain unknown.
- [ ] Verify a small opted-in profile has real permitted input, a single click remains emerging, repeated same-day taps do not compound, and reset/withdrawal/delete removes usable context. Confirm existing default recommendations remain unchanged.
- [ ] Complete a documented observation period with approved thresholds before expanding opt-in visibility. Benchmark/tune before 10k/100k DAU or raising profile throughput; stop for budget/capacity approval if needed.

## 8. Rollback and recovery

- [ ] Stop optional use first: disable personalization/profile consumption, creator/admin reporting visibility as needed, and collection server-side. Stop optional creator/admin/profile computation as appropriate. Client public flags may need an approved client update; server gates provide the immediate stop.
- [ ] Keep verified privacy withdrawal/reset endpoints, pending-device recovery, Phase 1 correctness support and maintenance/TTL cleanup available. Do not roll back to a backend that cannot honor pending erasure requests. Do not erase functional saves/follows or modify native identifiers/share configuration.
- [ ] Preserve compatible migrations/grants and inspect failure diagnostics without dumping event payloads/credentials. Prefer a reviewed forward fix. Do not drop tables, reverse schema, restore counters or restore an old database automatically.
- [ ] If a binary/database rollback is necessary, review RPC compatibility, migration wrapper/trigger dependencies and atomic engagement behavior explicitly. A pre-foundation service is not a safe implicit rollback target. Never restore direct client writes to private facts/counters as a shortcut.
- [ ] If restoring data, recover/invalidate optional consent and erasure state before reopening reads or computation, rotate purpose/measurement receipts as appropriate and purge resurrected optional profiles/events through an approved plan. Stale snapshots must continue to fall back.
- [ ] Re-run authorization, privacy, retention, source/counter reconciliation and Android/iOS smoke checks. Re-enable nothing until the failure is understood, corrected and approved.

No checklist action above has been executed against production as part of Phase 5. Stop after the local completion report and await explicit deployment instructions.
