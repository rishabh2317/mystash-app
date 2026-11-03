# Universal Find Phase 5 — durable mobile capture

Local implementation on `codex/share-v2-pilot`, based on checkpoint
`f9705e620517a0a3e7507da70aeb2ba6dae69ba3` and the uncommitted Phase 4 backend.
All 61 preexisting dirty files were hashed before implementation and remain byte-identical,
including the intentionally modified Share v2 handoff. No commit, deployment, live migration,
production flag activation, native prebuild, APK/IPA, or release build was performed.

## Behavior

- In-app Find URLs use the native encrypted Share v2 outbox and `/imports/accept`, including stable
  capture IDs, receipt replay, existing automatic extraction/saving, and background URL delivery.
  Repeated pending URLs for the same owner reuse their local record. Existing `.share` records,
  encryption keys, unassigned-share claims, intent conflicts, external URL share targets, and delivery
  methods retain their format and behavior.
- Camera and Screenshot / Gallery actions use installed Expo Image Picker, Image Manipulator, and
  File System APIs. Selection is still-image-only and single-selection. Images are resized to a
  2,048-pixel long edge when needed, encoded as JPEG at 0.8 quality, and rejected above 5 MiB.
  Phase 4 still independently verifies signatures/dimensions/digests and strips metadata server-side.
- The success message appears only after native encrypted persistence completes. It says securely
  queued, rather than claiming server acceptance or Stash completion. URL server acknowledgements
  remain distinct. Find displays local pending images separately from authoritative global counts.
- Image delivery runs serially in the foreground and resumes on application start, foreground entry,
  refreshed sessions, and a bounded 15-second foreground timer. Network failures retain encrypted
  bytes and persisted retry state; exponential delays and server Retry-After are respected. After
  twelve unsuccessful attempts, an explicit retry remains available. There is no new extraction pipeline.
- Delivery reuses Phase 4 allocation, signed immutable Storage upload, and finalization APIs. It persists
  allocation metadata but never signed upload capabilities. Finalization verifies existing bytes before
  acceptance. Lost upload/finalization responses recover with the same capture ID; initialization can
  replay an accepted receipt without uploading or extracting again.
- Accepted records atomically drop their encrypted pixel field, retaining only reconciliation metadata.
  Find batch refresh confirms the record or its explicit unavailability before removing that metadata.
  A history refresh failure cannot downgrade acceptance or demand already-purged pixels.
- Image Finds show authenticated, uncached previews and an in-app original-image modal. Access tokens
  are headers, never URLs or disk cache keys. Private media is not handed to the system browser or public
  image cache. Existing product/place results and remove/restore actions are reused.
- Older native binaries, Expo Go, web, or disabled native-share installations do not substitute plaintext
  image persistence. Image actions stay unavailable. URL capture retains the existing online-only fallback
  on those installations, confirming receipt before clearing input.

## Ownership and encryption

Images are version-1 `.image` AES-GCM envelopes alongside the unchanged `.share` records. Android uses
the existing Keystore key and atomic, fsynced writes in `noBackupFilesDir`; iOS uses the existing device-only
Keychain key, App Group lock, atomic writes, Data Protection, and backup exclusion. No new key store,
credentials, refresh-token bridge, database, or dependencies were introduced.

Envelopes contain immutable owner/capture IDs, MIME, normalized input digest/size, explicit camera/gallery
origin, state, retries, timestamps, and encrypted bytes. They contain no original filename or gallery asset ID.
Only summaries cross the bridge during listing; bytes are decrypted on demand for one upload. Listings
discard byte fields one record at a time rather than retaining every pending image in memory. Capacity is
twenty image envelopes across the installation, separate from the existing URL limit.

Every native read, update, enqueue, and removal validates the expected owner against the current native
session. Image owner reassignment is not exposed. Sign-out/account changes invalidate the foreground
drainer; API identity is checked before and after requests and after JSON parsing. Storage upload uses a
strict configured-origin/private-bucket/path allowlist, no account Authorization header, and no redirects.
An already-started request may finish for its original account; no request reuses the next account's token
for a previous account's capture. Old-account records remain encrypted and can resume only on that account.

Retry mutations remain inside the serialized drainer so a manual retry cannot downgrade concurrent
acceptance. Uncertain outcomes never delete pixels. Immutable-upload conflicts are followed by server
digest verification, never overwrite or false acceptance. Local pending-image removal is local only; any
already-accepted Find remains in history, while abandoned remote allocations use Phase 4 orphan cleanup.

Picker/manipulation files are transient OS-private cache inputs, not the pending outbox. Files created by
the operation are cleaned in `finally`, restricted to the app cache; original gallery/library files are not
deleted. A crash before secure queuing can leave OS cache files until OS cleanup and can lose an in-progress
picker result. No durable-capture acknowledgement is shown before encrypted persistence. Android
activity-destruction/picker-result recovery before that acknowledgement remains a physical-device gate;
the implementation does not consume an unowned stale picker result under a newly signed-in account.

## Permissions and native build implications

- Camera: explicit just-in-time runtime request. Denial is actionable; permanent denial offers Open Settings.
  The installed Android picker already declares CAMERA. iOS gets explicit Mystash camera-purpose text.
- Gallery: iOS requests photo access and accepts limited/selected access. Android uses the system photo
  picker/selected-URI grants, without a new broad media-library permission request.
- The existing photo-purpose description now covers screenshots/images as well as profile pictures.
  Microphone permission is explicitly disabled in the Expo picker plugin; no audio recording is added.
- The only native configuration edit is those picker plugin options in `app.json`. Application identifiers,
  URL scheme, EAS project/profile/signing configuration, App Group/Keychain entitlements, native targets,
  Gradle/pod dependencies, and external share-target activation rules are unchanged.
- A newly approved Android/iOS native build is required to expose the added bridge methods and permission
  descriptions. An OTA JS update cannot supply these methods; existing APK versionCode 4 lacks them.
  No build/versionCode bump, provisioning change, or build command was started here.
- Native capture capability uses the existing `EXPO_PUBLIC_NATIVE_SHARE_ENABLED` configuration and runtime
  method/version detection. No production flag was changed. Live delivery also needs a separately approved
  Phase 4 schema-3/API/worker rollout and `FIND_IMAGE_INGESTION_ENABLED` activation in the intended environment.
  No Phase 5 migration or new dependency is required.

## Automated verification

- Client `npm run typecheck:client` and backend `npm run typecheck`: passed.
- Repository `npm run lint`: 0 errors, 23 existing warnings. Explicit changed/new capture-source and
  configuration/integration-script lint: passed without errors/warnings.
- Focused Find/client capture tests: 38/38 passed, including twelve new delivery/permission/security tests
  and the new durable URL acknowledgement test. A 5 MiB decoder regression fixture verifies bounded linear
  decoding; the initial repeated-group regexp was replaced after a real-size check exposed stack overflow.
- Full client source suite: 562/574 passed, the same twelve baseline failures as Phase 4. They comprise
  one notification campaign fixture, four theme defaults, two signed-out Stash-copy assertions, and five
  TS/CommonJS `import.meta.dirname` module-loading failures. No new failing assertion remains.
- Native config/plugin/endpoint checks plus the cross-layer capture integration: 14 passed, 1 existing
  Xcode-project-fixture check skipped. The installed Expo plugin's actual iOS/Android permission modifiers
  were evaluated in memory, without generating native projects.
- Cross-layer integration uses mobile transport -> real Phase 4 API handlers/service -> real FFmpeg codec,
  with fixture authentication, DB, native storage, and object storage. A lost finalization reply followed
  by drainer restart produces one upload/acceptance and removes pixels only after receipt recovery.
- Phase 4 image/backend Find API focused checks: 17/17 passed. The full backend regression suite was not
  repeated because every Phase 4 implementation byte is preserved. Its three previously classified baseline
  failures (cache version, content-source static boundary, old reasoner arguments) remain unresolved.
- Render/interaction adapters: 348 Find, 32 Share, and 60 Places/Create/Profile checks passed (440 total).
  Coverage includes both themes, Android/iOS adapters, 320/390/430 widths, large type, image capability fallback,
  queue states, queued URL acknowledgement, permission Settings recovery, owner filtering, and private cache policy.
- Actual Android ShareStore source compiles against the cached Android SDK/Kotlin compiler, with only the
  unchanged URL-validator class stubbed. Swift source and XCTest syntax parse; actual ShareCore also
  typechecks against the installed iOS simulator SDK without linking an app. Full Expo bridge compilation,
  Android instrumentation, and entitled iOS XCTest execution still require approved native test builds.
- Added native tests cover encrypted image files, duplicate capture IDs, account isolation, byte purge after
  acceptance, and coexistence with pending URL records. These test sources were not executed on a device.
- Git whitespace checks and preexisting-file hash verification passed. No secrets or private images were
  used as fixtures. Nothing is staged.

## Remaining validation and operational risks

1. On physical Android/iOS devices, verify real camera availability, camera/gallery cancellation, iOS limited
   photo access, denied/permanently denied access and Settings return, HEIC/Live Photo still conversion,
   EXIF rotation, large screenshots, memory pressure, large text, safe areas, and VoiceOver/TalkBack.
2. Verify Keystore/Keychain encryption, backup exclusion, force-quit/relaunch after the secure-queue message,
   device reboot/first unlock, account A -> sign-out -> account B isolation -> account A resume, and an upgrade
   containing existing assigned/unassigned URL records. Native runtime tests require a dedicated installation.
3. Against an approved live test backend, verify actual signed Storage PUT behavior, content type/headers,
   expired/reused capabilities, lost PUT/finalization replies, 401/403/409/422/429/503 handling, token refresh,
   offline/reconnection, and automatic capture -> extraction -> product/place Stash attribution.
4. Verify removed products/places stay removed through delivery/retry/recapture, explicit restore works,
   image deletion immediately blocks fresh reads, saved items survive, and deferred remote cleanup completes.
5. Image sending is foreground-only. Backgrounding/force-quitting pauses progress; encrypted queued records
   resume on foreground. Existing native URL delivery retains its platform background limitations. Render
   worker sleep/queue durability, provider accuracy, decoder deployment, and Phase 4 cleanup/rollout risks remain.
6. Successful secure queuing is the durability boundary. OS termination while the system picker or initial
   normalization is still running can require capturing again. Transient picker cache is OS-protected rather
   than an AES-GCM envelope; queued bytes always use the encrypted native store.

Phase 6 notifications/measurement, external image share-target ingestion, production activation, and release
builds are outside this implementation. Work stops after Phase 5 for review.

## Phase 5 file scope

The following files are Phase 5 additions/edits; all Phase 4 files and the handoff are preserved separately.

```text
app.json
app/_layout.tsx
app/(tabs)/find/index.tsx
app/(tabs)/find/capture.tsx
components/find/CaptureDeliveryLifecycle.tsx
components/find/FindCaptureActions.tsx
components/find/FindCard.tsx
components/find/FindDetailView.tsx
components/find/ImageCaptureFeedback.tsx
components/find/PendingImageCaptures.tsx
components/find/PrivateFindImage.tsx
modules/mystash-share/index.ts
modules/mystash-share/android/src/main/java/expo/modules/mystashshare/MystashShareModule.kt
modules/mystash-share/android/src/main/java/expo/modules/mystashshare/ShareStore.kt
modules/mystash-share/android/src/androidTest/java/expo/modules/mystashshare/ShareCaptureTest.kt
modules/mystash-share/ios/MystashShareModule.swift
modules/mystash-share/ios/ShareCore.swift
modules/mystash-share/ios/Tests/ShareCaptureTests.swift
src/hooks/useFindCapture.ts
src/hooks/useFindImageCapture.ts
src/services/captureDelivery.ts
src/services/captureDelivery.test.ts
src/services/captureRuntime.ts
src/services/captureTransport.ts
src/services/imageCapture.ts
src/services/imageCaptureDevice.ts
src/services/nativeShare.ts
src/state/findCaptureController.ts
src/state/findControllers.test.ts
src/ui/find.ts
scripts/check-find-capture-native.py
scripts/check-find-ui.cjs
scripts/findCaptureConfig.test.cjs
scripts/findCaptureIntegration.test.cjs
backend/docs/UNIVERSAL_FIND_PHASE_5.md
```
