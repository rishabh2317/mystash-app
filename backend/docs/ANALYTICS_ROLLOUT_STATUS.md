# Analytics controlled rollout — 2026-10-28

The user authorized final preparation and controlled rollout of Phases 1–5. The first release keeps optional collection, personalization and reporting disabled; admin access remains unassigned at the user's explicit request. Pilot activation waits for an identified verified test account and Android/iOS acceptance. No paid services, analytics reset, local iOS tooling installation or application identifier changes are authorized by this rollout.

## Verified target and preparation

- Existing repository: `rishabh2317/mystash-app`, integration base `e787627f20eadf837e4f379c73624a6eb6eec5cd`; fetched `origin/develop` matches.
- Supabase: existing `MyStash` project `womdeohfpvzmhomgqwig`, healthy PostgreSQL 17.6. Exactly 45 baseline migration versions match the repository; all six analytics migrations were absent at preflight.
- Existing API: `https://api-dev.mystash.in`, Cloudflare ingress to this Mac's `127.0.0.1:8787`. At preflight no backend/Redis listener was running and the API returned HTTP 502. No deployment host or application identifier was invented.
- Live aggregate preflight: 42 collections, 19 users; existing collection/user mirrors agree with facts/current edges; zero projection drift or negative legacy offsets; 120 missing mirror projections. There are 462 existing facts, zero session-linked facts, and no unknown projection kinds. Existing business totals are 326 collection opens/views, 14 saves, 14 shares, 17 collection-attributed merchant clicks and 7 current follows. These are existing operational counters, not video-playback metrics.
- The backup API lists no available physical restore point/PITR. A free private logical backup was therefore created using PostgreSQL 17 tooling, installed alongside PostgreSQL 14 without starting or replacing a service. The archive covers public/auth/storage metadata and rows, extension-schema references and migration history. Storage object bytes and managed Supabase platform configuration are outside a database dump and are not changed by this release.
- Private archive: `backend/.analytics-release-private/pre-analytics-20261027.dump`, 1,154,649 bytes, SHA-256 `8181c5e37232c64ed23bcab174238e0a697404018e6ea496c63cf0cb9d01eb51`. Directory mode 0700; backup files mode 0600; ignored by Git. Connection secrets are not printed or committed. This is a local recovery copy, not an off-site or PITR guarantee.
- Restore/rehearsal: PostgreSQL 17, private Unix socket, IP egress denied. Restored all selected application schemas/records, role attributes/memberships and database ownership; standard extension prerequisites were bootstrapped. No managed platform scheduler/webhook worker was started. All six migrations, explicit preserving counter preparation, maintenance, creator/admin rollups and service/anon/authenticated privilege checks passed. Existing business table row counts and collection/user mirrors stayed unchanged. This does not simulate the managed PostgREST gateway; live timeout/cache checks remain separate.
- Separate client/backend compiler checks pass. Backend can use the existing matching-lockfile dependencies through an ignored local symlink; no backend dependency installation is needed. Additional nonfunctional lint cleanup removes old array-type errors and an unused theme constant; no runtime design or product behavior changes.

## Release execution protocol

1. Review and checkpoint only analytics/readiness/release files. Leave the six existing Creator Studio changes unstaged; do not ship them incidentally. Backups, credentials, native/build artifacts, bytecode and temporary files remain excluded.
2. Generate `node backend/scripts/analyticsReleaseManifest.cjs` and `node backend/scripts/analyticsReleaseSql.cjs`. The latter only prints an allowlisted transaction and refuses migrations that differ from the checkpoint. It does not deploy anything.
3. Rehearse that exact generated transaction with `analyticsFullSchemaRehearsal.py --release-sql ...` against the private restored archive. A mismatch in baseline history, active transactions, business counts/mirrors, counter parity or projection coverage aborts the transaction.
4. Recheck stopped/drained legacy writers and target linkage. Execute only the six reviewed migrations plus preserving projection/baseline preparation and matching migration-journal inserts in one transaction. No broad `db push`, unrelated migration, whole-database reset or historical analytics purge.
5. Verify live history, privacy grants, zero counter drift/missing coverage and unchanged business totals. Prove scoped statement timeout through an actual service-only PostgREST probe and remove the temporary probe afterwards; stop worker activation if cancellation is not enforced.
6. Build only the Node backend. Restore the existing API using the approved release artifact, with `INGEST_WORKER_EMBEDDED=false` to avoid starting unrelated ingestion/AI/notification jobs. Start `start:worker:analytics` separately after schema/timeout checks, with maintenance enabled and collection/report/profile flags false. Preserve existing environment values and native settings.
7. Verify local/public health, disabled collection, unauthenticated private-route denial, reconciliation and maintenance. Keep admin membership empty. Check logs without exposing credentials or record payloads.
8. Stop before opt-in/client activation until the identified pilot account, Android/iOS/old-client smoke tests, logging/monitoring and capacity gates pass. Do not enroll real accounts automatically or consume paid build/hosting quotas.

## Rollback

Keep collection, personalization and reporting false; keep privacy recovery and bounded retention available. Do not restart a pre-foundation writer or drop the additive schema to roll back. Stop the new API if unsafe and use a compatible forward fix; preserve the private backup and release fingerprints. A database restore, data purge, plan upgrade or public client rollout requires its own concrete recovery/acceptance checks; none is an implicit fallback.

Execution results will be appended only after verification. This document distinguishes prepared commands from actions actually performed.

## Verified execution — schema stage

- Release checkpoint `b5c0b23eabf6edc3cbaff33466017774cee7c59b` is pushed to `origin/codex/cross-platform-development`; the remote hash was verified. The six Creator Studio files remain local and unstaged.
- The exact generated transaction passed the isolated restore rehearsal, including migration-journal writes and the before/after business-data guards, before live execution.
- All six allowlisted migrations and preserving counter initialization committed successfully on the verified project in one transaction. History now contains 51 versions. No unrelated migration, reset or purge was run.
- Independent live verification reports all 238 counter inventory rows covered, zero missing projections/baselines, zero blocking drift, and zero collection/user reconciliation mismatches. Existing counts remain 19 users, 42 collections and 462 facts. Optional-event, consent-preference and interest-profile tables contain zero rows.
- Actual PostgREST enforcement passed: the service-only probe with a 100 ms function statement timeout returned SQLSTATE `57014` after 212 ms, without client abort. The temporary probe was removed. No shared database-role timeout was altered.
- Backend production typecheck/build and client no-emit checks pass. The 194-test release-focused regression pass succeeded after preparation changes. Changed-file lint has no errors or new findings; two pre-existing Home-feed hook warnings remain.
- A constant, aggregate-only maintenance-success log is added for deployment verification. It contains no user, request, event or profile payload. Runtime activation and its acceptance results remain pending below.
