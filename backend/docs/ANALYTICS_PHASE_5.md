# Analytics Phase 5 — Opt-in interests and personalization readiness

Historical phase-completion report. Subsequent [R1–R7 fixes](./ANALYTICS_READINESS_FIXES.md) and the user-authorized [controlled rollout execution record](./ANALYTICS_ROLLOUT_STATUS.md) supersede earlier compiler-baseline, maintenance-ordering and deployment-status notes. No analytics reset was performed.

Completed locally, with all production flags unchanged/off and no deployment, build, dependency installation, account grant or paid service initiated. The consolidated future rollout plan is in [ANALYTICS_DEPLOYMENT_CHECKLIST.md](./ANALYTICS_DEPLOYMENT_CHECKLIST.md). That checklist is not deployment authorization.

No recommendations, feed/search ranking, AI provider, embeddings, model training, user-facing product/creator behavior, native configuration or embedded player has been changed. The new profile is a bounded, purpose-specific foundation for a separately reviewed future consumer. No video playback duration, position, completion, skip, replay, playback session/checkpoint or derived playback signal is collected or consumed.

## Separate purpose and privacy controls

Personalization requires three independent account choices: usage measurement, account-linked activity measurement, and the new explicit personalization opt-in. Account activity consent alone never enables personalization. Guests cannot create profiles. Enabling requires a verified, currently ACTIVE account, the current measurement receipt, the current personalization revision, and personalization policy version 1. General measurement's existing device receipt remains separate; changing/resetting personalization does not rotate that receipt or disrupt ordinary measurement.

The new migration adds `personalization_since`, `personalization_revision`, `personalization_policy_version` and a short-lived worker lease to the existing private preferences row. The previously unused personalization boolean is reset false by the migration, so no unsupported old bit is inherited as consent. Enabling starts a new purpose epoch at server time. Both event occurrence and receipt must follow that epoch; delayed pre-opt-in events are excluded. There is no historical behavioral backfill. Current saves/follows are eligible as present intent after the user explicitly agrees to that use, even if the relationship itself predates the opt-in.

The shared Settings privacy section gains an optional, separately flagged interest-profile toggle and reset control. It explains current saves/follows versus inferred categories/visits, future-only behavioral input, the seven-day horizon, 24-hour snapshot expiry and unchanged recommendations. It excludes playback, raw search text and place/location profiling. Both iOS and Android use existing SettingsSection/SettingsRow/ActionButton/theme components.

Withdrawal is allowed even when the global collection or personalization server flags are off. Disabling account activity/usage also revokes personalization and immediately deletes its snapshot through a database trigger. Suspending/deleting an account or setting `deleted_at` revokes the purpose. Hard deletion cascades through preferences to profiles. Unknown purpose policy versions fail closed.

Resetting rotates the purpose epoch and deletes the snapshot; old activity cannot seed a rebuild or be restored by an in-flight worker. Existing current saved items/follows and hide choices stay intact. An old/stale enable request cannot undo a newer withdrawal because the expected purpose and measurement revisions are checked under the same per-account advisory lock as ingestion/consent.

A failed offline withdrawal retains only an account-scoped `1` marker in AsyncStorage; it contains no token, profile, event or URL. Login/foreground recovery flushes that marker even when both client feature flags are off. Network delivery verifies the current session belongs to that scope, and concurrent retries coalesce. A small local control receipt keeps withdrawal controls available to previously consenting devices if the feature's public flag is later disabled. Turning the public flag off never grants new consent. A change is not described as server-confirmed until it succeeds; offline failures remain visible/retryable. No interest snapshot is stored on the device.

## Bounded source and deterministic rules

`analytics_interest_source` reads only the verified account's eligible current relationships and retained optional observations:

- Current Bag product membership / catalog SAVE or WISHLIST edges, current collection SAVE edges, current creator FOLLOW edges. Duplicate relationship sources do not stack. Catalog/discovered namespaces remain distinct. Hidden/inaccessible references are excluded; discovered items must still be owned in the account's Bag or attached to a current public collection.
- Future opted-in `product.opened`, `collection.opened`, `creator.profile_opened`, and server-resolved merchant requests. A merchant request is shopping intent, never a purchase. Impressions, app sessions, search responses/clicks, raw queries, place activity, legacy views and playback are not profiling inputs. Search clicks are not stacked with the resulting product open.
- Only public published/clear collections and active creators qualify; the creator's own collection workspace/profile activity is excluded. Current HIDE edges are enforced at source, write and read time. Collection unsaves and creator unfollows suppress older behavioral observations; current explicit boosts are revalidated on reads, so removed saves/follows do not remain declared preferences.

The source returns at most 201 current references and 2,001 observations, allowing the builder to detect a cap. Computation uses at most 200 references and 2,000 observations from seven days. Only IDs/namespaces, finite category codes, needed event names and timestamps travel to the private builder. No names, descriptions, merchant URLs, evidence, user text, demographics, precise location, place IDs, unrestricted brands/categories, player state or full event payloads enter the profile. Ten existing broad catalog category codes are allowed; unknown/free-text categories produce no category feature. Existing place analytics and saves remain in their original layers; place/location profiling and free-text brand profiling are deferred.

Version 1 is a documented heuristic, not a calibrated preference probability:

- Current saved product / saved collection / followed creator boosts are respectively 6 / 5 / 8. They are direct current intent signals, not manually declared category preferences. Multiple current sources for the same entity use the maximum boost.
- An open contributes 1 and a merchant destination request contributes 3. For one entity on one UTC day only the maximum signal counts, so repeated taps and an open→click flow do not keep adding weight. Distinct UTC days provide conservative revisit evidence; this is not continuous session/attention measurement.
- Behavioral weight has a three-day half-life inside the seven-day source horizon. Direct behavioral entity interest requires at least two observed days and score >= 1 to be supported; isolated opens/clicks remain emerging. Inferred score is capped at 12 and total score at 20.
- Product evidence can weakly contribute to its finite category; public collection evidence can weakly contribute to its creator. Category/creator affinity derived from multiple references remains inferred, even if the underlying references were saved. A single saved product does not establish a confident broad category preference. Two independent references or qualifying repeated-day evidence are needed for supported derived affinity.
- Profiles contain at most 50 sorted features and 32 KiB of JSON, with a `source_capped` flag when source/feature bounds discard information. Each feature distinguishes direct sources, explicit score, inferred score, evidence-day/entity counts, coarse last day and emerging/supported/explicit confidence. This is a bounded sample, not an exhaustive preference inventory.

The full snapshot is replaced on rebuild, so repeats do not accumulate or require another per-event ledger. No new per-event writes/hooks, daily identity history, streaming service, vector database or AI calls are added. Operational user records keep their existing semantics/retention.

## Storage, worker and self-only API

`20261027160000_interest_profiles.sql` follows the four already prepared migrations. It adds one private `analytics_interest_profiles` row per qualifying account, with consent epoch/version, timestamps, bounded features and cap metadata. RLS plus explicit grant revocation deny direct PUBLIC/anon/authenticated access; SQL source/build/read/consent methods are service-role-only. There is no admin endpoint for private interest profiles.

The existing five-minute analytics worker can claim at most 100 consenting accounts per tick with two-minute leases and `FOR UPDATE SKIP LOCKED`. At most four accounts rebuild in parallel. Fresh snapshots are normally skipped for one hour; claims focus on recent purpose opt-ins or accounts with optional events received in the last day. An inactive account is not rebuilt indefinitely. SQL epoch checks at commit prevent withdrawal/reset races from resurrecting a profile. Commits carry the server source-observation time, reject sources older than five minutes, and cannot overwrite a newer snapshot; freshness/expiry are based on source time rather than delayed commit time. Worker failures log only a generic failure, never IDs or payloads, and do not stop the independent privacy maintenance step.

Snapshots expire after 24 hours without refresh. Reads return no features if older than two hours, expired, revoked, unknown-version, suspended/deleted or inconsistent with the current epoch. Maintenance removes expired/invalid snapshots even if profile computation is disabled. Current explicit references/hides/visibility are checked on reads and writes. Derived broad affinities may lag source changes until a rebuild; future candidate selection must always apply current access/hide rules, not rely on a snapshot as an authorization source.

Routes use the existing verified Supabase authentication, bind identity server-side, reject arbitrary user IDs/scopes, and set `Cache-Control: private, no-store`:

- `GET /analytics/personalization`: own purpose setting, policy/revision/start and feature availability; usable during shutdown.
- `PUT /analytics/personalization`: fresh versioned opt-in, or `{enabled:false}` withdrawal. Enablement is gated; withdrawal is not feature-gated.
- `DELETE /analytics/interests`: own reset, including during shutdown. It preserves existing business records.
- `GET /analytics/interests`: own bounded snapshot, with an on-demand rebuild/current-state check. It is feature-gated and limited to six refresh reads/minute/account/process. It exposes no raw activity or other users' profiles. No current app flow calls it for recommendations.

The dependency-free `supportedInterestFeatures` helper also requires current consent and a fresh/versioned ready profile and excludes emerging features. It has no live recommendation caller. Any future consumer must obtain live server consent, enforce candidate visibility and hides, handle cap/insufficient/stale states with the existing default experience, and separately review any AI provider/data egress. Snapshot scores are not purchase probabilities or sensitive-attribute labels.

New flags are read-only checks, default false; no environment file/EAS/backend configuration was edited:

- `ANALYTICS_PERSONALIZATION_ENABLED`: new opt-in/profile building/reads; also requires existing `ANALYTICS_ENABLED`.
- `ANALYTICS_INTEREST_WORKER_ENABLED`: scheduled snapshot computation; also requires the above two flags.
- `EXPO_PUBLIC_PERSONALIZATION_ENABLED`: new controls/enablement. Previously consenting devices retain withdrawal access through their local control receipt.

Existing creator/admin reporting and aggregation remain separate. The only Phase 2 API behavior adjustment is allowing authenticated full measurement withdrawal during global collection shutdown; enabling remains blocked. No recommendation, search, extraction, publishing or transactional write path is changed.

## Cost and scale

At the earlier illustrative 50 observations/DAU/day, a typical seven-day source has about 350 observations per active consenting account, below the 2,000 cap. At 10% purpose opt-in, 1k / 10k / 100k DAU imply roughly 100 / 1,000 / 10,000 active snapshots. At an assumed 8–16 KiB per stored snapshot, this is approximately 0.8–1.6 / 8–16 / 80–160 MiB plus indexes and small preference metadata. At 100% opt-in, multiply these estimates by ten. The hard feature limit is 32 KiB, and snapshots are not archived.

At an hourly rebuild target that is at most roughly 2.4k / 24k / 240k snapshot rebuilds/day for the 10% examples, plus claim/release metadata writes and explicit self-read refreshes. Re-reading a typical 350-row horizon gives about 0.84m / 8.4m / 84m source-row visits/day, before relationship/visibility lookups, WAL/bloat/backups and network costs. Real traffic and opt-in rates must be measured; these are estimates, not benchmarks or free-tier promises.

A single existing worker with 100 claims/five-minute tick can handle at most 1,200 account claims/hour, sufficient for the initial 1k active-account envelope if database work finishes within its lease/tick budget. It does **not** promise hourly refresh for 10k consenting accounts: stale snapshots safely fall back instead. Before 10k/100k DAU, benchmark query plans, per-user bounds, RPC overhead, lease duration, WAL and worker headroom, then tune approved batching/replicas or freshness targets. Do not add infrastructure blindly. The raw seven-day data and earlier rollup ledgers remain larger scale costs; this phase does not extend raw actor retention or create another event ledger.

## Local verification

All five prepared migrations run in a disposable local PostgreSQL cluster against deterministic business-schema fixtures, with no credentials or deployed connection. Phase 5 checks cover fresh separate consent, no pre-opt-in/queued-history use, namespace/ownership/visibility isolation, no place/private-text input, source/commit/read gates, current follow/hide enforcement, reset and stale-enable rejection, activity withdrawal, soft/hard deletion, unknown policy, snapshot freshness/TTL, SQL grants, concurrent worker claims and withdrawal-vs-commit. Earlier analytics/creator/admin and separate Phase 1 engagement SQL checks continue to pass. This is fixture verification, not a production schema rehearsal.

The selected regression suite passes 363 tests: 339 directly, including 29 new Phase 5 checks, plus 24 assertions in three unchanged UI files through the established temporary CommonJS test-loader workaround. Original assertions are unchanged and copies are removed. New tests cover scoring/recency/noise caps, insufficient evidence, no playback/text/location features, self-only routes, receipt conflicts, shutdown-safe privacy actions, worker limits and durable offline withdrawal isolation/retry.

TypeScript retains 270 pre-existing diagnostics with no new diagnostics. Lint across 92 changed/new TypeScript files retains the same five pre-existing issues with no new issues. Protected player sources and the Product Page embed match original Git source exactly. Existing Creator Studio edits, shared Android/iOS functionality, identifiers, Expo/EAS configuration and dependency manifests remain preserved. Native/device/production UI validation and a full deployed-schema rehearsal remain future release gates. No changes have been deployed or enabled.
