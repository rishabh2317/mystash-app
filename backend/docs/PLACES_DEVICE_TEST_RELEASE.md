# Places device-test release — 2026-10-28

Authorized scope: build an Android APK with the latest working-tree code, apply only
the two pending Places migrations after a backup/rehearsal, and restart the existing
local backend while preserving Analytics settings. No store release or paid service.

## Android APK

- EAS build: `d70a3303-014a-4ab8-94f3-2bbe4447eb35`; status FINISHED; profile `preview`, internal Android APK.
- Build page: https://expo.dev/accounts/rishabh17/projects/Mystash/builds/d70a3303-014a-4ab8-94f3-2bbe4447eb35
- APK: https://expo.dev/artifacts/eas/txuwOj-dtY63_faShGU8dxuf2qh1ZLliZvIAn8WmDmM.apk
- Package unchanged: `com.anonymous.Mystash`; version 1.0.0, versionCode 1.
- EAS Free plan verified before submission. Free-tier queue `NORMAL_PLUS` accepted
  the build; no subscription, checkout, payment details or paid resource class used.
- Uploaded working-tree source includes the uncommitted Creator Studio and Places
  Milestones 1–3 changes. Git metadata remains HEAD `8313bf1`; it is not a new commit.
- EAS source fingerprint: `b3ef3c9383d94e9c7aaf4285707364a400ad55a0`.
- Uses the existing preview environment and `https://api-dev.mystash.in`. Public
  environment values and signing credentials were not printed or committed. EAS
  created the first remote Android keystore; iOS credentials and both app IDs unchanged.
- No local native build, SDK install, dependency install, or APK download to the Mac.
  Android device installation and interactive app testing remain user-performed.

## Database acceptance

- Fresh private custom-format backup: 1345582 bytes, SHA256
  `24f01786619ba2230d94be56b9301f1e2eba8fb9538fdc7df53a51262bedbd1a`. Includes public/auth/storage/extension metadata and migration
  history; storage object bytes are not included. Backup location and evidence are
  under ignored owner-only `backend/.analytics-release-private/places-20261028/`.
- Restored into an isolated PostgreSQL 17 scratch cluster with outbound IP denied;
  the exact two-migration transaction passed against the restored current schema.
- Applied only `20261028120000_user_import_result_reporting.sql` and
  `20261028130000_places_reliability.sql`, with journal updates and schema reload in
  the same transaction. Migration history advanced from 51 to 53.
- Guards verified unchanged counts in all pre-existing public tables and unchanged
  hashes of authoritative import, source, place, save, user, collection and Cart rows.
  Existing attribution was backfilled exactly; no data purge or reset.
- PostgREST sees all new fields/tables. Anonymous direct access to the new private
  tables is denied. Real service-role request headers with a nonexistent owner
  received SQLSTATE 55000 from `import_work_assert`, without inserting an entity.

## Local runtime

- API and tunnel health are HTTP 200. `/places`, `/imports`, and Analytics preferences
  deny unauthenticated requests. `/analytics/config` remains disabled and measurement
  submissions remain HTTP 503 while disabled.
- Latest compiled backend source SHA256: `54266ebe4afbd3796f25b22ce315c5a3f55f60b3bdd6019ec23eb09f8875a742`.
- Stable release directory: `/Users/rishabh/Library/Application Support/Mystash/places-releases/54266ebe4afbd3796f25`. API no longer depends on
  this managed worktree staying present. Dependencies reuse the existing immutable
  matching-lockfile Analytics release; retain that dependency directory.
- `in.mystash.api`: existing user-level service, pointed at the new artifact. The
  complete environment dictionary is byte-for-byte equivalent in values to the
  prior service. `INGEST_WORKER_EMBEDDED=false` and all API Analytics flags preserved.
- `in.mystash.analytics`: existing service untouched; privacy maintenance remains
  active, collection/reporting/personalization remain off, admin access unchanged.
- Redis had been stopped. A scratch copy of its existing backend RDB showed no
  pending jobs; the original file was preserved. `in.mystash.redis` now runs the
  existing installed Redis on 127.0.0.1:6379 with its original backend data directory.
- `in.mystash.ingestion`: separate latest ingest, product-resolution, AI-review,
  content-source and creator-library consumers. A live empty-queue gate passed
  before consumers started. No extraction request, provider test, creator import or
  AI review was initiated by the agent. User actions can use existing providers normally.
- API/Analytics flags are not enabled by worker startup. Runtime logs are under
  `~/Library/Logs/Mystash/runtime/` (workers/Redis) and the existing Analytics log
  directory (API/Analytics). Launch-agent definitions are in `~/Library/LaunchAgents/`.
- The ingestion service uses RunAtLoad with KeepAlive=false; after an unexpected
  worker exit or reboot with pending jobs, inspect the queue and restart explicitly.
  This is the current local-development setup, not a claim of production availability.
- Keep this Mac awake and its existing Cloudflare tunnel active for device testing.

Existing local regression results remain in the Milestone 1–3 notes. Native cloud
compilation passed; real-device UI, extraction quality/latency, and authenticated
privacy flows were not exercised by the agent in this release.
