# Share to Mystash v2 — local implementation handoff

Status: three milestones implemented locally, feature flags default disabled. Final source/configuration integration review completed on 2026-11-02. No live migrations, deployments, provider calls or mobile builds were performed. Existing dirty work was preserved. Native compilation and device behavior are not verified.

## Milestone 1: native capture and durable acceptance

The local Expo module provides a lightweight Android Activity and iOS Share Extension. Config plugins generate native resources and targets; existing application identifiers remain unchanged. Capture is written to an encrypted, bounded outbox before local-pending feedback. Android uses Keystore and WorkManager; iOS uses Keychain, App Group files and background URLSession. Only access-token snapshots are synchronized, never refresh tokens. Expired authentication pauses delivery. Signed-out records require explicit claim; account checks guard pending-record reads and mutations.

`POST /imports/accept` uses stable client capture IDs, payload digests and transactional receipts. Replays return the original acknowledgement without restarting extraction or replacing intent. Acceptance is distinct from extraction success. Admission is account-throttled through Redis; clients retain pending records and respect retry delays. Existing consumer processes reconcile bounded leased batches, preserve active work and fan out committed product/place partial successes. Retained BullMQ terminal jobs are explicitly retired before retry; duplicate-add exceptions are not used as job-state detection.

Queued receipts can recover missing Redis jobs. Loss of active processing remains subject to existing processing leases and explicit retry; this is not a replacement for persistent production queues. Failed extraction is not automatically replayed wholesale.

## Milestone 2: private optional intent

Product / Place / Both and a 280-character note are optional. Import-owned intent has optimistic revisions. Receipt replay cannot replace newer edits; stale native intent remains recoverable for explicit review. Your Shares supports owner-authorized editing. Intent only reorders existing results using literal evidence; it is not identity evidence, does not enter global caches/prompts and does not trigger providers or suppress either extraction branch. Diagnostics exclude notes, URLs and tokens.

## Milestone 3: reviewed similar suggestions

The exact-match path and thresholds remain intact. A separate conservative deterministic policy evaluates existing resolver candidates and bounded verified-catalog reads. Brand/model/variant/accessory conflicts, weak evidence and invalid merchant destinations are rejected. At most three suggestions are retained per source product; scores are evidence ranks, not probabilities. Optional assessment failures do not fail the existing extraction path.

Similar products require explicit Save/Dismiss in Your Shares. Save revalidates the destination and candidate, uses existing discovered-product/Cart services, and uses leased review decisions for retry recovery. It never binds a suggestion globally as the exact video product. Product failures preserve Places and retained video access. Compatible keyset history pagination replaces the gated 20-item ceiling; loaded older pages survive head polling and polling pauses when inactive.

## Configuration and rollout gates

Backend switches: `SHARE_ACCEPT_ENABLED`, `SHARE_INTENT_ENABLED`, `SHARE_SUGGESTIONS_ENABLED`.

Client/build switches: `EXPO_PUBLIC_NATIVE_SHARE_ENABLED`, `EXPO_PUBLIC_SHARE_INTENT_ENABLED`, `EXPO_PUBLIC_SHARE_SUGGESTIONS_ENABLED`.

No switches were enabled in local or deployed environments. Additive migrations prepared:

- `supabase/migrations/20261102120000_share_acceptance.sql`
- `supabase/migrations/20261102130000_share_intent.sql`
- `supabase/migrations/20261102140000_share_reviews.sql`

Future authorized rollout must deploy schema, API and existing-worker recovery support before enabling clients. Keep backend emergency switches independent. Preserve pending outbox storage/entitlements in subsequent binaries. Verify deletion behavior and rollback with retained receipts/reviews before rollout.

Native capture does not work in Expo Go. New Android/iOS binaries and device acceptance tests are required. Verify Apple developer access, extension provisioning, App Group and shared Keychain entitlements; proposed derived identifiers are not provisioned by this work. Confirm signing, backend URL and bundled flags before a future build. Existing main app identifiers must remain unchanged.

Background delivery is OS-controlled. iOS force-quit may cancel transfers; pending records survive for later recovery. Save p95 <250 ms and return-to-source <2 seconds are targets, not measured results. Validate crash/offline/storage exhaustion, expired auth, account switching, background restoration and lost acknowledgements on representative devices. Native Android/XCTest cases are present but unexecuted. Use a dedicated entitled test host; do not run storage tests against a real account's outbox.

Production needs available workers and durable Redis. Render Free sleeping/volatile queue constraints and the existing Render YouTube download/login-required failure remain separate operational limitations. No new extraction was run to assess them. Historical records without assessments are not backfilled automatically. Conservative matching may intentionally retain unresolved products.

## Verification

Completed during implementation:

- 170 focused backend/client regressions passed, including the existing baseline and recorded merchant-candidate replay; no new provider calls.
- Five native-plugin checks passed, including an idempotent Xcode-project fixture round trip.
- Isolated disposable PostgreSQL checks passed: concurrent acceptance, rollback, owner authorization, intent revisions/replay, leases and review claims. No existing database was used.
- Isolated disposable Redis/BullMQ checks passed: retained terminal jobs, retry and preserving waiting jobs. Existing Redis was not used.
- 32 new shared UI render checks passed across both themes and Android/iOS adapters; 60 existing Places/Create/Profile render checks passed. These are render adapters, not native/device tests.
- Final focused rerun: 16 tests passed. Backend TypeScript passed. Swift syntax parsing and podspec syntax checks passed; these are not native typechecking/compilation.
- Full client lint: zero errors, 23 existing warnings outside the new share implementation. `git diff --check` passed.
- At initial handoff, client TypeScript reported two pre-existing typed-route errors in `CreatorAnalyticsScreen.tsx:147` and `LegacyAnalyticsScreen.tsx:150`. The final integration review fixed their shared navigation helper's return type; client and backend TypeScript now both pass.

Reproducible local checks include `npm --prefix backend run typecheck`, `npm run typecheck:client`, `npm run lint`, `node scripts/check-share-ui.cjs`, `node scripts/check-places-ui.cjs`, `python3 backend/scripts/shareSqlScratch.py`, and `node backend/scripts/shareQueueScratch.cjs`. Scratch checks create only their own temporary instances; socket/shared-memory permissions may require approval. Do not substitute live service URLs.

## Changed-file manifest for this implementation

New native implementation: `modules/mystash-share/**` (Kotlin, Swift, bridge, fixtures, module/build metadata and native tests).

New Expo integration: `plugins/withNativeShare.js`, `plugins/shareTheme.js`, `plugins/withNativeShare.test.cjs`. Extended `plugins/withAndroidShareIntent.js` and registered the plugin in `app.json`.

New backend: `backend/src/user-import/share/**`; terminal-job helper/test in `backend/src/content-source/jobs/terminalJob{,.test}.ts`; scratch checks `backend/scripts/shareSqlScratch.py` and `shareQueueScratch.cjs`; the three migrations above.

Extended backend integration: `backend/src/index.ts`, `backend/.env.example`, `backend/src/content-source/jobs/contentSourceQueue.ts`, `contentSourceWorker.ts`, `backend/src/content-source/processing/ContentSourceResolutionService.ts`, `createResolvingProcessor.ts`, `backend/src/product-intelligence/domain/types.ts`, `resolver/ProductResolver.ts`, `backend/src/user-import/domain/types.ts`, `SupabaseUserImportRepository.ts`, `UserImportService.ts`, and `backend/src/cart/domain/types.ts`, `routes.ts`.

New shared UI/client: `components/search/NativePendingShares.tsx`, `ShareImportDetails.tsx`, `src/services/nativeShare.ts`, `nativeShare.test.ts`, `shareReviewApi.ts`, `src/ui/shareHistory.ts`, `shareHistory.test.ts`, `scripts/check-share-ui.cjs`.

Extended shared UI/client integration: `components/search/ShareActivityCard.tsx`, `contexts/AuthContext.tsx`, `app/shares.tsx`, `src/hooks/useImportSharesPoll.ts`, `src/services/cartLineMap.ts`, `app/(tabs)/stash.tsx`.

Other files already modified in this checkout belong to earlier work and are not claimed as part of this implementation.

## Final integration verification and release decision

Decision: **GO for a separately authorized native validation build; NO-GO for enabling or releasing v2 yet.** There is no remaining TypeScript blocker. Kotlin/Swift native compilation, device execution and Apple provisioning are outstanding gates, not inferred successes from JavaScript or source checks. No native build was initiated for this review.

Confirmed and fixed during final review:

- Single-target Expo Xcode fixtures lack dependency/proxy sections. The Xcode library silently skipped the containing-app-to-extension dependency when those sections were missing. `plugins/withNativeShare.js` now initializes them and repairs an existing extension target's missing dependency. Extension embedding and idempotence have explicit fixture assertions; extension targets use `SKIP_INSTALL=YES`.
- iOS background retry now accepts HTTP-date as well as numeric `Retry-After`. A delayed transfer keeps its outbox lease past its scheduled start, avoiding repeated scheduling every five minutes while waiting. Scheduling rechecks account/token under the cross-process outbox lock. Requests accepted before logout remain owned by the original account; cancellation of in-flight OS-managed requests remains best effort.
- Android share Activity shuts down its executor on destruction without canceling an already queued durable write.
- `src/ui/collectionLayout.ts` now returns the precise `/reel/${string}` route type. Both Analytics callers typecheck without casts or behavior changes.

Final checks: seven plugin/fixture checks, 32 shared UI render checks, client/backend TypeScript, Swift syntax parsing and whitespace checks passed. Disposable PostgreSQL passed 24 concurrent deliveries plus rollback, replay, CAS, owner isolation, dispatch and review lease checks. Disposable Redis/BullMQ retry compatibility checks passed. Full lint completed with zero errors and 23 existing warnings. A combined TS regression run passed 27 tests; the existing `collectionTileNavigation.test.ts` cannot initialize under this CommonJS tsx invocation because `import.meta.dirname` becomes undefined. This is a test-runner compatibility limitation, not a TypeScript or mobile-build failure; its execution remains outstanding under an ESM-compatible harness. Earlier focused/extraction regression results above are unchanged.

Android conflict check: only the existing exported `ShareIntentActivity` owns ACTION_SEND. Its enabled branch forwards to the private native Activity and returns before legacy MainActivity routing. With the build flag disabled, the legacy deep-link route remains. Both native/platform identifiers are unchanged. This is verified in generated-source/manifest fixtures, not by device Sharesheet observation.

Suggestions remain assessments only until explicit owner-authorized Save invokes Cart services. Shared source-product exact bindings are unchanged. Review leases, owner checks and merchant revalidation remain in place; private intent cannot change shared identity evidence. Native signed-out/account-switch cases exist but require device execution; server owner isolation and replay have executable SQL coverage.

### Future authorized deployment sequence

1. Preserve a backup and current application/worker versions. Apply the three additive migrations in timestamp order to a nonproduction validation environment first. Verify existing core schema constraints, service-role RPC execution, RLS and deletion cascades there. Do not roll back by dropping tables/columns containing receipts, notes or decisions.
2. Deploy compatible API and ingestion worker code with all v2 flags off. Verify health, existing imports/Creator Studio/Places/Analytics, Redis availability/persistence, worker recovery startup wiring and bounded processing. API-only instances must not start consumers. Schema must precede code that selects intent fields.
3. In the authorized pilot environment, enable the three backend flags together only after infrastructure validation. Verify acceptance replay, partial success, private intent and review recovery using authorized accounts. Production Redis durability and worker availability are required for a reliability claim. The existing Render Free sleep/Redis limits and YouTube download failure are independent unresolved operational gates.
4. For a later authorized validation build, align native and JavaScript flags at build time, verify the HTTPS API base, preserve both main app identifiers/signing, and verify iOS extension credentials and shared entitlements. The plugin declares the extension through Expo's documented EAS app-extension configuration; declarations do not prove successful provisioning.
5. Run the Android/iOS checklist below. Enable a limited rollout only after it passes; measure local acknowledgement latency and return-to-source time on representative devices. No provider-budget increase or additional extraction calls are part of this verification.

Rollback: stop new acceptance with `SHARE_ACCEPT_ENABLED=false`; clients retain pending captures and must not report extraction success. Existing queued processing can continue through existing workers; receipt reconciliation pauses with this flag and must resume later. Keep migrations, encryption keys/App Group entitlements and outboxes. Keep `SHARE_SUGGESTIONS_ENABLED` available for saved-product similarity labeling after any accepted suggestions exist; disabling it also disables the current Cart label decorator. Do not roll back to code that presents reviewed similar products as exact. Intent withdrawal/deletion controls remain independent. A client rollback cannot instantly remove an installed native extension; use backend shutdown and preserve pending-data recovery in subsequent binaries.

### Android and iOS acceptance checklist (not executed)

- Share Instagram, YouTube and a supported web URL from cold/warm app states; verify one Mystash target, compact sheet, optional fields, one Save, durable pending feedback, and return to source without full-app launch. Cancel must create no record; unsupported payload must clearly fail.
- Airplane mode: Save, terminate the app/process, restore network, verify eventual single acceptance. Test lost acknowledgements, duplicate/concurrent delivery, 429 Retry-After (seconds/date), 503, storage-full/corrupted storage, retry exhaustion and manual recovery. Never erase records silently.
- Signed out: capture remains unassigned/encrypted; login requires explicit claim. Expire access tokens and refresh only in the app. Switch A→B→A and logout during delivery; B cannot see/claim A's records or private intent. Never transfer refresh credentials.
- iOS: verify App Group and Keychain access in both targets, extension resource loading, background-session restoration to the containing app, device lock, force-quit and later foreground recovery. Android: verify Keystore persistence, WorkManager constraints, process death, reboot, Doze and back navigation. Confirm no URL/note/token in logs or scheduler input.
- Save and edit intent, submit stale offline edits, replay receipts, and verify no overwrite/cross-user access. Verify no extra AI/search calls, both product/place results, and unchanged exact-match behavior.
- Similar product is visible only in review until explicit Save; double Save and interrupted confirmation yield one saved item. Verify Dismiss, merchant revalidation, Similar product label after Save, unresolved video viewing/Close/Back, paginated history and inactive-screen polling pause.
- Smoke-test existing legacy Android sharing (v2-disabled binary), Creator Studio publish/drafts, Places source viewer, Analytics consent, notifications and authenticated navigation on both platforms.

Reference: [Expo app extensions](https://docs.expo.dev/build-reference/app-extensions/), [Apple shared background-session container](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/sharedcontaineridentifier), [Android WorkManager releases](https://developer.android.com/jetpack/androidx/releases/work).

## Controlled pilot rollout preparation — 2026-11-02

The user subsequently authorized a complete Android test rollout, including the three migrations, matching Render API/worker code, all backend/client switches, and one free-tier signed APK. Deployment remains gated on live queue/worker safety and privacy checks.

Current status: **paused before live changes; no new APK submission**. EAS build history confirms that the interrupted capture-only submission did not create a build. The latest recorded finished APK remains `84e9d9cd-3915-4675-b762-bb47615ff9f8`; it is not a Share v2 APK.

Read-only live Supabase schema preflight succeeded against the existing linked project `womdeohfpvzmhomgqwig`. Existing source/import tables, URL uniqueness and import-work fencing functions are present; the new receipt/review tables and v2 functions are absent. The authorized test account exists and is verified. The temporary Supabase CLI login needs its already granted `postgres` role for this introspection; no role grant was made. Schema evidence is retained privately under `backend/.analytics-release-private/share-v2-pilot/preflight.json`.

This database is shared with the existing development workflow, not a newly isolated database. At the read-only snapshot, sources included three QUEUED and three RECEIVED records, no PROCESSING rows. Those are database states, not a Redis queue inspection. Render queue ownership, active/delayed jobs, current worker version and drain behavior must be verified before any cutover; do not replay or drain these records merely to run acceptance tests.

The dedicated `android-share-validation` EAS profile now extends `render-test`, enables all three client share switches, inherits all existing Analytics/notification switches, remote signing, the same application identifier, APK output and the Render HTTPS endpoint. Babel pins this profile's endpoint as for the existing Render profile. These are local build-profile changes only; no remote/backend flag was enabled. Client/backend TypeScript and four endpoint transform regressions passed again.

EAS account check reported Free, with 2 of 15 Android builds used in the current billing month and no overage charges. Recheck before submission. No paid service was provisioned.

Blocker: Render has no configured API/CLI connection, and the computer-use tool continues to return `Computer Use permissions are not granted` after the user reported enabling access. The browser inventory also reports no browser bridge. No Render settings, migration, deployment, queue or credentials were changed. Resume the existing authorized rollout once dashboard access works; do not submit a full-feature APK against an unverified backend as a substitute.
