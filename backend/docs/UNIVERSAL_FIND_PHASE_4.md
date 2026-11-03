# Universal Find Phase 4 — private image backend

Local implementation following the approved `PLAN (1).md`, Phase 4. Based on checkpoint
`f9705e620517a0a3e7507da70aeb2ba6dae69ba3`, branch `codex/share-v2-pilot`.
No commit, push, deployment, production migration, or release build is part of this work.
The original Share v2 handoff working modification remains byte-identical.

## Scope

Private images extend the existing User Import/Find and content-source pipeline. There is no new Find
entity, extraction queue, worker fleet, review queue, or mandatory save step. Eligible identified products
and places still save automatically through existing Cart/place membership services and removal markers.

This phase adds upload allocation/finalization/cancellation/status, private original/thumbnail access,
image extraction, owned source associations, deletion/recovery, and backend Stash attribution. Phase 5
camera/gallery UI, permissions, native modules, encrypted device outbox, and mobile delivery are not implemented.
Existing mobile image actions remain unavailable. Notifications and analytics additions remain Phase 6.

## API contract

All endpoints reuse verified-email authentication. User identity is taken from authentication, never JSON.
Media responses and upload capabilities use private/no-store cache headers. Errors return bounded codes,
not provider diagnostics, tokens, object paths, or extraction text.

- `POST /finds/media/uploads`: strict body `{captureId,sha256,size,mime,origin?}`. The capture ID is a UUID;
  SHA256 is the lowercase digest of the uploaded bytes; size is 1–5 MiB; MIME is JPEG, PNG, or WebP;
  origin is an explicitly supplied `camera`, `gallery`, or null. Unknown fields, owners, filenames,
  arbitrary bucket/path input, inferred origins, and unsupported MIME types are rejected.
  Returns allocation status and, while open, an upload capability limited to its allocated private staging path.
- `POST /finds/media/uploads/:uploadId/complete`: empty body. Claims a bounded verification lease,
  downloads the private staging object, checks actual size/digest/signature, decodes and normalizes it,
  generates a thumbnail, stores immutable output objects, and atomically accepts the source/import/receipt.
  A conflicting delivery returns 409. Acceptance confirms durable receipt, not extraction or Stash completion.
- `GET /finds/media/uploads/:uploadId`: owner-only status, import association, and deletion-pending state.
  It exposes no object paths, image hashes, upload tokens, or signed read URLs.
- `DELETE /finds/media/uploads/:uploadId`: cancels an uncommitted upload. Accepted images must be removed
  through Find history. Cancellation fences finalization and durably schedules cleanup.
- `GET /finds/:findId/media/original` and `/thumbnail`: authenticated JPEG bytes with private/no-store,
  nosniff, no-referrer, and restrictive content-security headers. Ownership/visibility is checked again after
  Storage I/O. No public media URL or signed download bearer capability is returned.
- `DELETE /finds/:findId`: retains existing history-removal behavior, and returns `mediaDeletion: "pending"`
  for images. Database triggers also protect legacy history deletion, account deletion, and import cascades.

Find list/detail/count/batch reuse the authoritative projection. Image records have `sourceType: "image"`,
`sourceUrl: null`, explicit capture origin, and authenticated media endpoint references in `privateMedia`.
Private images never receive manufactured public-looking URLs. Legacy imports/history responses continue
returning URL-backed records. Optional intent remains private. New similar-option generation is disabled for
image details in this phase; identified results and membership actions remain independent of that capability.

## Persistence, concurrency, and recovery

Prepared migration: `supabase/migrations/20261103150000_find_private_images.sql`.
It advances the mandatory schema preflight to **version 3**. Matching schema/API/worker source must roll out
together. No startup path applies it. Existing migrations are unchanged; no historical backfill or data reset
is introduced. Existing URL identity uniqueness stays intact.

The additive schema introduces one private asset/upload table with owner/capture identity, immutable allocated
paths, expected and verified digests, dimensions/size, acceptance references, verifier leases, and cleanup state.
It extends existing sources with IMAGE/image and owner/media association, permits image imports to omit URL
fields, and records capture origin only when supplied. Constraints/triggers reject cross-owner image imports,
invalid source/media associations, reassignment, and restoration of deleted image history.

The existing Share receipt table provides durable acceptance and dispatch. Source, import, asset acceptance,
and receipt commit together. A receipt-ID conflict rolls the transaction back, including source/import creation.
Same-capture replay never re-extracts or re-saves. Same normalized image/account reuses its existing Find;
different accounts remain separate. Perceptual deduplication is not implemented.

Admission reuses the existing Redis counter pattern, with a separate content-free per-owner namespace:
20 initialize/complete requests per minute across replicas. Database quotas bound pending uploads to ten and
new allocations to fifty per owner/day. Verification is single-owner with a three-minute expiring lease.
The codec permits two simultaneous decodes per API process and rejects additional demand with a retryable
capacity response. Owner/capture locks, lease comparisons, and existing import-attempt fencing handle races.

Signed upload capabilities are bearer secrets. Supabase documents a two-hour lifetime; allocation cleanup
uses a three-hour safety window. Capability issuance is registered after minting and before exposure, so a
slow signer cannot return a fresh token for an allocation already cancelled, deleted, or rotated. No upsert
permission is issued. Normalized outputs also use immutable writes; lost-acknowledgement replay may reuse
an identical object, never replace different bytes. See the [Supabase signed-upload contract](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).

Abandoned allocations expire and clean up. A never-accepted expired capture can resume with the same capture
ID/digest after acknowledged cleanup, using fresh immutable paths. Explicitly cancelled captures cannot reopen.
Already-accepted/deleted capture replay cannot restore hidden history or bypass a removal marker.

The existing consumer recovery loop handles image receipts independently of the URL acceptance switch and
performs bounded private cleanup. It transitions at most 25 expired allocations and claims at most 25 cleanup
records per pass, using expiring cleanup leases and compare-and-set acknowledgements. Failed object deletion
does not acknowledge success. There is no new worker service or API startup timer.

## Extraction and privacy

The adapter reads only the owning accepted image and processes one normalized still input through existing
vision/OCR/logo/scene providers, reasoner, validator, ranker, product identity gates, place persistence/resolution,
and automatic membership paths. It uses existing leased workers and failed-branch recovery. It bypasses video
download/transcription, progressive sampling, frame publication, and shared video caches. Provider wording
explicitly describes one still image rather than video/transcript evidence.

Input is limited to 5 MiB, a 2,560-pixel long edge and bounded decoded area. Real byte signatures and decoders
are checked; SVG/GIF/HEIC and animated PNG/WebP are unsupported. FFmpeg normalizes orientation, preserves
aspect ratio, strips input metadata, and produces a JPEG plus a thumbnail bounded to 480 pixels. Oversized
dimensions are rejected before full decode; Phase 5 should normalize device inputs before upload. Temporary
files use private directories and are removed in `finally`. The retained original is the normalized capture,
not an archival copy of its original metadata/resolution.

The adapter cannot promote a visual resemblance to an exact identity merely because the reasoner claims OCR.
It verifies named identity against actual OCR facts before retaining that evidence source for product resolution.
Existing specificity and identity thresholds remain. Weak/generic products remain unbound. Confirmed catalog
identities are reused; new shared discovered identities require independently acquired merchant identity facts.

Before private product resolution, image hints, merchant hints, price hints, and extraction evidence are removed
from resolver drafts. Shared search caching, creator draft updates, match history, and similar-assessment writes
are disabled inside the private worker scope. Before discovered-product persistence, an explicit merchant-field
allowlist is reconstructed and checked again against the expected identity. OCR summaries, frames, paths,
private thumbnails, notes, raw candidate metadata, and image bytes cannot be copied into that shared record.
Private merchant enrichment also clears title/brand/category hints, rejects GPT-only identity fallback,
and discards AI-sourced prices. Missing merchant facts cannot acquire merchant provenance from image hints.
Private related-media sources are excluded from public product projections and Creator Studio publication.

Worker logging has an async-scoped private filter: only bounded operational counters/opaque IDs survive.
Provider text, queries, errors, media paths, and evidence are omitted. Errors escaping the worker are sanitized.
The scope is also enforced at the private product-resolution boundary, rather than relying on one caller.
No new analytics events are emitted. Captures are still processed by the existing configured AI providers;
this phase does not claim on-device inference or change those providers' retention terms.

## Deletion and saved items

Find deletion blocks original/thumbnail reads immediately, hides the Find, invalidates processing ownership,
and queues media/evidence cleanup. Cleanup promptly removes retained media and clears private extraction
summaries, candidates, match assessments, and intent notes. The final pass waits until outstanding upload
capabilities and verification windows have expired, removes any late staging write, then reports `deleted`.
Until then, status remains `deleting`; object-store failures remain retryable.

Cart/place memberships and known global identities survive. Minimal private place-lead identity/context is
retained only where referenced by an existing Stash membership/provenance row, including removal tombstones,
so existing saved leads remain useful and can be restored. Raw evidence is cleared. Other unreferenced place
identity fields are erased. Backend Cart/Places attribution changes to **Original image removed** without
exposing a private URL. Saved products continue to use their validated shared identity, not capture pixels.

Soft account deletion, hard auth deletion, and import deletion durably schedule private cleanup. Asset cleanup
records deliberately do not disappear through an auth-user FK cascade; the consumer can remove their Storage
objects after account rows are gone. Minimal opaque provenance remains where existing saved-item FKs need it.
Known identity removals still win across retries and recaptures; unrelated unresolved identities are never
merged or suppressed merely by name, consistent with the Phase 1 boundary.

## Dependencies and rollout requirements

- **No new npm dependencies or lockfile changes.** Existing Supabase SDK, providers, Node APIs, and FFmpeg are reused.
- FFmpeg and FFprobe must be available on the **API** runtime for finalization, not just the video worker.
  The existing Dockerfile installs FFmpeg; both binaries worked locally. The deployed runtime was not inspected.
- Apply the prepared version-3 migration only through a separately approved rollout. It adds a private bucket,
  strict Storage policy, source ownership/lifecycle functions, and deletion hooks. Existing schema versions 1/2
  and their dependencies must precede it. Bucket configuration mismatches fail closed.
- Deploy matching API and worker code, retain service-role credentials only on the server, verify live Storage
  contracts privately, then explicitly enable `FIND_IMAGE_INGESTION_ENABLED=true`. The sample defaults to false.
- Continue running the existing content-source consumer: accepted dispatch, Stash repair, orphan cleanup,
  deletion retries, and account cleanup depend on it. No compatible rollback should run older membership code.

## Verification and limits

The disposable runner is `python3 -B backend/scripts/findImagesSqlScratch.py`. It reuses Phase 1/2 checks,
then applies Phase 4 only to a fresh Unix-socket-only PostgreSQL fixture. No dotenv or production connection
is used. Image fixtures run through actual local FFmpeg/FFprobe. Storage and paid AI are injected fixtures;
no live Supabase Storage, live authentication, or paid extraction was invoked.

Coverage includes ownership/guessed IDs, grants/restrictive RLS, malformed payloads, digest verification,
normalization/metadata stripping, immutable object replay, concurrent verifier claims, stale/null leases,
normalized account-scoped deduplication, capture-ID conflicts/transaction rollback, expiry/resume, cancellation,
late signer cancellation, account deletion, late worker fencing, original/thumbnail cache/security headers,
automatic product/place saving, removal versus replay, explicit restoration, evidence purge, retained place
identity, and failed/deferred cleanup. Existing 1,920 outcome-parity and 1,205-history pagination/count tests run too.

Local tests are not release acceptance. Live Storage signed-upload/RLS behavior, provider accuracy, production
capacity/bandwidth, decoder deployment/patching, and real-device delivery remain validation work. Normalized
byte deduplication can change if encoder output changes across runtime versions; it is not perceptual matching.
Render sleep/queue durability and existing YouTube limitations remain. A stopped consumer delays dispatch and
deletion completion; authenticated media blocking still takes effect at deletion. Phase 5 UI/native/offline
delivery and Phase 6 notifications/measurement remain separate work.

### Local verification results

- Backend `npm run typecheck`, client `npm run typecheck:client`, and root `tsc --noEmit`: passed.
- Repository `npm run lint`: **0 errors, 23 existing warnings**. Explicit lint of all new media files,
  image adapter, private logging, and changed Product Intelligence factory/enrichment: **0 errors/warnings**.
- **13/13** new image tests passed. These include the real codec, API adapters, worker/product/place pipeline,
  immutable Storage behavior, cache/log privacy, independent merchant provenance, public product media exclusion,
  Creator Studio rejection, and membership replay/removal/restoration.
- Broader backend non-live suite: **1,157/1,160 passed**, plus **9/9** ingestion-runtime checks run from their
  required repository-root cwd: **1,166/1,169 combined**, with three known baseline assertion failures below.
  Two local HTTP fixtures initially hit sandbox `listen EPERM`; both passed when rerun with local-port permission.
- Broader client source suite: **549/561 passed**, with twelve preexisting failures below. Phase 4 changes no
  client/native source. Live OpenSearch and Supabase notification integration suites were not run.
- Available render checks: **304 Find**, **32 Share**, **60 Places/Create/Profile** checks passed.
- Disposable PostgreSQL migration/security/API integration checks passed, including the earlier Phase 1/2
  concurrency, 1,920 outcome-parity, and 1,205-record pagination/count fixtures. The final deletion-key variant
  was checked with the same runner; only the temporary local database received migrations.
- Tracked diff whitespace checks passed. Nothing is staged or committed; the branch and checkpoint HEAD
  are unchanged. The original handoff SHA256 remains
  `9c1d9ade39a3d63b1bb16a1bc8926dabc9f08fc468a2651c7fdb579ca9eb9a43`.

Backend baseline failures retained:

1. `src/config/pipeline.test.ts`: cache-key assertion expects the older places pipeline version.
2. `src/content-source/ContentSourceService.test.ts`: static boundary assertion rejects the preexisting
   catalog/discovered image projection.
3. `src/prompts/productReasoner.test.ts`: text-payload assertion expects the older progressive reasoner arguments.

The failing test files and their directly implicated assertions/implementation are unchanged by Phase 4.
The shared OpenAI reasoner adds only the explicit image-input prompt branch; the preexisting URL/video prompt
behavior is retained. These are the three mismatches classified before the Phase 1–3 checkpoint.

Client baseline failures retained: one notification campaign fixture; four old theme-default assertions;
two signed-out Stash-copy assertions; and five TS/CommonJS test-module loading failures involving
`import.meta.dirname`. No unrelated fixes were included.
