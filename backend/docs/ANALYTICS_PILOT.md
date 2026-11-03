# Development/pilot Analytics activation

Activated and verified on 2026-10-28 against the existing development API and Supabase project. This enables infrastructure capabilities, **not user consent**.

## One configuration

`backend/config/analytics-pilot.json` is the reviewed preset. Use the existing npm command:

```sh
npm run analytics:pilot -- status
npm run analytics:pilot -- plan --test-account <authorized-test-email> --admin-account <authorized-admin-email>
npm run analytics:pilot -- activate --test-account <authorized-test-email> --admin-account <authorized-admin-email>
npm run analytics:pilot -- validate
```

`plan`/`audit` read deployed dependencies and the explicitly identified existing accounts. `activate` verifies the linked target, six Analytics migrations, required RPC signatures, private table grants/RLS, seven worker RPC deadline configurations, account eligibility and counter drift. It refuses unexpected active admins. Missing counter projections can be initialized only through the already-deployed preserving initializer, with an in-transaction guard that business counter mirrors do not change.

Activation updates only the Analytics environment dictionary on the two existing Mac LaunchAgents and restarts those services using their **existing immutable code artifacts**. It does not deploy the working tree, compile backend code, apply migrations, start ingestion jobs, change database-role defaults or install anything. Runtime paths, ports, credential directories, non-Analytics environment values and ingestion settings remain unchanged. Failed activation restores the prior service configuration and removes a newly granted admin membership.

The four client capability flags are set locally in ignored `.env.local`, preserving its existing values. The dedicated `analytics-pilot` EAS profile extends the existing internal `preview` profile and uses the existing preview environment. `load_preset` verifies its four flags match the preset. Existing preview/production build profiles and both application identifiers remain unchanged. Required preview variable names and the existing API URL were checked through the cached EAS CLI, with values kept inside the process.

No user identifiers, emails, tokens, environment secrets or test sessions are committed. Authorized account mapping, private preflight/evidence and rollback flag snapshots live under the Git-ignored, owner-only `backend/.analytics-release-private/pilot-20261028/` directory.

## Final role-specific flags

API ON:

- `ANALYTICS_ENABLED`
- `ANALYTICS_CREATOR_REPORTING_ENABLED`
- `ANALYTICS_ADMIN_REPORTING_ENABLED`
- `ANALYTICS_PERSONALIZATION_ENABLED`

API OFF: `ANALYTICS_INTEREST_WORKER_ENABLED`, `ANALYTICS_ROLLUPS_ENABLED`, `ANALYTICS_ADMIN_ROLLUPS_ENABLED`, `ANALYTICS_MAINTENANCE_ENABLED`. Those jobs have one owner: the dedicated worker.

Worker ON: `ANALYTICS_ENABLED`, `ANALYTICS_PERSONALIZATION_ENABLED`, `ANALYTICS_INTEREST_WORKER_ENABLED`, `ANALYTICS_ROLLUPS_ENABLED`, `ANALYTICS_ADMIN_ROLLUPS_ENABLED`, `ANALYTICS_MAINTENANCE_ENABLED`.

Worker OFF: `ANALYTICS_CREATOR_REPORTING_ENABLED`, `ANALYTICS_ADMIN_REPORTING_ENABLED`; the worker has no HTTP reporting interface. Its collection flag matches the API so coverage samples describe the enabled collection interval.

Prepared client flags ON: `EXPO_PUBLIC_ANALYTICS_ENABLED`, `EXPO_PUBLIC_CREATOR_ANALYTICS_ENABLED`, `EXPO_PUBLIC_ADMIN_ANALYTICS_ENABLED`, `EXPO_PUBLIC_PERSONALIZATION_ENABLED`. These are capability switches and do not establish permission to collect data or view admin reports. The already-installed APK retains its original disabled build-time flags.

## Privacy and authorization

- Anonymous aggregate measurement still requires an explicit device consent receipt. Authenticated measurement still requires a current server revision and the matching device receipt. Account-linked activity remains a separate choice.
- Interest profiling requires its own fresh, policy-versioned opt-in **in addition to** usage and account-activity measurement. The initializer does not create preference rows, mark consent true, enroll accounts, backfill profiles or change recommendation ranking.
- Only the explicitly designated admin account was granted an enabled `analytics_admin_members` row. Its existing account is verified and active. Creator access remains self-scoped; the ordinary test creator is denied admin reporting. No creator status or JWT role was elevated.
- Withdrawal, reset/deletion, offline withdrawal recovery, retention, account erasure, revision checks and private grants/RLS are unchanged.

Independent controls:

```sh
npm run analytics:pilot -- disable --feature measurement
npm run analytics:pilot -- disable --feature personalization
npm run analytics:pilot -- disable --feature creator
npm run analytics:pilot -- disable --feature admin
npm run analytics:pilot -- shutdown
```

These commands preserve other current flags. Measurement shutdown also stops profiling; it does not erase the user's consent choices. Emergency shutdown disables optional capabilities while leaving privacy maintenance and hourly reconciliation available. It requires no database connection or matching EAS build profile, and an unsuccessful restart never rolls flags back to enabled. It saves the disabled configuration and reports if process draining needs inspection. The backend still exposes authenticated withdrawal/reset controls during shutdown; client recovery paths remain present. Explicit `activate` restores the reviewed preset; nothing reenables it automatically.

## Supported metrics

- Optional observations: sessions, Collection impressions/opens, product impressions/opens, place impressions/Google Search requests, creator profile opens, search result summaries/clicks, and resolved outbound merchant requests.
- Existing authoritative facts: saves/unsaves, follows/unfollows, likes/unlikes, Collection shares and operational merchant-click records. These business operations remain independent of optional measurement.
- Creator reporting: Collection opens/impressions, product impressions, merchant requests, profile opens, saves, followers, shares and likes, with ranked Collections/products and 7/30/90-day comparisons.
- Admin reporting: aggregate usage/search/shopping metrics, opt-in authenticated activity, inventory/publication/import/extraction snapshots, terminal source status, timeout/backlog indicators, event-health counts and reconciliation status. It does not expose raw user histories.
- Personalization readiness: deterministic, bounded product/Collection/creator/category interest features from permitted current intent and recent opted-in activity. No AI service, embeddings or new recommendation consumer is enabled. Places/location and raw search text are excluded from profiling.

No watch duration, playback position, completion, skips, replays or playback sessions are collected or displayed. Embedded players are unchanged.

## Freshness and cost

The existing worker refreshes daily creator/admin aggregate rows every five minutes, runs privacy maintenance hourly on a separate loop, and retains hourly reconciliation. With no opted-in profiles, the aggregation loop makes three RPCs per five-minute tick (creator, admin, empty interest claim): approximately 864/day, plus hourly maintenance/reconciliation. These are request-count estimates, not a billing guarantee. No additional worker service, Redis queue, paid infrastructure or AI/provider call was introduced.

When users separately opt in, the existing interest worker claims at most 100 accounts per tick, with four accounts in flight and an hourly freshness target. Client queues batch at most 25 events, cap storage at 500 events/approximately 500 KB, expire queued events after 24 hours, and retry with bounded backoff. Server batches remain capped at 50 events/64 KiB and retain validation, rate limiting and event-ID deduplication.

Existing retention remains: optional raw events seven days; search-result/session linkage 24 hours; optional merchant identity linkage seven days; creator/admin daily aggregates 13 months; admin access audit 30 days; interest profiles expire after 24 hours and reject stale/invalid consent. Aggregation does not block privacy cleanup.

Reports use completed UTC calendar days and expose coverage/provisional/stale states. Enabling collection now does not invent past observations or backfill fully covered days. Some charts will remain empty/partial until consented usage and completed-day coverage exist.

## Verification performed

- All six Analytics migration versions and required functions exist on the expected linked project. Private table grants/RLS and seven scoped worker RPC deadline configurations pass. The previously verified PostgREST deadline enforcement remains part of the deployment evidence.
- Six missing counter projection rows and four missing cumulative baseline rows for newer entities were initialized using the deployed preserving function. Business counter mirrors were checked unchanged inside that transaction. Final preflight: 246 inventory counters, zero blocking drift, zero missing baselines/projections.
- API and dedicated worker restarted using the same immutable entry paths. Non-Analytics service environment dictionaries match their before snapshots. Ingestion, Redis and Cloudflare services were not restarted or reconfigured.
- Live creator/admin rollup timestamps advance and enabled coverage buckets accumulate. The worker logged startup and successful maintenance, with no creator/admin/profile/maintenance failure messages in the observed activation window.
- Live tests used only the two explicitly authorized existing accounts. The creator received HTTP 200 for its creator report and HTTP 403 for admin reporting; the designated admin received HTTP 200 for admin reporting. Preferences/personalization/interest endpoints were reachable. Personalization was available while remaining unconsented. A valid event with no current account consent was rejected for both accounts.
- Test login used unsent admin-generated links for already-verified authorized accounts. Session tokens remained in memory and the test refresh sessions were revoked with local-session logout; other devices were not signed out. No passwords or tokens were printed or persisted.
- Final live counts: zero optional events, zero preference rows, zero interest profiles; all measurement/activity/personalization opt-in counts remain zero. Exactly one active admin membership exists and matches the designated account. Migration history remains 53, and the unrelated pending publication migration remains unapplied.
- Offline tests: 14 preset/operator safety checks plus 123 Analytics/privacy/Creator UI/draft regression checks passed. Client/backend TypeScript passed. Lint: zero errors, 23 pre-existing warnings in unchanged source. JSON/profile consistency and `git diff --check` pass.

## Remaining user steps

1. Build/install an Android APK using the prepared `analytics-pilot` profile in a separately authorized free-tier build. The current APK cannot gain these compiled capabilities by restarting the backend. OTA updates are not configured and no build/update was started in this task.
2. Log in as the authorized test creator. Choose usage measurement, account activity and interest profiling independently in Settings if you want to exercise those purposes. None is enabled automatically. Positive consented event acceptance/profile generation remains for this explicit user/device test; offline privacy tests cover those paths without enrolling real users.
3. Open Creator Analytics through the existing route; the designated admin can use the existing `mystash://admin-analytics` internal route after installing the pilot build. The public flags do not authorize any other account.

No schema migration, runtime code deployment, native/cloud build, tracking opt-in, paid service or AI extraction call was initiated by this activation.

## Files changed

- `backend/config/analytics-pilot.json`
- `backend/scripts/analyticsPilot.py`
- `backend/scripts/analyticsPilot.test.py`
- `backend/scripts/sql/analytics_pilot_preflight.sql`
- `eas.json` (new dedicated profile)
- `package.json` (operator command only)
- `backend/docs/ANALYTICS_PILOT.md`
- `backend/docs/ANALYTICS_ROLLOUT_STATUS.md` (current-state follow-up)
