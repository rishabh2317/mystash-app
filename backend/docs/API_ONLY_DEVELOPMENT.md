# API-only local development

Use this mode alongside the existing supervised API on 8787 and its separately
owned ingestion, Analytics and Redis processes:

```sh
cd /Users/rishabh/.codex/worktrees/0eb0/Mystash/backend
PORT=8788 npm run dev:api-only
```

Node 22 (already installed) watches source changes. For a stable process without
watching, including the audit smoke test:

```sh
PORT=8788 npm run dev:api-only -- --no-watch
```

Do not launch a second copy if 8788 is already occupied. The launcher does not
kill processes, manage LaunchAgents or choose a different port automatically.
It refuses port 8787. An explicit different port, such as 8789, is allowed.

## Process-local overrides

`scripts/devApiOnly.cjs` supplies these before importing the API and loading
dotenv. No environment file, LaunchAgent or production configuration is edited.

- `PORT=8788` by default; explicit `PORT` overrides this default.
- `NODE_ENV=development`.
- `INGEST_WORKER_EMBEDDED=false`.
- `ANALYTICS_ENABLED=false` (also suppresses the API diagnostics flush timer).
- `ANALYTICS_MAINTENANCE_ENABLED=false`.
- `ANALYTICS_ROLLUPS_ENABLED=false`.
- `ANALYTICS_ADMIN_ROLLUPS_ENABLED=false`.
- `ANALYTICS_INTEREST_WORKER_ENABLED=false`.
- `NOTIFICATIONS_PUSH_ENABLED=false`.
- `SEARCH_ENV=development`, `SEARCH_INDEX_BACKEND=memory`, `EMBEDDING_PROVIDER=local`.
- Inherited `DOTENV_CONFIG_OVERRIDE` is removed so dotenv cannot replace these
  overrides. With the installed dotenv version, even the string `false` is truthy.

Existing Supabase, Redis and other API credentials are inherited or loaded from
the backend `.env` without printing their values. Analytics collection is off
only in this development process; the existing supervised pilot is unaffected.

## Startup audit: ownership and flags

`src/index.ts` has one umbrella gate: embedded work starts unless
`INGEST_WORKER_EMBEDDED` is **exactly** `false`. `PORT=8788 npm run dev` alone
does not turn any worker off. Within the gate:

- `workers/ingestPipelineWorker.ts`: `ingest-pipeline`, concurrency 2.
- `product-intelligence/jobs/productResolveQueue.ts`: `product-resolve`, concurrency 2.
- `ai-review/jobs/productAiReviewQueue.ts`: `product-ai-review`, concurrency 1.
- `content-source/jobs/contentSourceWorker.ts`: `content-source-processing`, concurrency 2.
- `creator-library/jobs/librarySyncWorker.ts`: `creator-library-sync`, concurrency 2.
- In non-production, `notifications/jobs/startNotificationWorker.ts` starts the
  Postgres outbox materializer, campaign fan-out, sweep, retention pruning and
  privacy purge-retry jobs. These have no individual API startup switches.
  `NOTIFICATIONS_PUSH_ENABLED=true` additionally starts push dispatch and receipt
  polling and requires an Expo access token. Turning push off alone does **not**
  turn the materializer or maintenance off.

`REDIS_URL` selects the shared queues (default `redis://127.0.0.1:6379`).
`REDIS_REQUIRED=true` changes connection/retry and availability behavior; it is
not a worker-disable flag. Redis unavailability can skip some embedded consumers
but does not prevent the dev notification worker from starting.

Outside the umbrella gate, `analytics/routes.ts` starts a 60-second diagnostics
flush timer when `ANALYTICS_ENABLED=true`. This is why this preset also disables
measurement. The rollup/maintenance/interest flags govern `analytics/worker.ts`
in separate worker entrypoints, not the API entrypoint. They are forced off here
defensively. This mode never invokes `worker.ts`, `ingestionWorker.ts`,
`analyticsWorker.ts` or `notificationWorker.ts`.

API-only describes **startup ownership**, not a read-only HTTP sandbox. Existing
authenticated mutation endpoints can still enqueue work to supervised workers.
In particular, the existing creator `/ingest` route retains request-driven inline
processing, including an enqueue-error fallback, regardless of `INGEST_WORKER_EMBEDDED`. Do not
submit extraction requests during a read-only startup check. This behavior was
preserved rather than changing ingestion contracts.

## OpenSearch findings (2026-10-31)

The local `.env` selects `opensearch` at `127.0.0.1:9200`, but nothing listens
there. Docker cannot connect to its configured Colima daemon socket, so container
state and any previous container exit cause cannot currently be established.
No daemon, container or native tooling was started during this audit.

`docker-compose.search.yml` describes optional OpenSearch 2.19.0 with a 512 MiB
JVM heap and persistent volume. The existing supported zero-infrastructure
alternative is `search/factory.ts`'s explicit development in-memory index plus
local feature-hash embeddings. This preset uses that alternative and does not
contact OpenSearch, create indexes or request paid embeddings.

The memory index starts empty, is process-local, and disappears on restart; it
does not automatically load the existing Supabase catalog or share the 8787
index. An empty autocomplete result is expected. Use OpenSearch separately when
persistent catalog-search parity is required. Production still rejects memory
mode; no production fallback was added.

## Notification-materializer lag findings (2026-10-31)

Notifications use Postgres, not Redis. `notification.materializer.lag_boost`
means the oldest due outbox event's **creation** age exceeds 120 seconds. It
selects batch 500/concurrency 32 instead of batch 100/concurrency 8. It is a
catch-up warning, not evidence of a Redis failure or failed materialization.

Read-only `notification_health_snapshot` and outbox SELECT/count queries found:

- Due events 0, pending 0, claimed 0, dead 0; processed 14.
- No overdue push receipts, stuck sending deliveries or due push backlog.
- Those 14 processed events had 14 total claims and 0 recorded failures.
- Maximum historical created-to-processed delay was 282,154 seconds (3.27 days).
- Latest processed timestamp was `2026-10-31T17:05:40.762695Z`, before this audit's
  API-only startup. This audit did not claim or process notifications.

The configured Mystash LaunchAgents cover API, ingestion, Analytics and Redis;
none owns notifications. Their API is production with embedded workers disabled,
and the dedicated ingestion role does not start notifications. This is an
ownership gap that can leave notifications waiting until an unrelated dev API
starts its embedded materializer. It is consistent with the historical delay;
the precise historical outage interval is not proven by these snapshots.

A separately supervised notification worker is the supported future fix for
persistent delivery. It requires an explicit operational change; none was
created, started or restarted in this audit. Current zero backlog is not proof
of a continuously running materializer.

## Validation and operational limits

- Backend TypeScript and targeted script lint passed. All 48 focused regressions
  passed: five preset, seven search-factory, nine ingestion-runtime and 27
  in-memory notification tests. The notification health-server test required
  localhost socket permission outside the sandbox; it did not access live data.
- Live API-only startup on 8788 logged memory search/local embeddings and no
  embedded workers. Before readiness probing, its only TCP socket was its HTTP
  listener. Redis blocked-consumer count remained 5 before/after startup.
- `/health`, `/analytics/config` (disabled), `/search/autocomplete?q=test` and
  `/ready/ingestion` returned 200. Readiness initially returned 503 on the shared
  lazy command client's first connection, then passed on subsequent checks.
  Liveness and worker readiness are distinct; a fresh first-probe transient is
  existing behavior in `workers/redisConnection.ts` and `ingestionRuntime.ts`.
- Supervised 8787 health/readiness also passed. Redis queue counts were unchanged:
  no waiting, active, paused, delayed or failed jobs across the five queues.
- No jobs were claimed, retried, deleted or drained; no migration, backfill,
  build, AI call, Redis flush or LaunchAgent mutation was performed.

Repeat focused checks without starting workers:

```sh
node --test scripts/devApiOnly.test.cjs
npm run typecheck
curl --fail http://127.0.0.1:8788/health
curl --fail http://127.0.0.1:8788/ready/ingestion
```
