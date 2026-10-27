# Analytics Phase 3 — Creator reporting (local preparation)

Deployment-readiness follow-up: [R1–R7 local fixes and current cutover gates](./ANALYTICS_READINESS_FIXES.md). This supersedes earlier compiler-baseline and maintenance-ordering notes; no production deployment/reset is authorized.

Phase 3 implements creator interaction reporting and its shared iOS/Android screen. No production migration, backend deployment, build, tracking activation, account change or paid service was performed. Stop after this phase. Phases 4–5 and the consolidated deployment checklist remain pending.

## Scope and sources

The new reporting taxonomy contains collection opens/impressions, product impressions, resolved merchant requests, creator profile opens, saves added/removed, followers gained/lost, collection shares and likes added/removed. There is no playback duration, position, completion, skip, replay, playback session, checkpoint, player instrumentation or playback-derived chart. Existing YouTube/Instagram embeds and the Product Page player remain byte-for-byte unchanged.

Optional observations come exclusively from the consent-gated Phase 2 pipeline. Saves, follows, shares and likes come from existing authoritative engagement facts, independently of optional analytics consent. No audience IDs, sessions, private Stash/place activity, raw search text or event properties enter the creator aggregates or API. Existing save/follow/share/like behavior and business records are unchanged.

- Opens count the Phase 2 successfully loaded, session-deduplicated collection route observations; they are not unique viewers or the legacy feed activation counter.
- Impressions retain Phase 2's conservative half-visible-card/one-second rule. They do not establish attention or complete occlusion detection.
- Merchant requests count only `merchant.outbound_resolved`, with validated stored product-tag/collection attribution. Legacy `merchant_click` facts and click tables are deliberately excluded from this metric, preventing two measurements of one destination request. Requests do not prove arrival, purchase or revenue.
- Save/follow additions and removals count committed transitions during the selected period, not current relationship counts. Likes/shares are likewise committed interaction facts. No watch event is inferred from a reel like.
- Current followers and current collection saves use the existing exact engagement summary separately, without applying a date range. That summary covers current nondeleted collections, including those outside the public range-report population.

## Local migration and worker

`20261027140000_creator_analytics.sql` follows the Phase 1 and Phase 2 migrations; none have been applied to the deployed database.

`analytics_creator_daily` stores UTC day/creator/metric/public entity/namespace/collection aggregate counts. Catalog and discovered product identities remain distinct even if UUIDs coincide. Ownership and public published/clear/nondeleted eligibility are checked during aggregation and again on reads. Removed tags are excluded from product attribution; hidden/inactive products are excluded from ranked product metadata. Deleted creators cascade their aggregates. Changing content visibility can change historical report totals; private content is never exposed through these reports.

The existing analytics worker gains a five-minute rollup tick, with independently scheduled hourly source-retention maintenance. A database advisory lock serializes workers, and a contribution ledger deduplicates immutable source event IDs transactionally with aggregate updates. It contains no actor, session, consent receipt or raw properties. First execution backfills retained eligible engagement facts for up to 13 months and currently retained optional events; it does not invent pre-instrumentation measurements. Subsequent scans use indexed server arrival timestamps, a 15-minute overlap, and daily seven-day catch-up for delayed commits. A worker outage catches up from its prior watermark. Database transactions must not remain open beyond the seven-day source/catch-up horizon; future deployment should enforce a short request/statement timeout. Events outside that retention window cannot be recovered from expired raw data.

Daily aggregates and fixed worker-availability samples expire after 13 months. Contribution IDs normally expire after nine days; during an outage the final seven days before the saved watermark remain until catch-up, preventing duplicate counts on resume. This freezes a bounded slice rather than accumulating new contributions while stopped. Aggregate/ledger cleanup also runs through `analytics_maintenance` if rollups are disabled. Phase 2's seven-day raw-event, 24-hour correlation and other privacy retention limits remain intact. Raw expiry still runs after rollup failure; privacy retention takes precedence over preserving a complete historical report.

The private tables/functions deny anon/authenticated role access and have RLS enabled. Only the trusted service role can aggregate or read them. There is no creator raw-event endpoint.

## Reporting contract and coverage

`GET /analytics/creator?days=7|30|90` authenticates a verified Supabase session and derives the creator ID from it. Extra query parameters, arbitrary creator IDs, unsupported ranges, noncreator and deleted accounts are rejected. Responses use `Cache-Control: private, no-store`. RPC/database failures return generic retryable errors without database details.

Ranges contain the last 7, 30 or 90 **complete UTC calendar days**, excluding today, and compare against the immediately preceding equal-length period. Responses include exact half-open start/end dates, refresh timestamps, nullable daily series/totals, coverage, provisional/stale status, and five ranked collections/products. SQL enriches the full ranked result with titles/thumbnails; it does not depend on the most recent 20 collections or a PostgREST row cap.

Coverage is deliberately conservative: one five-minute worker sample records whether optional collection was configured enabled. A full day requires all 288 enabled samples; missed/off samples remain gaps. This is **sampled worker availability, not proof of device delivery, end-to-end ingest uptime, universal consent, or a unique audience denominator**. Worker and API collection flags must agree during eventual rollout. Operational facts can have recorded positive counts even when optional measurement coverage is absent.

Unknown empty days/metrics remain null, including ranked metrics. Positive partial counts are shown as recorded counts with a partial-coverage label. A zero is shown only for a day/period with continuous sampled coverage. Recent counts are provisional for the client late-arrival window. Refresh older than 15 minutes is marked delayed. Percent changes require both complete sampled periods, a fresh rollup, and a positive previous denominator; otherwise comparisons are unavailable. Comparisons remain provisional while recent events arrive. No interpolation fills chart gaps.

Creator reports provide neither CTR nor conversion/unique/returning-audience metrics. Phase 2 does not establish a matched impression-to-click cohort or retain an appropriate unique-audience population. There are no fabricated estimates, revenue values, extrapolated growth or playback signals. These capabilities require an explicit future measurement/privacy decision.

## Shared screen and staging

`app/analytics.tsx` gates the new `CreatorAnalyticsScreen`; the prior screen is preserved in `components/analytics/LegacyAnalyticsScreen.tsx` and remains active by default. No Android/iOS identifiers, Expo/EAS settings, dependency manifests, Creator Studio changes, embedded players or unrelated feature code were changed by this phase.

The new screen uses existing theme tokens, typography, TopBar, cards, images, buttons and skeletons. It has range controls, KPI cards, gap-preserving SVG trends, engagement detail rows, ranked collections/products, separate current totals, and explicit signed-out/access/error/disabled/loading/empty/partial/stale states. Pull-to-refresh retries, request timeouts, aborts and identity/range keys prevent stale account/range results from displaying. Large fonts switch KPI cards to one column; controls have at least 44-point targets. The chart has a text accessibility summary. Existing collection navigation is reused.

New flags are read-only checks and default false:

- `ANALYTICS_CREATOR_REPORTING_ENABLED`: creator read endpoint.
- `ANALYTICS_ROLLUPS_ENABLED`: aggregate worker, independent of raw collection activation.
- `EXPO_PUBLIC_CREATOR_ANALYTICS_ENABLED`: new dashboard, independent of measurement consent/collection.

Existing `ANALYTICS_ENABLED`, `ANALYTICS_MAINTENANCE_ENABLED` and `EXPO_PUBLIC_ANALYTICS_ENABLED` retain their roles. No environment file or EAS/backend setting was edited or enabled. The migration/API/worker/client order, flags, privacy controls, rollback and post-deployment checks will be consolidated after Phase 5. This document is not permission to deploy.

## Cost and scaling assumptions

Phase 2's illustrative 50 observations/DAU/day, excluding playback, gives 50k / 500k / 5m events/day at 1k / 10k / 100k DAU. At an upper bound where all observations plus ten operational actions/DAU/day qualify for creator reporting, the nine-day contribution ledger holds approximately 540k / 5.4m / 54m IDs. At an assumed 160–240 indexed bytes/key that is about 86–130 MB / 0.86–1.30 GB / 8.6–13.0 GB, excluding bloat/WAL/backups. Actual eligible volume should be lower; these are estimates, not benchmarks or free-tier guarantees.

The fast overlap revisits roughly three arrival windows per event, plus one daily seven-day catch-up; this is about ten source-row visits/event under steady state, rather than repeatedly scanning a full day every five minutes. Raw retention remains the larger baseline estimated in Phase 2 (0.21–0.42 / 2.1–4.2 / 21–42 GB). Daily aggregate size depends on active creator/collection/product cardinality rather than audience size: 100 active collections × eight nonempty metric/entity rows/day × 395 days is roughly 316k rows; tenfold/hundredfold content cardinality raises that to 3.16m/31.6m. At roughly 150–300 indexed bytes/aggregate row, this illustration is 47–95 MB / 0.47–0.95 GB / 4.7–9.5 GB. Zero metric/entity combinations are not materialized. Worker samples are fixed at 288/day, about 114k rows over 13 months, independent of DAU.

At 1k DAU, keep one existing worker and indexed SQL rollups; no broker, streaming service or additional analytics vendor is required. Before 10k DAU, measure real eligible/cardinality ratios, query/expiry latency, WAL and database headroom; coalesce low-value impressions at collection time if needed. Before 100k, benchmark day partitioning, batched catch-up/retention and preaggregated reporting dimensions, reduce unnecessary impression volume, and budget database capacity explicitly. Do not assume the present schema will support 100k DAU on a free database or retain every interaction indefinitely. No infrastructure is provisioned here.

## Local verification

The shared scratch runner applies all three local migrations against deterministic fixtures in a disposable PostgreSQL cluster over a local Unix socket. It never reads application credentials or connects to Supabase. Checks cover repeated/concurrent rollups, source namespaces, no legacy-click duplication, backfill, late arrivals/daily catch-up, long-outage deduplication, exact UTC coverage, private/removed attribution, source expiry, aggregate/ledger retention, creator deletion and role permissions. Phase 1 transaction/concurrency/reconciliation SQL checks also pass.

The selected regression suite passes 301 assertions/tests in total: 277 directly, plus 24 in three existing UI files run via temporary CommonJS-compatible copies (`import.meta.dirname` replaced by the same directory literal; assertions unchanged; copies removed). It covers analytics contracts/privacy/queue, reporting/authorization/worker gates/chart math, engagement/shopping/search/notifications, unchanged players, Creator Studio, shared UI, session lifecycle and Android share-target behavior. TypeScript retains 270 existing diagnostics with no new diagnostics. Lint comparison across 71 changed/new TypeScript files found the same five pre-existing issues (two unresolved backend imports and three existing warnings), with no new issues. New Phase 3 files lint cleanly. No native or cloud build, live tracking session, production access, or physical-device validation was performed for this phase.
