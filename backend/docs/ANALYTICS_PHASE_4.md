# Analytics Phase 4 — Admin dashboards and product intelligence

Deployment-readiness follow-up: [R1–R7 local fixes and current cutover gates](./ANALYTICS_READINESS_FIXES.md). This supersedes earlier compiler-baseline and maintenance-ordering notes; no production deployment/reset is authorized.

Completed as local preparation only. Phase 5 and the consolidated deployment checklist remain pending. No deployed migrations, services, tracking flags, account grants, native/cloud builds, dependency installations or paid services were initiated. Phase 4 does not change discovery ranking, recommendations, product resolution, ingestion, publishing, authentication, existing navigation or embedded video playback.

## Scope and measurable signals

A separate `/admin-analytics` shared React Native screen presents restricted operational/business reporting through `GET /analytics/admin?days=7|30|90`. It is not added to public navigation or the creator dashboard. It uses the existing TopBar, theme tokens, typography, cards, buttons, skeletons and SVG infrastructure on Android/iOS. Its frontend, read API and aggregate worker each default off independently.

All measurements reuse Phase 2's accepted, consent-gated event stream or existing authoritative business records. No new client events, ingestion hooks, player scripts, third-party SDKs, behavioral identity store or recommendation changes are introduced. The taxonomy excludes all video playback duration, position, completion, skip, replay, playback sessions/checkpoints and derived metrics.

The dashboard includes range KPIs and trends, search quality, bounded category/filter/platform breakdowns, saves/follows/likes/shares, place-card/destination activity, resolved merchant/affiliate destination requests, opted-in active-account counts, current business inventory, ingestion/extraction cohorts, measurement health and counter reconciliation. Loading, signed-out, denied, disabled, retryable error, empty, delayed, partial and unknown states remain explicit. The chart preserves missing days as gaps and provides a text accessibility summary. Date-range/account keys and aborts prevent stale request results from appearing after account/range changes; foregrounding clears the in-memory report and rechecks access. No report is persisted on the device. Large-font KPI layouts become one column.

## Sources and metric dictionary

Optional event counts are idempotent accepted observations, not unique people or proof of attention:

- `app_sessions`: `session.started`; app-session starts only, never playback sessions or DAU.
- `collection_opens`, `collection_impressions`, `product_opens`, `product_impressions`, `place_impressions`, `place_outbound_requests`, `profile_opens`: corresponding Phase 2 events. Private-place signals contribute only aggregate counts, without IDs, names, locations or destinations. The one-second/half-visible-card impression definition is unchanged.
- `search_responses`: `search.results_served` for measured typed first-page responses. Zero-match share is `search_zero_matches / search_responses`; a response with no matching result remains zero-match even if fallback results were returned. Fallback share is `search_with_fallback / search_responses`. Both rates describe the recorded response population, including partial periods, not all search traffic.
- `search_matching_results` and `search_fallback_results`: sums of their separate response counts. `search_latency_ms / search_responses` gives mean response latency, with the existing 120-second event cap. No percentile is inferred from a sum.
- `search_clicks`: validated result-click observations. `search_click_rank_sum / search_clicks` gives mean one-based rank; the server-validated zero-based rank is incremented by one. Clicks/responses are not used to fabricate a matched click-through funnel.
- `merchant_requests` and `affiliate_requests`: server-only `merchant.outbound_resolved`; affiliate requests are the boolean affiliate subset of the same events. Legacy merchant facts/click rows are excluded to prevent double counting. Neither measure confirms merchant arrival, purchase, revenue or payout.
- `saves_added`, `saves_removed`, `follows_added`, `follows_removed`, `likes_added`, `likes_removed`, `collection_shares`: committed collection-save, creator-follow, reel-like and collection-share facts. Legacy view/completion/rewatch facts are not aggregated. Operational business facts do not depend on optional analytics consent; no actor context is copied into summaries.

All-event totals are kept separate from their breakdowns. Platform labels are the existing client-supplied ios/android/web/server values, not verified device counts. Only the existing ten canonical catalog categories plus `other` are retained. Discovered products and noncanonical/missing categories use `other`; there are no free-text category/brand/merchant keys, product names or private discovered-product metadata. Filter adoption uses the eight existing allowed filter-key names, not filter values or search queries; repeated keys within a response are deduplicated. Categories rank by merchant requests then product opens. No user-level interest inference is performed in this phase.

The report also separates these sources:

- **Current business records:** nondeleted profile rows, active creator profiles, public/clear/published collections, nonhidden catalog products, active discovered products, canonical places, Bag membership rows and place-save rows. Counts are server-side SQL aggregates without the PostgREST 1,000-row limit. Membership counts are not unique users or historical save events. Profile creation is not asserted to be an auth signup or activation.
- **Range business cohorts:** profiles created and currently public collections with publish timestamps in the selected complete UTC interval; distinct creators of those collections; user imports submitted and those currently marked timed out. Deleted/removed records do not contribute. These are current records filtered by timestamps, not an immutable history of publishing/onboarding transitions.
- **Ingestion cohorts:** current status of `content_sources` and `ingest_requests` created in the selected interval, with unexpected statuses collapsed to OTHER/other. Shared imports and globally deduplicated sources have different units. The terminal source failure share is `FAILED / (READY + FAILED)`; in-flight/other states are excluded. Retries can change these cohort counts. Open sources older than 15 minutes are a current backlog count, not an SLA violation or failed-job count.
- **Extraction coverage:** sources READY with/without product candidates; candidate rows attached to source-cohort IDs; bound catalog/discovered candidate rows divided by all product candidate rows; resolved place candidates divided by all place candidates. Binding/resolution is not accuracy or correctness. No extracted names, evidence, provider payloads, failure text, addresses or source URLs leave SQL.
- **Measurement health:** Phase 2's newly accepted, duplicate and invalid/ineligible event outcomes; best-effort buffered rejected-payload batches, rate-limited events and failed-write batches. Event and batch units stay explicit; no mixed-denominator error/delivery rate is fabricated. Latest retained Phase 1 reconciliation exposes only its timestamp and two mismatch counts.

Ratios with no denominator are unavailable. Unsafe, negative or inconsistent aggregate populations fail closed rather than produce misleading percentages. Date-range growth requires fresh aggregates, two fully sampled equal-duration periods and a positive prior denominator.

## Activity population and unsupported capabilities

The live activity subquery counts distinct currently ACTIVE accounts with current measurement + activity sharing enabled and retained optional events received in the last 24 hours/seven days. It excludes anonymous and aggregate-only events, missing/revoked preferences and deleted/suspended accounts. It uses **server receipt time**, not an inferred continuous user session. Identity is never returned or retained by this phase. Clearing 24-hour session/consent-revision correlation does not accidentally exclude still-valid seven-day actor linkage; withdrawal/deletion clears that linkage and immediately changes the next report.

The UI labels these as **opted-in active accounts**, with sampled coverage, rather than population DAU/WAU. A positive count can be shown with partial coverage; an empty interval stays unknown unless sampled coverage is continuous and fresh. This subset cannot establish population user counts. There is no 30-day activity identity history, so MAU, returning-user retention/cohorts and activation/onboarding funnels remain explicitly unavailable. Purchases/revenue/conversion, matched CTR, extraction accuracy and provider cost are likewise unavailable without verified sources. No additional identity retention or invented estimates were introduced to fill these gaps. Product revisit/personality inference remains outside Phase 4.

## Local schema, batching, retention and cost

`20261027150000_admin_analytics.sql` follows the three previously prepared analytics migrations; none have been applied to the deployed database.

New private tables:

- `analytics_admin_daily`: UTC day, one of 25 fixed metrics, one finite dimension and a numeric value. Contains no entity/user/session/query/URL fields.
- `analytics_admin_contributions`: source namespace + immutable event ID + processing timestamp, transactionally deduplicated with summary updates. These are private technical event keys, potentially joinable to their source while retained; they are not an exposed audience dataset.
- `analytics_admin_rollup_state` and `analytics_admin_windows`: one watermark row and fixed five-minute availability samples. Like Phase 3, 288 enabled samples qualify a complete UTC day; this is worker configuration/availability sampling, not proof of device delivery or ingestion uptime. Missing/off windows remain gaps. Worker/API collection flags must agree at eventual rollout.
- `analytics_admin_members` and `analytics_admin_access_log`: explicit grants and minimal successful-read audit records, described below.

The existing worker performs five-minute admin rollups alongside independently scheduled hourly privacy maintenance when separately enabled. Advisory locking and the event-key ledger make repeats/concurrent workers idempotent. First execution reads available source data and up to 13 months of eligible engagement facts. Later scans use indexed server arrival timestamps, a 15-minute overlap, and daily seven-day catch-up. Long-outage recovery begins at the saved watermark; expired raw events cannot be reconstructed. As in Phase 3, database request transactions must finish within the source/catch-up horizon; enforce short request/statement timeouts during eventual deployment.

Daily aggregates and availability samples expire after 13 months. Dedupe keys normally expire after nine days; if stopped, the final seven-day overlap before the saved watermark is preserved until catch-up to avoid re-adding old contributions. Cleanup runs through the existing maintenance RPC even if admin rollups are off. Raw-event, session/search correlation, optional actor and health retention from Phase 2 is unchanged. Privacy maintenance still runs after a rollup error. No raw payload retention is extended.

For 1k / 10k / 100k DAU, using Phase 2's 50 observations and an upper-bound ten eligible operational actions/DAU/day, admin rollups add at most roughly 60k / 600k / 6m candidate events/day. Nine days of event keys gives 540k / 5.4m / 54m keys: at an estimated 160–240 indexed bytes/key, about 86–130 MB / 0.86–1.30 GB / 8.6–13.0 GB, excluding bloat, WAL and backups. This is **additional** to the creator ledger/raw-storage estimates, not a free-tier guarantee. Real eligible volume must be measured.

The global summary is bounded by 25 metrics × at most 24 dimensions × approximately 395 retained days, or 237k rows as a conservative ceiling (many metric/dimension combinations never occur). At an assumed 150–300 indexed bytes/row that is roughly 36–71 MB, independent of audience/entity cardinality. Availability samples are approximately 114k rows. Fast overlap plus daily catch-up visits roughly ten source windows per event in steady state; it does not rescan a full day every five minutes. Cohort timestamp indexes support range predicates. Existing source-candidate indexes support aggregate joins.

The largest range RPC returns at most 4,500 all-dimension daily rows plus finite range-aggregated breakdowns, coverage and health rows. It does not return every dimension's daily history. The app receives only 90 chart points, bounded breakdowns and scalar counts. Report generation is limited to twelve reads/minute/admin/process using bounded, short-lived HMAC keys; authorization is rechecked on every request. Live inventory and seven-day distinct-account scans remain the principal read cost. At 1k DAU, reuse the existing database/worker with no broker or new vendor. Before 10k, benchmark actual report plans/cardinality/WAL and consider short-lived server-side snapshot caching behind fresh authorization. Before 100k, benchmark partitioned source/ledger retention, batched catch-up and precomputed inventory/consented activity summaries, or reduce low-value impressions. Per-process limits need trusted edge/distributed enforcement for many replicas. No such infrastructure is provisioned now.

## Access control and rollout prerequisites

Every new table has RLS and denies PUBLIC/anon/authenticated grants. New RPCs are service-role-only. HTTP requires the existing verified Supabase user, then `analytics_admin_authorized` checks an enabled membership and an ACTIVE, nondeleted profile. `analytics_admin_report` checks membership again in the same database operation that reads aggregates, catching revocation between the preflight and report. Caller-supplied identities/roles, extra query keys and unbounded ranges are rejected/ignored as appropriate; authorization never uses editable user metadata or a public environment variable. Responses are private/no-store; database errors are generic.

Membership starts **empty**. No existing creator, personal Expo owner, account or test fixture is promoted in the real project. Before an eventual coordinated deployment, the operator must separately approve and provision the verified internal user ID through trusted database administration. There is no HTTP self-enrollment, grant management, raw export or audience drill-down endpoint. Client flags only control visibility and grant no access.

Successful reads log admin ID, timestamp and range days, without IPs, tokens, queries or payloads. Logs expire after 30 days. Soft deletion removes the analytics membership and unlinks audit identity; restoring an account does not silently restore the grant. Hard deletion cascades membership and nulls audit identity. Anonymous global summaries remain anonymous counts after consent withdrawal/account deletion; no identity-bearing interest profile is created here.

New flags default false and no environment/EAS/backend setting was changed:

- `ANALYTICS_ADMIN_ROLLUPS_ENABLED`: admin aggregates in the existing worker.
- `ANALYTICS_ADMIN_REPORTING_ENABLED`: protected admin read endpoint.
- `EXPO_PUBLIC_ADMIN_ANALYTICS_ENABLED`: internal shared dashboard route.

Existing analytics, creator-reporting and maintenance flags remain untouched. Provisioning, coordinated migration/backend/worker/client order, flags, privacy checks, rollback and post-deployment validation will be consolidated **after Phase 5**, not initiated here.

## Verification

The disposable local PostgreSQL suite applies all four prepared migrations and passes Phase 2–4 checks for consent/withdrawal, creator isolation, admin default denial/revocation/suspension, role grants/RLS, access-log erasure, search denominators/filter deduplication, legacy-click exclusion, finite category dimensions, private-data exclusion, source cohorts, late commits, long-outage/concurrent idempotency, expiry and historical coverage gaps. The separate Phase 1 SQL regression suite passes transaction/retry/rollback/concurrency/reconciliation/deletion checks.

The selected unit/regression suite passes 334 tests in total: 310 directly, including 24 Phase 4 tests plus nine existing authentication checks, and 24 assertions from three unchanged UI files through temporary CommonJS-compatible test copies. Only `import.meta.dirname` is substituted with the same literal directory for the existing loader limitation; assertions remain unchanged and copies are removed. New tests cover report math/UTC ranges/unknowns, authorization/client claim rejection/revocation races/rate limits, sensitive output exclusion and worker staging/maintenance order.

TypeScript retains 270 pre-existing diagnostics with no new diagnostics. Lint across 81 changed/new TypeScript files retains the same five pre-existing issues (two unresolved backend imports and three warnings), with no new issues. All protected player source and the Product Page player match their original Git source exactly. Existing Creator Studio changes and iOS/Android identifiers, Expo/EAS settings and dependency manifests remain preserved. No device/native or live production UI verification was performed; flags remain disabled.

Phase 4 file groups: new admin migration, report contract/calculation/API/tests, shared internal route/dashboard and API client/presentation labels, SQL fixtures/checks; small analytics route-registration and existing-worker extensions. Phases 1–3 functionality remains intact. Stop here; Phase 5 is not started.
