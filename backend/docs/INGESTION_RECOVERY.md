# Creator ingestion and Buy destination recovery

Implemented 2026-10-30 from the recorded Creator ingest diagnostic. This change does not alter prompts, providers, discovery queries, verification thresholds, publication contracts, Analytics flags, or frontend code.

## Correctness changes

- Explicit model matching accepts bounded space/hyphen equivalents such as `Kungfu Pandya` and `Kung Fu Pandya`. Only contiguous alphabetic spans of up to three words qualify, within a single field or URL segment. All requested model tokens still need support. Brand, numeric model, color, type, PDP, and post-enrichment checks remain active. This is not fuzzy matching.
- The recorded Serper fixture contains three SG merchant hits; tracking query parameters were removed. The end-to-end regression uses **synthetic** merchant responses and cannot certify today's live pages. It exercises the existing base/official/Amazon discovery budget and bounded enrichment, an in-place catalog update, the published video-product projection, and Product Page Buy offers.
- Creator workers read the current ingest status before running a delivered job. Completed, published, rejected, or missing ingests do not invoke extraction again. Explicit failed-ingest retry still goes through the existing status reset to `processing`; processing failures remain eligible for BullMQ's existing bounded retries. This guard does not claim globally exactly-once processing of partially completed work.

## Dedicated runtime

`npm --prefix backend run worker:ingestion` (compiled: `npm --prefix backend run start:worker:ingestion`) starts the same five existing ingestion consumers. It does not start Analytics maintenance/reconciliation or notification workers. The existing `worker` command is preserved.

`MYSTASH_INGESTION_ADMISSION_FILE` must point to a private reviewed JSON file:

```json
{
  "version": 1,
  "approvedAt": "<actual review time in ISO 8601>",
  "existingJobs": [{ "queue": "ingest-pipeline", "id": "<reviewed existing job ID>" }]
}
```

The file is operational authorization, not Analytics/user consent. Never commit real job lists or credentials. Before starting any worker, the runtime validates the policy, checks at least 1 GiB free space, checks Redis persistence, and inspects at most 500 pending jobs across its five owned queues. Pre-review jobs require exact queue/job-ID approval. Normal submissions after the reviewed epoch remain eligible across process restarts; malformed timestamps and unreviewed old jobs fail closed. Other queues are untouched. No queue is emptied, unpaused, recreated, or resubmitted.

All five consumers use reconnecting Redis connections, including when HTTP-side Redis is optional. `REDIS_REQUIRED=true` is scoped to the dedicated runtime process; API command clients retain their fail-fast behavior. Redis snapshot/write-protection settings are preserved.

Worker errors are logged; a five-second watchdog detects stopped, unpaused consumer loops. The runtime then drains other active jobs and exits unsuccessfully, allowing the local supervisor to restart it. Intentional signal shutdown drains workers and exits successfully. A reviewed LaunchAgent should use `KeepAlive: { SuccessfulExit: false }`, `ThrottleInterval: 30`, and preserve its original environment and working directory; only the ingestion role gets the new Redis/policy variables.

## Liveness and readiness

`GET /health` retains its existing contract. `GET /ready/ingestion` uses only bounded Redis reads and returns 200 only when Redis persistence is healthy and an ingestion worker connection exists. Otherwise it returns 503 with `redis_unavailable`, `redis_persistence_unhealthy`, or `worker_unavailable`. It does not start workers, reveal job/user IDs, or call providers. Consumer presence is availability evidence, not a guarantee that an individual extraction will succeed.

## Activation and rollback

Local implementation/testing does not update an existing immutable service. A scoped release must overlay only the reviewed ingestion/identity/readiness modules onto the currently deployed artifact. Do not deploy the entire dirty backend: unrelated publication and UI work remains local, including its unapplied migration. Preserve the existing dependency symlink, API/worker Analytics settings, credentials, tunnel, Redis data, and identifiers.

The private release plan should include file hashes, exact reviewed pending jobs, unchanged base files, before/after LaunchAgent definitions, and the previous artifact path. Before switching services, recheck those hashes, worker status, pending jobs, and Redis persistence. Start the API first and the ingestion runtime last. Confirm API liveness and worker readiness, then follow the original job IDs to terminal state. No migrations or client build are required for these backend fixes.

If approved, repair the single diagnosed SG draft through the existing product-resolution worker with one bounded operator job and its existing catalog/video-product IDs. Do not rerun video reasoning, republish the Collection, recreate an ingest, or broadly retry unverified products. Capture the affected records first; verify that Collection/video/catalog associations stay stable and that Product Page offers reflect validated stored destinations. The Noise specificity gate and non-commerce specification sources keep their current behavior.

Rollback restores the old service definitions/artifact. It does not erase completed user work or revert a validated merchant destination. A rollback to the old unsupervised worker entry requires reviewing pending work first; it must not silently bypass that entry's original startup gate.

## Verified local activation and interruption outcome

The scoped local release `28ec9f3c8e1979bbb196` was activated on 2026-10-30 at 06:33 IST. The first macOS API registration failed before workers started; the old API configuration was restored and re-registered. A controlled retry with an unload wait succeeded. The previous release and service definitions remain available for rollback.

The two reviewed Creator jobs completed on their original ingest/Collection identities in approximately 7.3 and 28.4 seconds. Both remained unpublished and became `ready_for_review`. Post-interruption checks found API/public health HTTP 200, ingestion readiness HTTP 200, healthy Redis persistence and no pending ingestion jobs. The Analytics process and settings were preserved. No migrations or native/cloud build were run.

The proposed single-product SG live repair was **declined by the user before the command started**. No repair job or backup was created; read-only checks confirmed that the SG catalog row is unchanged and still has no shopping destination. A private declined marker blocks accidental reuse of the repair helper. Do not retry it without fresh explicit authorization.

A newly processed Fold3 phone query selected an Amazon URL whose path describes a protective case. This is an unresolved merchant-identity/accessory-quality finding, not proof that all completed products have correct Buy destinations. No merchant-page fetch, additional provider call, data rewrite or broader quality change was performed after the interruption. Investigate with recorded candidates and metadata before changing further matching policy.

Verification: 170 focused ingestion, shopping, publication and frontend regression tests passed; backend/client TypeScript passed; lint had zero errors and the same 23 existing warnings. Live availability and completed queue work are distinct from full merchant-match quality validation.
