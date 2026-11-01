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
