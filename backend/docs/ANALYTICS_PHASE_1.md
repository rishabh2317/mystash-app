# Analytics Phase 1: correctness foundations

Deployment-readiness follow-up: [R1–R7 local fixes and current cutover gates](./ANALYTICS_READINESS_FIXES.md). This supersedes earlier compiler-baseline and maintenance-ordering notes; no production deployment/reset is authorized.

## Status and boundaries

Repository implementation only. The migration has not been applied to hosted Supabase and the backend has not been deployed. No new watch/search/impression instrumentation, interest profiling, native builds, external services, or historical counter repairs are included.

The read-only deployed audit found 45 matching migration versions, 462 engagement facts, no inspected counter drift, no session-linked facts, and no measured watch events. The existing six-file Creator Studio redesign is separate work and must be preserved.

## Write contract

Production `createEngagementService` uses `AtomicEngagementService`. `engagement_commit(jsonb)` is a service-role-only, invoker-security RPC. It validates targets, derives collection ownership, validates product attribution, serializes conflicting operations, and commits the fact, relationship transition, counter arithmetic, and authoritative collection/user mirrors together. The old application-side write sequence remains only as the injectable in-memory domain implementation; the production factory never falls back to it.

Event IDs are immutable interaction identities. Retries reuse their original ID. Reuse for a different actor, action, target, product, tag, or supplied merchant collection returns HTTP 409. A retry does not replay an old relationship transition. A new request that leaves membership unchanged emits no fact or counter delta. Views return the actual `inserted` acknowledgement. Deadlock/serialization failures get at most two bounded retries with the same event ID; other errors are not automatically retried. Missing migration/RPC fails closed; database details are not returned for internal failures.

Notifications retain their fact-based idempotency keys and are attempted after commit, including on retried deliveries. This preserves the existing best-effort notification contract; this phase does not claim a transactional notification outbox across engagement and notification domains. Search ranking mirrors remain best-effort, derived nearline data, not analytics truth.

## Privacy and deletion

Raw facts, relationships, projections, legacy click records, and place memberships lose unnecessary anon/authenticated grants while retaining service-role access. Existing client cart/import policies are unchanged.

Both a user soft-delete transition and auth hard deletion invoke actor erasure. It removes actor/anonymous/session linkage and arbitrary metadata from that actor's engagement facts, removes their relationship edges, reconciles affected current save/follower stocks, and clears legacy click account linkage. A constrained erasure marker permits the actorless historical facts to preserve content totals. This is deidentification, not a claim that all remaining content references are irreversibly anonymous. Restoration does not restore erased engagement activity. Other domains retain their own deletion policies.

New legacy click records share a unique event ID with engagement facts, making same-ID retries idempotent and prospective reconciliation possible. Historical rows remain unlinked. Legacy and engagement attribution both derive ownership and product membership from stored relationships; unverified legacy attribution is discarded without blocking navigation.

New merchant facts/logs store a host and allowlisted provider context; new legacy analytics rows retain the merchant origin rather than full destination paths/queries. Actual merchant navigation uses the original resolved URL. Existing historical destination URLs are not rewritten by this migration. Engagement operational logs omit actor and anonymous identifiers.

## Reporting definitions and API

`GET /engagement/me/analytics` still requires a verified account, additionally enforces creator eligibility on the server, and uses `engagement_creator_summary(uuid)` with the authenticated account ID only.

The existing totals and collection row fields remain compatible. Added metadata: `definition_version`, `scope=current_non_deleted_collections`, `generated_at`, `collections_total`, `collections_limit=100`. Exact totals cover every owned non-deleted collection; the collection payload contains the top 100 ranked by views, clicks, saves, shares, then ID. This removes default REST row-cap truncation and bounds the payload while preserving the screen's top-five ranking. This is not a historical time-series API.

- Recorded views: existing feed activations/detail opens; not watch time or unique viewers.
- Current followers/saves: active relationship stocks, not cumulative acquisitions.
- Shares: platform-reported share actions, not confirmed delivery.
- Outbound clicks: resolved merchant destination requests, not confirmed navigation or purchase.
- Scope includes current non-deleted collections; deleted content can change totals. No claim of immutable all-time totals.

## Reconciliation and rollout

`engagement_reconcile()` is read-only and reports collection and user mirror discrepancies without user records. `engagement_check_and_record()` records aggregate-only diagnostics, coordinates replicas through a database advisory lock and one-hour gate, and retains diagnostic runs for 30 days. The existing backend worker invokes it on startup and hourly. Failures are logged without stopping ingestion workers; nonzero mismatches generate warnings. It never repairs counters automatically.

Deployment order:

1. Review this migration and local verification. Confirm a recoverable database backup and reconcile deployed counters read-only.
2. Pause/drain engagement writes during coordinated rollout; do not run mixed old/new writers as a correctness guarantee.
3. Apply `20261027120000_engagement_atomic_foundations.sql`, then deploy the backend/worker. Deploy frontend copy independently afterward.
4. Verify service-role RPC access, denied client access, duplicate acknowledgements, unchanged Android/iOS save/follow/like flows, and a persisted reconciliation report. Use test accounts for any authorized production smoke writes.
5. Monitor reconciliation warnings and RPC error rates. Do not auto-repair drift. On rollback, keep additive schema and privacy protections; do not drop functions while new backend instances may still call them.

No production migration, test-account mutation, repair, or deployment is performed as part of local implementation.

## Verification

`bash backend/scripts/engagementSqlScratch.sh` uses installed Postgres tools, a temporary Unix-socket-only cluster, and deterministic schema fixtures plus the engagement/reel migrations. It never loads application credentials. It tests migration reapplication, rollback after a mirror failure, retry collisions, concurrent views/saves, no-op transitions, stale save retries, ownership/tag checks, privacy minimization, >1,000 collection summaries, service-role permissions, reconciliation, and soft/hard deletion. It is not a replay of the complete legacy migration history.

Run the engagement adapter/domain tests, creator analytics presentation tests, relevant user/notification/shopping regressions, TypeScript baseline comparison, lint, and `git diff --check`. Existing unrelated compiler/lint failures must be reported separately; do not install packages merely to mask this worktree's missing backend dependencies.

Verified locally: 122 relevant regression tests passed; disposable SQL checks passed, including concurrent writes and transaction rollback; all 15 Phase 1 TypeScript files passed lint; the repository still has 270 pre-existing TypeScript diagnostics, with no new diagnostics identified. A broader regression run found the existing `chrome.test.ts` Stash sign-in copy assertion mismatch; neither that test nor its source copy was changed. `git diff --check` passed. No native or cloud builds ran.
