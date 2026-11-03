# Places Milestone 2 — performance and reliability

Deployment update (2026-10-28): the user subsequently approved the two Places migrations,
backend restart, and an internal Android APK. See [device-test release](./PLACES_DEVICE_TEST_RELEASE.md).
The local-only statements below describe the original milestone implementation.

Status: implemented and verified locally, 2026-10-28. No deployed services,
production databases, tracking flags, dependencies, paid providers, or native builds
were changed. Existing Milestone 1 and Creator Studio work remains in the checkout.

## Discovery and scheduling

The existing reasoner still receives one **combined products/places request per
progressive stage**. The existing pipeline can visit one to three stages; this is
not a promise of one request for an entire difficult video. Prompts, models,
product validator/ranker, frame sampling, product caps, and provider identities
are unchanged. There is no place-only AI request or new enrichment stage.

The shared decision now exposes independent product/place readiness. Specific
places with sufficient existing confidence, a searchable stated location, and
name/location support in shared text/OCR can resolve while later shared evidence
is being gathered. The existing place identity gate still must accept a provider
match before canonical persistence. Ambiguous/failed provisional matches wait for
final evidence before creating leads. Exact hypothesis keys deduplicate mentions;
normalized provider/query keys memoize searches within one attempt, including
failures. A later attempt can retry a failed search.

A grounded place does **not** prove that a video has no merchandise. Product
enrichment retains its previous budget, including a fixture whose product is
visible only at stage 3. Missing places do not introduce extra AI work after the
product gate passes. This conservative policy improves time to useful results
without trading product coverage for fewer calls.

Product resolution starts as soon as its existing quality gate settles. Place
resolution starts from grounded evidence independently. Early accepted places are
retained through later snapshots; unresolved mentions use final shared evidence.
The reporting ledger distinguishes branch completion from completion of shared
evidence. Clients continue polling and say “Finishing discovery…” if both early
branches are complete while the evidence pass is still active.

Completed sibling results survive branch retries. A media/evidence failure cannot
be cached as an empty product success: valid Places remain, incomplete evidence
is marked, and retry acquires evidence again rather than taking the downstream-only
shortcut. Existing source counts, APIs, navigation IDs, and timeout behavior remain.

## Persistence and stale workers

The forward migration `20261028130000_places_reliability.sql` requires Milestone 1.
It has not been applied to any existing database.

- Adds a private `user_place_save_sources` junction. One canonical card can retain
  multiple hypothesis/source/import links. Backfill copies only attribution still
  present in existing saves; previously lost historical links cannot be recovered.
- Adds private `place_save_redirects` so retries using a merged save ID reach its
  surviving card. Legacy singular `source`, `placeId`, and `leadId` fields remain;
  `saveId`, `resolutionStatus`, and `sources` are additive API fields.
- Moves hypothesis upsert, canonical promotion, all affected card upgrades, merge,
  source transfer, and redirect updates into transactional RPCs. Canonical identity
  still comes from provider identity, never name similarity. Reassignment to a
  different canonical identity fails atomically.
- Adds per-source leased ownership, atomic claim, heartbeat renewal, bounded
  expiry, evidence completion, and token-checked release. An expired owner cannot
  renew itself or release its successor. A duplicate job waits without consuming
  the normal extraction retry budget.
- A worker-local async context adds source/attempt headers only to the Supabase
  admin transport. Statement guards lock/check ownership before affected entity,
  product, Cart, catalog, cache, and reporting writes. Takeover waits for any
  already-admitted transaction. Private headers are never sent to AI/search APIs.
- Place save attribution is idempotently attached even for another imported URL
  of the same source, an already-resolved hypothesis, or a late importer.

RPCs and junctions are service-role only, with RLS and ownership-consistency checks.
No authoritative records are purged. Physical source/account deletion and existing
foreign-key behavior are unchanged; this milestone does not add deletion features.

## Bounds and cancellation

- At most two place searches per resolver invocation; the existing worker admits
  two source jobs, so a single worker can have at most four such searches active.
- Place search: existing 8-second bound, now also cancelled by attempt cancellation.
- Attempt deadline: 180 seconds. Lease: 60 seconds, renewed every 15 seconds.
- Supabase requests: 25 seconds in import context; ownership control RPCs: 10 seconds.
- External fetches in import context: at most 40 seconds; existing shorter YouTube
  bounds remain, Instagram oEmbed is 8 seconds.
- Google Vision import requests: 10 seconds per image/feature with automatic retry
  disabled. The same TEXT_DETECTION/LOGO_DETECTION features are requested. Ordinary
  Creator requests continue using their previous helper calls.
- Owned media subprocesses: 60 seconds, killed on cancellation; metadata probe keeps
  its existing 25-second bound and also stops on cancellation. Work directories are
  cleaned in `finally`. Storage keys include the attempt ID so a late upload cannot
  overwrite the next attempt's evidence.

Outside import context, shared transports delegate to their original behavior.
Providers which ignore cancellation can finish their already-started request, but
cancelled scopes and database guards prevent late entity publication.

## Offline evidence and measured results

Fixtures and replay live in `backend/src/place/testing/`. Frozen pre-change Milestone
1 gate, extractor, processor, and resolver snapshots have checked SHA256 hashes. The
baseline loader transplants only test ports into the frozen extractor. Both runs
use the same in-memory persistence and recorded-response provider stubs.

**The recordings are synthetic repository test responses, not production video
captures.** No production-recorded response corpus was available in this checkout.
Eight cases cover product-only, place-only, mixed results, late visual merchandise,
ambiguous/generic names, three provider failures, and duplicate mentions. Global
fetch is blocked in the replay. Expected product and place identities match before
and after in every case; no provider/model request is made.

`PLACES_MILESTONE_2_REPLAY.json` contains all three paired samples for each case,
boundary call counts, first saved result time, and total processing time. Delays
are fixed injected local waits: context 2ms, reasoning 4ms, download 12ms, frames
8ms, media analysis 12ms, product resolution 4ms, place search 24ms. Timings include
local scheduling overhead and do not predict deployed latency.

Median baseline → Milestone 2 measurements:

- Place-only: first place **101.3 → 33.0ms**; total **101.5 → 79.7ms**.
- Mixed, product found at stage 2: first place **74.6 → 34.3ms**; total
  **74.9 → 53.3ms**; first product **52.7 → 52.7ms**.
- Hidden stage-3 merchandise: first place **101.2 → 33.1ms**; total
  **101.5 → 80.6ms**; first product **79.4 → 80.3ms**.
- Three failed place lookups: total **150.6 → 81.0ms**, with three retained leads.
- Duplicate mention: first place **99.5 → 33.4ms**; total **99.8 → 81.6ms**.
- Product-only **11.9 → 12.2ms**, ambiguous **101.1 → 103.0ms**, and generic
  **79.5 → 79.7ms** totals show no meaningful scheduling benefit and small overhead.

Every paired sample has unchanged combined-reasoning, media-analysis, Google Vision
feature, and place-search counts. Combined reasoning remains 1/2/3 by fixture;
place searches remain 0/1/3. Media AI and Vision feature counts are recorded at the
stub boundaries, not measured billing or SDK retry totals. Warm cache adds zero
provider calls. These fixtures establish regression parity, not real-world
precision/recall, source availability, provider p95s, or production cost savings.

## Verification

- 546 relevant JavaScript/TypeScript test cases: **544 pass**, **2 existing failures**,
  no skips. Includes Places/import/content-source/product/manual ingestion, Analytics,
  Android share intent, shared client presentation, auth, Creator flow, source context,
  and the nine replay checks.
- The two existing failures are `ContentSourceService scope` rejecting product-table
  references already in `SupabaseContentSourceRepository.ts`, and `chrome.test.ts`
  expecting old signed-out Stash text. Both tests and their inspected implementation
  files match HEAD byte for byte. They were not changed to conceal failures.
- Client/backend TypeScript checks pass. App lint has zero errors / 23 existing
  warnings; explicit lint of modified/untracked TypeScript has zero errors / 20
  warnings in existing signatures/style and the preserved Creator diff.
- Disposable PostgreSQL: Milestone 1 checks plus 26 Milestone 2 checks pass, including
  concurrent claim/promotion/takeover, both branch writes, rollback injection,
  privacy grants, stale write rejection, source preservation, and idempotent redirects.
  The harness uses actual baseline Places/import/source migrations and minimal
  support-table fixtures for other guarded writes; it is not a full hosted-schema test.
- Six pre-existing Creator Studio diffs remain unchanged. No Analytics source or
  migration, creator orchestrator, embedded player, Android/iOS native configuration,
  application identifier, Expo/EAS configuration, or lockfile was changed here.

## Later deployment gates and remaining risks

1. Review/apply Milestone 1 then Milestone 2 migrations before starting matching
   API/workers. Verify RPC grants, PostgREST schema cache, real foreign keys, and
   request-header propagation in a disposable staging copy of the hosted schema.
2. **Drain/stop all old import workers before starting leased workers.** Headerless
   Creator/API/Analytics writes intentionally remain compatible. Old uninstrumented
   workers have no lease header and cannot be fenced by this protocol. Do not roll
   back to those workers against active new workers; retain schema/guards and use a
   coordinated rollback or forward fix. No rollout has occurred.
3. Run a consented representative real-video corpus after separate provider-call
   approval. Measure product/place identity precision and recall, omissions, source
   availability, canonical mismatches, p50/p95 first-result/total latency, timeouts,
   retry rate, and actual billing. New deadlines may increase retries on slow sources;
   early retained places may include older extraction mistakes. Do not infer product
   absence merely from a venue match.
4. Private provenance backfill cannot reconstruct links discarded before this
   release. Already-started storage uploads may leave isolated orphan objects;
   signed-URL expiry is access expiry, not object deletion. No storage cleanup or
   retention policy was deployed. Existing Cart fan-out remains best effort.
5. Verify Android/iOS partial-result refresh, retry/backoff, timeout, source attribution,
   and account changes on devices during a separately authorized rollout. No builds
   or hosted-device sessions were started here. Places list query batching and visual
   redesign remain outside this milestone.

## Files changed for Milestone 2

- Shared decisions/evidence: `backend/src/stages/{gate,progressiveExtract}.ts`,
  `backend/src/config/pipelineConfig.ts`, `backend/src/content-source/{domain/types,ports}.ts`,
  `backend/src/content-source/processing/{ContentSourceProcessor,videoAdapter}.ts`.
- Ownership/cancellation: `backend/src/user-import/{ImportProgressRepository,workContext}.ts`,
  `backend/src/content-source/jobs/contentSourceWorker.ts`,
  `backend/src/content-source/InMemoryContentSourceRepository.ts`, `backend/src/supabase.ts`.
- Provider transport/deadlines: `backend/src/pipeline/{openaiClient,youtubeContext,instagramContext}.ts`,
  `backend/src/services/tavily.ts`, `backend/src/providers/video/YtDlpVideoProvider.ts`,
  `backend/src/providers/{ocr/GoogleVisionOcrProvider,logo/GoogleVisionLogoProvider}.ts`,
  `backend/src/media/{FrameExtractor,frameStorage}.ts`.
- Persistence/attribution: `backend/src/place/PlaceRepository.ts`,
  `backend/src/place/InMemoryPlaceRepository.ts`, `backend/src/place/SupabasePlaceRepository.ts`,
  `backend/src/place/{PlaceResolver,PlaceService,syncImportPlaces,domain/types}.ts`,
  `supabase/migrations/20261028130000_places_reliability.sql`.
- Compatible client reporting: `backend/src/user-import/UserImportService.ts`,
  `src/types/placeStash.ts`, `src/ui/{stashPlaces,shareActivity}.ts`.
- Verification: `backend/src/place/{PlaceRepository,placesReliability}.test.ts`,
  `backend/src/user-import/{workContext,resultReporting}.test.ts`,
  `src/ui/{stashPlaces,importResultReporting}.test.ts`, `backend/src/place/testing/`,
  `backend/scripts/placesReportingSqlScratch.py`,
  `backend/scripts/sql/places_milestone2_checks.sql`, this document and replay JSON.

Other modified files listed by Git predate this milestone (Milestone 1 and Creator Studio).
