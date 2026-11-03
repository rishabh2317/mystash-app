# Isolated Render Free testing

This is a 2–3-person testing environment, not a production availability promise.
Do not change `api-dev.mystash.in`, existing Mac services, consent, migrations or
application identifiers as part of this deployment.

## Build and runtime

- Render Free Web Service, Singapore, Docker build context/root `backend`.
- Dockerfile: `backend/Dockerfile`; same backend lockfile, Node 22, FFmpeg,
  yt-dlp 2026.7.4 (matching the installed local version).
- Docker command: `npm run start:render-free-test`.
- Node old-space cap 192 MiB is not a container memory cap. FFmpeg, Python,
  native allocations and other processes also count against 512 MiB.
- The testing entrypoint opts into `MYSTASH_RENDER_FREE_TEST=true`, embeds the
  existing five queue consumers and serializes heavy creator/user-import
  extraction across those queues. Only this explicit profile adds FFmpeg decoder
  and encoder `-threads 1`; timestamps, dimensions and JPEG quality stay unchanged.
- `NODE_ENV=production` keeps production logging/auth behavior. The existing
  supported testing search selection is `SEARCH_ENV=development`,
  `SEARCH_INDEX_BACKEND=memory`, `EMBEDDING_PROVIDER=local`.
- Search starts empty, is process-local and is lost on restart. Do not claim
  persistent full-catalog search parity.
- Container memory (including media subprocesses), process RSS and sampled peak
  values are logged every 10 seconds. Sample interval is 500 ms; a sampled peak
  can miss a shorter transient. A cloud extraction test is required before acceptance.
- Worker startup requires all five workers to register. SIGTERM closes HTTP and
  drains workers for up to 25 seconds; unfinished work still needs retry/recovery.

## Queue ownership and recovery

- Dedicated Free Key Value: `mystash-free-test-queue`, Singapore, 25 MB,
  50 connections, `noeviction`, persistence Off, external access blocked.
- The test API must use this instance's internal URL. Never use Mac Redis or
  expose Mac Redis publicly. No production or Mac queue is copied or drained.
- `noeviction` avoids silent queue-key eviction but rejects writes when full.
  It does not make queues persistent. A Key Value restart loses all queued,
  delayed, active, completed and failed job records in that test instance.
- If only the API restarts and Redis survives, existing BullMQ stalled-job
  handling and database work fencing handle redelivery; no new jobs are invented.
- If Redis restarts, database records, products, places, saves and drafts remain
  in Supabase. In Activity/Shares use the existing explicit Retry action on the
  original import; it recreates the stable content-source job, including when
  the source is QUEUED/PROCESSING. An ordinary re-share alone is not sufficient
  for those states. Lease expiry can delay a safe retry.
- Creator requests retain the existing same-user/source draft-reuse and stuck
  processing re-enqueue paths (24-hour lookup window). Inspect the original draft
  before retrying, especially after that window; do not automatically create a new
  Collection or mark publication successful.
- Product resolution, AI review and creator-sync continuation jobs are not
  durably journaled by this configuration. They can require their existing
  explicit retry/refresh/sync actions after queue loss. There is no automatic
  global replay or whole-database scan, which could rerun unrelated paid work.
- A single successful import cannot prove durable restart recovery for all five
  queue types. Stop the trial if its recovery behavior is insufficient.

## Analytics, notifications and sleep

The API can retain the existing measurement/reporting/personalization capability
flags without changing any account preference or admin authorization. Reporting
still requires verified sessions; admin membership still comes from Supabase.

Analytics rollups, interest refresh, maintenance and notification background work
keep their existing owners. This entrypoint forces those scheduler flags and push
dispatch off, avoiding competing global jobs on the shared Supabase project.
Existing report snapshots and inbox rows remain readable; continuous rollups,
privacy maintenance and new notification materialization are not provided when
their Mac-hosted owner is offline. Do not describe this as the full always-on
Analytics/notification deployment.

Render Free sleeps after 15 minutes without incoming traffic. All embedded work
stops while asleep; the next real request wakes the service. Do not add synthetic
keepalive traffic. Test wake latency and readiness before submitting work.

## Secrets and acceptance

Runtime credentials belong only in Render environment variables/secret files.
The Docker build context is allowlisted and no secrets are build arguments.
Google Vision's existing credential file, if authorized, must be a Render secret
file referenced through `/etc/secrets/`; its Mac path will not exist in the image.
OAuth callbacks for the existing API domain are not moved by this test deployment.

Acceptance requires: actual cloud health/readiness, real container-memory logs,
one explicitly authorized account/video ingestion, stable identities and results,
sleep/wake observation, and recovery verification. Do not infer a cloud pass from
Mac RSS or a cache hit. No DNS cutover or APK rebuild is part of this trial.

Local screening on 2026-11-01 used fake credentials and synthetic 4K video:
API-only idle approximately 92 MiB; API plus one default decoder approximately
400 MiB; two default decoders approximately 702 MiB. With FFmpeg threading capped,
the sampled aggregate stayed below 200 MiB. These are Mac RSS observations,
exclude full worker/provider overhead and are not Linux cgroup acceptance evidence.

## Deployed trial and observed acceptance — 2026-11-01

- Test API: `https://mystash-free-test.onrender.com`.
- API service `srv-dbjc8rh42hec73cjrscg`; dedicated Free Key Value
  `red-dbjc56mtlv9c73cq81f0`. Both are Free in Singapore; no paid resources or DNS
  changes were made. Redis external access remains blocked.
- Backend release: `4ac9f08576a00544ca0003759f2c8fe849b1b22c` on
  `codex/render-free-test`. Frontend working changes and unapplied migration
  files were excluded from that backend-only checkpoint.
- All five workers registered and Redis-backed readiness returned HTTP 200.
  Idle cgroup memory was about 89 MiB. Sampled peak during the authorized failed
  ingestion was 172,048,384 bytes (164.08 MiB), below 512 MiB.
- The one authorized video (`uRB-DFpjVIU`) was submitted once. Its original import
  and source identities were retained through existing automatic queue retries.
  The source ended FAILED with zero products; product status FAILED, place status
  COMPLETE, evidence_complete false. No manual retry or second ingestion was run.
- Logs locate the failure in Stage 2's yt-dlp download/enrichment path. The stored
  error prefix contains the downloader's age warning and truncates the remaining
  stderr, so the precise underlying download cause is not established. An age
  warning alone is not proof of the cause. This was not a container OOM.
- Authenticated Places, Cart, Creator Analytics, notification inbox, privacy and
  personalization read routes returned 200. The ordinary test account received
  403 on admin reporting. Measurement/activity consent stayed false and unchanged;
  read-only validation sessions were revoked locally after checking.
- The initial operator polling script used an incorrect response envelope; the
  application API correctly returns `{ shares }`. Read-only follow-up confirmed
  the same import's terminal failure, without resubmitting it.
- Local queue-loss regressions passed: an explicit retry restores QUEUED and
  PROCESSING jobs using the same source/import identity. Live Redis data-loss and
  natural idle sleep/wake acceptance remain unverified. No datastore was flushed.

**Reliable extraction acceptance is blocked.** API liveness and low memory do not
establish successful extraction or worst-case media memory use. Further paid
extraction testing stopped at this result. The test URL can be used to inspect
existing data, but must not be presented as a fully verified ingestion service.

The separately authorized `render-test` EAS profile creates an Android APK with
this test URL. It extends the existing analytics-pilot profile, reuses remote
signing credentials and preserves both app identifiers and shared EAS preview
variables. Its flags do not grant admin access or opt anyone into measurement.

## Render Android endpoint correction — 2026-11-02

The first render-test APK (51329c22-1288-46aa-ad14-3dcd8c6ec194,
versionCode 2) was rejected: binary inspection found api-dev.mystash.in and no
Render endpoint, despite the EAS profile override. The exact upstream environment
precedence cause has not been established; native ccache logs do not prove a
Metro cache cause. Do not distribute it as a Render-connected build.

Only render-test enables scripts/renderBuildEnv.cjs in Babel, pinning direct
public backend endpoint reads to the URL in eas.json before Expo environment
inlining. Babel configuration caching is keyed by build profile. Local, preview,
pilot, production, identifiers and server-side secrets are unchanged. Regressions
exercise the real Expo production transform with a stale preview URL. A replacement
APK must pass endpoint and signature inspection before distribution.

Replacement build `84e9d9cd-3915-4675-b762-bb47615ff9f8` completed on
2026-11-02 (Android versionCode 3). Downloaded APK inspection confirmed the Render
HTTPS URL is present, the old api-dev endpoint is absent, package remains
`com.anonymous.Mystash`, and APK signing verification passes with the same
certificate as the preceding EAS APK. Size: 111,584,643 bytes. Server credential
value scan found no matching backend secrets. No device installation was performed.

Verification: four endpoint-transform regressions and 84 focused app tests pass;
changed-file ESLint passes. Client TypeScript retains two pre-existing TS2345
errors in CreatorAnalyticsScreen.tsx:147 and LegacyAnalyticsScreen.tsx:150.
Render readiness was verified over public HTTPS before the build; no additional
extraction or AI/provider requests were made. The previously observed cloud media
download failure, unverified sleep/recovery behavior, and Mac-owned scheduled jobs
remain limitations of the backend trial; this APK endpoint correction does not
resolve them.
