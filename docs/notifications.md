# Notifications

Backend notification platform (inbox first, push later). Architecture authority:
the approved Revision 3.1 plan. This document records decisions that are now
fixed and what each phase ships.

Postgres is the source of truth. Producers call `notification_enqueue_event`;
the worker's DB-only materializer turns outbox rows into inbox rows. Phases 1–2
need Postgres only: no Redis, no push.

### Revision 3.1 phase status (2026-10-13)

| Phase | Status | Notes |
| --- | --- | --- |
| 1 Inbox SQL + API | implemented | Local scratch SQL; not a full `db reset` replay |
| 2 Outbox worker | implemented | Postgres leases; worker import graph has no Redis |
| 3 Mobile inbox (Release A) | implemented | Flag-gated; no OS permission |
| 4 Push backend | implemented | Push off by default; Phase 4 migration applied to linked project by owner |
| 5 Mobile push (Release B) | code complete | No physical-device validation; EAS/credentials are owner steps |
| 6 Social + preferences | implemented | No remote schema change |
| 7 Campaigns, load, alerts | implemented locally | See section 11. Stopped here. No device validation |

## 1. Retention (accepted)

| Data | Retention | Where enforced |
| --- | --- | --- |
| Stale-event cutoff | Events whose source `occurred_at` is older than **30 days** are rejected as `stale` | `notification_enqueue_event` |
| Event keys (`notification_event_keys`) | **120 days** | `notification_prune` |
| Inbox (`notifications`) | **90 days** | `notification_prune` |
| Processed outbox rows | **7 days** after processing | `notification_prune` |
| Dead outbox rows | **30 days** after creation | `notification_prune` |

The values live in `backend/src/notifications/domain/policy.ts`
(`NOTIFICATION_RETENTION`) and are passed to the RPCs.

Invariant: event-key retention must exceed the stale cutoff (120 > 30). An event
whose key has been pruned is necessarily older than the cutoff, so a replayed
source event can never be admitted twice. `notification_prune` and
`assertRetentionInvariant()` both refuse to run if this is violated.

## 2. Account deletion purge is permanent

`UserService.deleteAccount` is a soft delete (`account_status = 'DELETED'`), so
foreign-key cascades never fire. It therefore calls `notification_purge_user`
explicitly, which:

- deletes the user's own inbox rows, outbox rows, preferences and settings;
- removes the user as an actor from other people's grouped notifications
  (counts and sample actors are recomputed; a group with no remaining actors is
  deleted);
- clears the user as actor on pending outbox rows, so they are suppressed.

**The purge is permanent.** `UserService.restoreAccount` reactivates the account
but does **not** restore any notification data, and nothing recreates it:

- the restored user starts with an empty inbox and default preferences;
- other users' grouped notifications keep the recomputed counts without the
  restored user;
- event keys are intentionally kept (they hold only opaque ids), so source events
  from before the deletion are still deduplicated and are never re-notified.

If the purge fails during `deleteAccount`, the deletion still succeeds; the
maintenance job re-runs the purge (idempotent) every 10 minutes for accounts
deleted in the last 7 days.

## 3. Producers (Phase 2)

Every producer passes a key and timestamp derived from the source record, and
emits only on the state-changing branch. Emission goes through
`NotificationEmitter.emitSafely`, which never throws into the business path.

| Event | Producer | Emitted when | Idempotency key |
| --- | --- | --- | --- |
| `ingest.ready_for_review` | `stages/orchestrator.ts` | Ingest reaches `ready_for_review` or `review_required` (fresh run or cache hit) | ingest id + transition time |
| `ingest.failed` | `stages/orchestrator.ts` | Source unavailable/restricted marks the ingest `failed` | ingest id + transition time |
| `collection.publish_succeeded` | `publish.ts` | Ingest is marked `published` | collection id + `published_at` |
| `collection.publish_failed` | `publish.ts` | Publish ends with a 5xx after products were selected (4xx validation errors are shown inline and not notified) | ingest id + failure time |
| `creator_library.sync_failed` | `creator-library/jobs/librarySyncWorker.ts` | The final retry of a sync job fails | connected account + run start (one per run) |
| `connected_account.needs_reauth` | `ConnectedAccountService` | Status moves into `needs_reauth` from another status (repeat probes do not notify) | connected account + transition time |
| `creator.status_changed` | `UserService` | Operator-driven `suspendCreator` / `reinstateCreator` only; self-service onboarding steps do not notify | user + status + `updated_at` |
| `creator.followed` | `EngagementService.followCreator` | New follow fact inserted (idempotent re-follows do not notify) | engagement fact id |
| `collection.saved` | `EngagementService.saveCollection` | New save fact inserted, and the Collection has an owner other than the actor | engagement fact id |
| `reel.liked` | `EngagementService.likeReel` | New like fact inserted, and the Reel's creator is not the actor | engagement fact id |

Not notified by design: manual ingests and manual product appends (the user is
on screen), legacy `pipeline/legacy/extractionExecutor.ts`, and library sync
token failures (covered by `needs_reauth`).

Accepted loss window: producers enqueue right after their own write commits, so
a crash between the two loses that notification; it can never duplicate one.

## 4. Hosting

Notifications run in their own long-lived process,
`backend/src/notificationWorker.ts` (`npm run start:worker:notifications`). It
needs Postgres only: outbox leases, maintenance and pruning all live in
Postgres, and a test ensures its import graph never reaches `bullmq`/`ioredis`.
Managed Redis keeps serving the existing BullMQ workers (`worker.ts`) only.

- `GET /health` on `NOTIFICATIONS_WORKER_HEALTH_PORT` returns the notification
  health snapshot (200 ok, 503 degraded), and 503 `draining` during shutdown.
- On SIGTERM/SIGINT the worker stops claiming, waits for the in-flight batch
  (up to `NOTIFICATIONS_WORKER_SHUTDOWN_MS`, default 25 s) and exits. A lease
  left behind by a killed worker expires and is reclaimed by another instance.
- Outside production the API process still embeds a materializer when
  `INGEST_WORKER_EMBEDDED` is set, for local development.

## 5. Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `NOTIFICATIONS_PRODUCERS_ENABLED` | enabled | Set to `false` to turn every producer into a no-op |
| `NOTIFICATIONS_HEALTH_SECRET` | unset | Enables `GET /health/notifications` when sent as `x-notifications-health-secret` |
| `NOTIFICATIONS_OPERATOR_SECRET` | falls back to the health secret | Enables `POST/GET /internal/notifications/campaigns` when sent as `x-notifications-operator-secret` |
| `NOTIFICATIONS_WORKER_HEALTH_PORT` | `WORKER_HEALTH_PORT` | Notification worker health port |
| `NOTIFICATIONS_WORKER_SHUTDOWN_MS` | `25000` | Graceful drain budget |
| `EXPO_PUBLIC_NOTIFICATIONS_ENABLED` | off | App: `true` shows the inbox, bell badge and Settings row (Release A) |
| `EXPO_PUBLIC_PUSH_ENABLED` | off | App: `true` (together with `EXPO_PUBLIC_NOTIFICATIONS_ENABLED`) turns on push registration, taps and the Settings push row (Release B) |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | unset | App: Expo push token project id, used only when `expo.extra.eas.projectId` is absent (normally set by `eas init`) |
| `NOTIFICATIONS_PUSH_ENABLED` | off | Worker: exactly `true` starts push dispatch and receipt polling, and makes materialize create deliveries |
| `EXPO_ACCESS_TOKEN` | unset | Server-only Expo enhanced-push-security token; required when push is enabled (the worker refuses to start without it) |

Apply `supabase/migrations/20261012120000_notifications_inbox.sql` before
enabling producers; until then each emit logs `notification.emit_failed` and
the business write is unaffected.

## 6. SQL testing

- **Local (baseline):** `npm run db:reset:local` wraps `supabase db reset
  --local`. It refuses `--linked`/`--db-url`/`--project-ref`,
  `NODE_ENV=production`, and any stack whose API URL is not localhost. Then
  run `npm run test:notifications:integration` (in `backend/`) with
  `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY` from `supabase status`.
- **Staging smoke (before production rollout):** `npm run notifications:smoke`
  with `NOTIFICATIONS_SMOKE_URL`/`NOTIFICATIONS_SMOKE_SERVICE_ROLE_KEY`. It
  creates a temporary user, exercises enqueue/dedupe/materialize/read/open/RLS/
  purge against the deployed worker, and deletes the user.
- Both test entry points call `assertSafeTestTarget`, which refuses the
  production project (`womdeohfpvzmhomgqwig`, plus
  `SUPABASE_PRODUCTION_PROJECT_REFS` / `SUPABASE_PRODUCTION_URL`). Staging must
  be selected explicitly with `NOTIFICATIONS_TEST_TARGET=staging`.

Known gap: the migration history does not yet replay from an empty database —
`20260511000000_curation_pipeline.sql` alters `public.videos`, which predates
the migrations. `supabase db reset --local` therefore fails until a baseline
schema migration (or `supabase/seed`-independent bootstrap) exists. Until then
the notification migrations are validated on a scratch Postgres with the
dependent tables stubbed:

- **Scratch SQL harness:** `npm run test:notifications:sql` (in `backend/`,
  needs local `initdb`/`pg_ctl`/`psql`) creates a throwaway cluster in a temp
  directory, stubs `auth.users`/`public.users` and the Supabase roles, applies
  the Phase 1, 4, 5 (revocation) and 7 (campaign) migrations, re-applies 4–7,
  and runs `notifications_push_checks.sql`, `notifications_revocation_checks.sql`
  and `notifications_campaign_checks.sql`. It never connects to a remote
  database.

  Latest local run (2026-10-13): **76 passed, 0 failed**.

## 7. Mobile inbox (Phase 3, Release A)

Inbox only: no OS permission prompt, no push token, no `expo-notifications`.

- `app/notifications.tsx`: sectioned list (Today / This week / Earlier),
  pull-to-refresh, cursor paging. Opening the screen marks loaded items seen;
  "Mark all read" is bounded by the newest loaded item, so a notification that
  arrives meanwhile stays unread.
- Tapping a row marks it read, records the open, and navigates to its deep
  link only if it passes the client allowlist (`src/notifications/linking.ts`,
  kept in parity with the server's by test); otherwise it stays in the inbox.
- `contexts/NotificationsContext.tsx` polls the unread count every 60 s while
  the app is foregrounded, refreshes on resume and screen focus, and resets on
  account switch so one user's count is never shown to another.
- Auth session refresh (Phase 2): `bindAuthAutoRefresh` starts GoTrue auto-refresh
  only while `AppState` is `active` and stops it in the background. Sign-out still
  unlinks push before `supabase.auth.signOut()`. Unverified email sessions cannot
  call privileged User/Collection/Cart/Engagement write APIs (`EMAIL_NOT_VERIFIED`).
- The profile bell shows an unread dot; Settings → Preferences has a
  Notifications row with the count.

Decisions recorded for later phases: permission is requested only after the
first publish or first follow, with a short explanation, never at launch and
never again after denial (Phase 5); sign-out unlinks the token server-side and
calls `unregisterForNotificationsAsync()`, with an offline replay that uses an
installation-scoped revocation credential, never a session token (Phase 5, §9); Expo enhanced push security with a server-only per-environment
`EXPO_ACCESS_TOKEN`, TTLs, ambiguous-outcome retries, receipts and rate caps
(Phase 4 / 6). Security notifications (sign-in, new device) stay out of scope
until a trustworthy auth-event source exists.

## 8. Push delivery (Phase 4, backend only)

Migration `20261013120000_notifications_push.sql` adds `push_registrations`,
`notification_deliveries` and `notification_delivery_attempts` (RLS on, no
client access) and the dispatch RPCs. It replaces `notification_materialize`
(new optional `p_push jsonb DEFAULT NULL`) and `notification_prune` (new
`p_delivery_days DEFAULT 30`), and extends `notification_sweep`,
`notification_purge_user` and `notification_health_snapshot` in place. Phase
1–3 call shapes keep working unchanged.

**Push stays off by default.** With `NOTIFICATIONS_PUSH_ENABLED` unset the
materializer makes the Phase 1 three-argument call, no deliveries are created
and no dispatcher runs. Registration routes are always mounted (they need the
Phase 4 migration) so tokens can accrue before delivery is switched on.

- **Dispatch** lives in the notification worker and uses Postgres leases, not
  BullMQ: claim → `notification_begin_push_send` (revalidates recipient,
  registration, sign-out, preference, deadline) → Expo send → 
  `notification_record_push_results`, all fenced by one dispatch token. A
  crash between send and record is resolved by the sweeper as ambiguous.
- **Expo client:** direct HTTP to `/push/send` (≤100 per request) and
  `/push/getReceipts` (≤1000 ids), `Authorization: Bearer EXPO_ACCESS_TOKEN`,
  gzip above 1 KiB. `expo-server-sdk` is not used: it is ESM-only (the backend
  is CommonJS) and its internal 429 retries would bypass the delivery state
  machine.
- **Policy** (`domain/pushPolicy.ts`): TTL social 6 h, task 24 h, account 24 h,
  security 1 h. Ambiguous outcomes are retried once for task/account/security
  and never for social; known-retryable outcomes (429, 5xx, connect failures,
  device rate limit) back off 30 s / 2 m / 8 m for at most 3 attempts. Social
  push is capped at 10 per recipient per rolling 24 h with a 24 h cooldown per
  group key; the inbox row is always kept.
- **Invalid tokens:** `DeviceNotRegistered` on a ticket or receipt invalidates
  the registration (fingerprint-matched, so a token that was re-registered
  meanwhile is untouched) and suppresses its open deliveries.
- **Registration:** `PUT /users/me/push-registrations/:installationId`
  (`token`, `platform`, `osPermission`, optional `appVersion`, `appBuild`,
  `locale`, `timezone`, `apnsEnvironment`); 409 if the installation is bound to
  another account with a different token. `DELETE` on the same path unlinks it
  for the caller only (sign-out). `POST /users/me/notifications/:id/opened`
  accepts optional `deliveryId`/`action` for push-open tracking.
- **Privacy:** tokens are never logged; only `token_fingerprint` (first 16 hex
  of sha256). Provider messages are stored with tokens redacted. Lock-screen
  copy is generic for account events and never quotes video or Collection
  titles for task events; push `data` is only `{v, nid, did, type, link}`.
- **Retention:** deliveries and attempts 30 days; signed-out or invalidated
  registrations 30 days; account purge deletes registrations and deliveries.
- **Health:** with push on, the worker health report adds push lag
  (`push_lag` > 120 s), stuck-sending and overdue-receipt counters, and
  `dispatcher_stale`.

Not in Phase 4: mobile registration, permission prompt, tap handling and
Android channels (Phase 5). Preferences UI and quiet-hours UI are Phase 6.
Security-notification producers stay deferred.

**Status:** code and migration complete and tested (scratch SQL 61/61, backend
unit tests). The owner applied the migration to the linked project
(`womdeohfpvzmhomgqwig`); a read-only check confirmed `20261013120000` in the
migration history, the three tables with RLS enabled, every Phase 4 function,
and only the new `notification_materialize` / `notification_prune` signatures.
Delivery stays off until `NOTIFICATIONS_PUSH_ENABLED=true` and
`EXPO_ACCESS_TOKEN` are set on the notification worker.

## 9. Mobile push (Phase 5, Release B)

Gated by `EXPO_PUBLIC_PUSH_ENABLED=true` **and**
`EXPO_PUBLIC_NOTIFICATIONS_ENABLED=true`; also requires a physical device, a
native build (not Expo Go) and an EAS project id. With the gate off nothing
registers, nothing prompts, and sign-out behaves as before.

- **Installation id:** random UUID in SecureStore
  (`src/notifications/installationId.ts`). A 409 from registration (another
  account holds this installation with a different token) rotates it once.
- **Registration** (`src/notifications/pushRegistration.ts`): on launch, on
  foreground (at most once a day unless user, token, permission or app version
  changed) and on token rotation. It never prompts. If the OS permission was
  revoked, the stored registration is re-sent with `osPermission: denied` so
  the server stops creating deliveries.
- **Permission (decision 8):** `maybePromptForPush` runs after a successful
  publish (both publish paths) or follow (both follow paths). It shows a short
  explainer once per install; the OS dialog appears only if the user accepts.
  Never at launch, never twice, never after denial. Settings → Preferences →
  Push notifications asks on tap while undetermined, otherwise opens the OS
  settings.
- **Sign-out (decision 5):** `AuthContext.signOut` first calls
  `DELETE /users/me/push-registrations/:installationId` with the current
  session (3 s budget), then `unregisterForNotificationsAsync()`, dismisses
  presented notifications and clears the badge, then signs out. No Supabase
  access or refresh token is kept after sign-out (see "Offline sign-out" below).
- **Account switch:** presented notifications and the badge are cleared when the
  signed-in user changes; the server rebinds the installation and suppresses the
  previous user's open deliveries.
- **Taps** (`src/notifications/PushNotificationsHost.tsx`): warm start via the
  response listener, cold start via the last response, each handled once. The
  payload is parsed strictly (`v: 1`, uuid `nid`, numeric `did`), the link is
  re-checked against the client allowlist, and the open is recorded with
  `deliveryId`. A tap while signed out goes only to sign-in.
- **Foreground:** banners are shown once per notification id (Expo can hand a
  notification over more than once); a received push refreshes the unread
  count.
- **Android channels:** `activity`, `social`, `account`, `promo`, matching the
  server's channel mapping (parity test).
- **Build config:** `expo-notifications` plugin and `POST_NOTIFICATIONS` in
  `app.json`; `eas.json` profiles `development` and `preview` turn both app
  flags on, `production` leaves them off.

### Offline sign-out: installation revocation credential

Migration `20261014120000_notifications_push_revocation.sql` (additive; tested
on the local scratch database only, **not applied to any remote project**)
adds `push_registrations.revocation_hash` and two service-role RPCs.

- On every successful `PUT` registration the server generates 32 random bytes
  (base64url, 43 chars), stores only their sha256 (`revocation_hash`, CHECK
  `^[0-9a-f]{64}$`) on that installation's row, and returns the secret once as
  `revocationCredential` with `Cache-Control: no-store`. It is never logged.
- The client keeps `{installationId, credential, pending}` in SecureStore
  (`mystash.push.revocation`). Possession lets it do one thing:
  `POST /push-registrations/:installationId/revoke {credential}`
  (unauthenticated) unbinds **that** installation from the account it is
  currently bound to and suppresses that account's open deliveries on it.
  It grants no account access, reads nothing, and cannot reach any other
  registration. Response: `{revoked: boolean}`; malformed input → 400.
- The secret is single-use and rotates on every registration; a
  `BEFORE UPDATE` trigger clears the hash whenever the row's `user_id`
  changes by any path (session unlink, account switch, token move), so a
  previous account's secret can never unbind the next account.
- Sign-out (`src/notifications/signOutUnlink.ts`): session `DELETE` first
  (3 s). If the session is rejected (4xx), the credential revoke is tried at
  once. If the network is down, the record is marked `pending` and replayed on
  launch, on foreground (also while signed out) and before any
  re-registration. Success, or a non-retryable 4xx, deletes the record; a new
  registration overwrites it. Local cleanup always runs.
- The Phase 5 `mystash.push.pending_unregister` key (which held an access
  token) is deleted on launch and sign-out and is never written.
- **Before the migration is applied** the server falls back to
  `notification_register_push`, returns `revocationCredential: null`, and
  `revoke` answers 503. The client then stores nothing: offline sign-out
  degrades to local cleanup only, and the next registration on the device
  rebinds the installation server-side.
- No rate limiter exists in the backend; guessing a 256-bit secret is not
  feasible, so none was added.

Verified: scratch SQL 71/71 (10 revocation checks), backend `push.test.ts`,
mobile `signOutUnlink.test.ts` (online, offline, retry after reconnect,
unauthorized/stale credentials).

### Remaining manual setup (owner)

None of these were done by the agent; no credentials were created or uploaded.

1. Confirm the final bundle id / package (currently the provisional
   `com.anonymous.Mystash` for both) **before** creating any credentials;
   they are bound to it.
2. `npm i -g eas-cli` (not installed in this repo), `eas login`, then
   `eas init` from the repo root; commit the `expo.extra.eas.projectId` (and
   `owner`) it writes to `app.json`.
3. iOS: Apple Developer Program membership; `eas device:create` for each test
   iPhone; APNs key (see the device-testing guide) uploaded via
   `eas credentials` or the Expo dashboard.
4. Android: Firebase project + Android app with the final package;
   `google-services.json` referenced by `expo.android.googleServicesFile`;
   FCM v1 service-account key uploaded to Expo.
5. Enable enhanced push security for the Expo project and create an access
   token; keep it server-side only.
6. Apply `20261014120000` to a **non-production** project when ready (until
   then offline sign-out is local-only, as above).
7. Only when explicitly testing delivery: set `EXPO_ACCESS_TOKEN` and
   `NOTIFICATIONS_PUSH_ENABLED=true` on the notification worker of that
   environment.

`apnsEnvironment` is sent as `null` (the build type cannot be detected reliably
on device); it is informational only.

## 10. Social producers, preferences and quiet hours (Phase 6)

Social types (`creator.followed`, `collection.saved`, `reel.liked`) were already
in the registry with a 1-hour aggregation window. Phase 6 emits them from
`EngagementService` on the inserted-fact branch only, keyed by
`fact:<event_id>` with `occurredAt` = the fact's `created_at`. Self-saves and
self-likes are skipped (enqueue also returns `self` if they get that far).
Unfollow / unsave / unlike do not retract a notification; a later re-follow
creates a new fact and a new event.

**Preferences.** Inbox for task and account, and every security channel, cannot
be turned off. Everything else is configurable:

- `GET` / `PUT /users/me/notification-settings`
- Absent rows = on, except promo push (off until the user turns it on; that
  also stamps `promo_opt_in_at`, which is never cleared).
- Quiet hours: optional `{ start, end }` in the user's IANA timezone. They delay
  push until the window ends; if that is past the TTL the delivery is
  `suppressed_quiet_hours`. Inbox is unchanged.
- Settings writes use the existing Phase 1 tables through the service-role
  client (no new migration).

**Rate caps** stay at decision 4 (10 social pushes / 24 h, 24 h cooldown per
group key), already enforced in `notification_materialize`. They only change
`push_decision`; the inbox row is always kept.

Mobile: Settings → Notification settings (`app/settings/notifications.tsx`),
gated by `EXPO_PUBLIC_NOTIFICATIONS_ENABLED`.

**Status:** code complete. No remote migration. Physical-device push testing
is still a separate owner step (section 9).

## 11. Campaign fan-out, load tests and alerts (Phase 7)

Migration `20261015120000_notifications_campaigns.sql` (additive; scratch SQL
only, **not applied to any remote project**) adds `notification_campaigns`,
set-based `notification_fan_out_campaign` (batches of 1–5000, advisory lock,
cursor by user id) and `notification_materialize_many` (one round trip that
loops the existing `notification_materialize`). Fan-out writes event keys +
outbox (`promo.broadcast`, key `campaign:<campaignId>:<userId>`), never inbox
rows directly, so prefs, quiet hours and push policy still apply.

Audiences: `all_active`, `promo_inbox`, `promo_push_opt_in`. Operator HTTP:
`POST /internal/notifications/campaigns` and `GET …/:id` behind
`NOTIFICATIONS_OPERATOR_SECRET` (404 if the secret is missing or wrong). The
notification worker fans out queued campaigns on a 2 s idle poll. Deep links
must be allowlisted. Promo lock-screen copy is the operator title/body.

When due-outbox lag exceeds 120 s the materializer switches to
`OUTBOX_LAG_POLICY` (claim 500, concurrency 32) and `materializeMany`. If the
RPC is missing (`PGRST202`) the repository falls back to sequential
`materialize`. Retention is unchanged (decision 2); prune stays batched.
Optional enqueue inside the engagement-fact RPC was **not** added (accepted
social crash window remains).

Health `/health` logs `notification.alert` with a 60 s cooldown: page on
`*_lag` / `*_stale` / stuck-sending ≥ 10; warn on `outbox_dead` ≥ 100 and
overdue receipts ≥ 100.

### Measured locally (not production, not a device)

In-process Express + `InMemoryNotificationRepository`
(`npm run notifications:load`, feed size 2000, 400 requests, concurrency 20):

| Endpoint | p50 | p95 | max |
| --- | --- | --- | --- |
| `GET /users/me/notifications?limit=20` | 8.5 ms | 30.7 ms | 72.7 ms |
| `GET /users/me/notifications/unread-count` | 4.9 ms | 6.9 ms | 25.7 ms |
| `POST /users/me/notifications/read` | 7.2 ms | 10.7 ms | 20.2 ms |

100k outbox burst (`npm run notifications:burst`) with `FakePushProvider`,
worker restart after 50k (leases expire, remainder drained), Redis unused:

- materialized 100000 / 100000
- drain 677 ms; prune 666 ms (50 × 2000 processed-outbox batches after an 8-day clock jump)
- FakePushProvider 1000 batches × 100 = 100000 messages

k6 script: `backend/scripts/k6/notifications-feed.js` (optional; **not run**
here because k6 is not required). Redis-killed mid-run is already covered by
the worker having no Redis/BullMQ import graph.

### Limitations

- Load and burst numbers are in-memory, not against Postgres or Expo.
- SQL fan-out of 100k distinct users was not measured (scratch cluster is
  check-sized).
- Campaign and revocation migrations are still unapplied remotely.
- No physical-device validation.

### Remaining manual setup before real-device testing

Same owner list as section 9 (EAS, APNs, FCM, Expo access token, apply
`20261014120000` and `20261015120000` to a **non-production** project, then
enable push flags only on that environment). Plus: set
`NOTIFICATIONS_OPERATOR_SECRET` if campaigns will be created via HTTP.
