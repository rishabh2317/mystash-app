# Public Stash

Public Stash is independent of creator accounts, creator collections and profile navigation.
Canonical destination: `https://mystash.in/stash/{publicId}`. The UUID is immutable and unrelated to a username.

## Implemented behavior

- Missing settings means Private. Settings creation is also Private. Enabling Public never publishes existing saves.
- Explicit Product/Place publication lives on the existing memberships; every save defaults unpublished.
- Private hides retained selections. Public restores valid saved selections. Unsave clears selection; restore does not republish.
- Versioned desired-state mutations reject conflicts. Catalog and Place membership merges carry publication decisions and preserve removal precedence.
- Only resolved Places publish. Visitors save canonical Places without copying the owner's import, hypothesis or source data.
- Existing private Sources/Products/Places layouts and Saved collections remain intact. New owner controls are a header management sheet and secondary publication menus.
- Public Products use the existing Product Page with stored commerce, country ordering, affiliate redirects and grounded storefront/Google fallbacks. Public reads do not discover merchants, scrape live prices, generate reviews, search for related products or extract content.
- Private source media requires an authenticated owned import on the generic Product Page endpoint. Public projections omit sources/imports/evidence and filter private/signed media.
- Public images load automatically. Visible Place images use the existing Google provider, size selection, 300ms scheduling and attribution contract, with four client requests at a time and bounded retries. No daily photo spending cap or opt-in button is present. No provider metadata/bytes are persisted by the new public path.
- Basic owner insights: views, Product opens, Place opens, saves generated and shopping clicks. No unique-visitor estimate.

## Local compatibility proof

Pinned project: Expo SDK 54; tested installed Expo 54.0.38, Expo Router 6.0.24, Node 22.18.0.
No additional framework was introduced. `MYSTASH_PUBLIC_WEB` selects the separate public route root; the native root is unchanged.
`MYSTASH_PUBLIC_WEB_PROOF` selects the same root with the explicit offline proof fixture flag.

Commands run:

```sh
npm run public-stash:proof:export
npm run public-stash:proof:serve
npm run public-stash:proof:stage
docker build --platform linux/arm64 -t mystash-public-web-proof .public-stash-proof/container
docker run --rm -d --name mystash-public-stash-proof -p 127.0.0.1:8795:8787 mystash-public-web-proof
```

The export, shared Product Page/card rendering in Chrome, nested Product navigation and refresh, appearance switching, 390px responsive viewport, server-generated canonical/Open Graph HTML, unavailable response and no-store checks passed.
The staged Node 22/Express container built and served `/health` and nested HTML with metadata successfully.
A disk-full incident interrupted the first image pull; after storage recovery/Colima restart, the fresh pinned Node 22.18.0 image passed.

The proof is a deployment-shape test, not a claim of live Render or Supabase validation. Fixture routes contain no real account data and never call providers.
The full public export uses `npm run public-stash:web:export`; output defaults to ignored `public-web/dist`.

## Interfaces and security boundary

Owner APIs:

- `GET /public-stashes/me`
- `PUT /public-stashes/me/visibility` with `{visibility, expectedVersion}`
- `PUT /public-stashes/me/products/:membershipId/publication`
- `PUT /public-stashes/me/places/:saveId/publication`
- Publication bodies: `{published, expectedVersion, enablePublic?}`
- `GET /public-stashes/me/insights?days=7|30`

Visitor APIs:

- `GET /public-stashes/:publicId?tab=products|places&limit=20&cursor=…`
- `GET /public-stashes/:publicId/products/:namespace/:productId/page?country=IN`
- `GET /public-stashes/:publicId/places/:placeId`
- `GET /public-stashes/:publicId/places/:placeId/photo?width=128|256|640`
- `GET /public-stashes/:publicId/products/:namespace/:productId/outbound?offerId=…&format=json`
- The same outbound endpoint with `discovery=1` resolves an approved storefront/Google fallback.
- `POST /public-stashes/:publicId/items/save` with `{kind, namespace, itemId}`; verified authentication required.
- `preview=1` on reads uses the verified caller as preview owner; it never bypasses database ownership checks.

Namespaces: `catalog`, `discovered`, or `place` for Place saves. Cursor pages default to 20, cap at 50 and are bound to Stash and tab.
Public responses contain no membership IDs. The internal cursor's ordering identity is encoded in the opaque cursor; it provides no access capability.
Database RPCs are service-role-only. Client grants do not permit publication writes or private membership reads across users.
Private/missing/deleted destinations share safe unavailable responses. Public HTTP content uses `private, no-store`; static versioned assets can be cached.
Existing rendered bytes and third-party screenshots cannot be recalled. Foreground, route-focus and browser-page restoration revalidate access.

Limits use the existing ready Redis command client when configured, with a bounded local fallback: 120 requests/IP/minute, 300/Stash/minute, 30 publication/visibility requests/account/minute, 60 save requests/account/minute.
No new paid infrastructure is required.

## Measurement

The existing consent-aware analytics batch and queue are reused. Context is `surface=public_stash`, with `properties.public_stash_id` validated in PostgreSQL against current visibility and item membership.
The owner is derived server-side, never assigned a creator monetization entitlement.

- `stash.opened`: one second foreground visibility; one counted view per Stash/session/rolling 30 minutes.
- `product.opened` / `place.opened`: successfully rendered detail.
- `stash.item_saved`: server-only, after a newly inserted or explicitly restored save.
- `merchant.outbound_resolved`: server-only successful merchant/storefront/search resolution, not purchase or confirmed page delivery.

Retries use existing event IDs. Suppressed duplicate views retain raw receipt rows so a late retry cannot inflate counts after the view window expires.
Known crawler traffic and authenticated owner activity are excluded. No-consent visits are not measured. Share-sheet opening is not counted as delivery or a view.
A transactional insert trigger maintains daily aggregates without double-counting rollup retries. Day boundaries use UTC receipt date.
Raw events/session linkage follow existing maintenance policy; daily Stash aggregates expire after 13 months and are purged on owner account deletion.
Insights explicitly identify partial coverage. Disabled measurement is unavailable, not zero.

## Combined Render rollout plan — 17 November 2026

Status: planning only. The obsolete website is retired in scope and its backend is suspended, as confirmed by the owner. There is no requirement to preserve its pages or reactivate that backend. Production DNS, custom domains, Render settings, service suspension state, remote flags and deployments have not been changed. Configuration is not yet live-verified.

### Service and hostname decision

Prefer adding the combined Expo export to the existing mobile API service, retaining its service identity and hostname. Public Stash and the future landing page then use that same Express process at `mystash.in`. Keep the service's `onrender.com` hostname enabled for installed mobile clients; no app rebuild or API-prefix migration is required merely to add the website. Do not redirect all requests from the API hostname to the apex domain.

Repository evidence identifies the mobile QA API as `https://mystash-free-test.onrender.com`, service `srv-dbjc8rh42hec73cjrscg`, with the dedicated queue documented in `RENDER_FREE_TEST.md`. EAS and Android workflows still reference that hostname. These are repository/historical identifiers, not a current Render dashboard verification. The suspended obsolete-site backend must not be assumed to be this service. Confirm the target account, service ID, current state, deployed commit, branch, region, plan and domain attachments read-only before selecting the rollout target. Do not resume a suspended service during verification.

If the existing mobile service cannot be the combined target, stop and review the smallest alternative that preserves its API hostname and contracts. Do not silently repoint installed clients or replace their service.

### Route ownership

- `/`: reserved for the future Mystash landing page. Initially serve a small independent 200 HTML placeholder with no authentication, Stash lookup, creator navigation or redirect to a Stash. It must work with Public Stash disabled or its database unavailable.
- `/stash/:publicId` and its Product/Place/sign-in paths: scoped Public Stash HTML and Expo navigation.
- `/auth/callback`: validated web sign-in/email continuation; preserve existing native callback handling.
- `/public-stashes/*`: existing new owner/public JSON APIs.
- `/_expo/*`, `/assets/*`, `/public-stash-share.png`: explicit exported assets and generic sharing artwork.
- `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`: association files only after release identities are verified.
- All existing mobile API paths, methods, authentication, status codes and payloads stay at their current unprefixed paths on both service hosts. Keep `/health`, `/ready/ingestion` and `/ready/search` intact. Unknown API paths remain API errors; do not install a site-wide SPA catch-all.

A root placeholder is not implemented yet: `public-web/app/index.tsx` currently re-exports the Stash screen and Express has no dedicated landing route. Both the server root and client root must be corrected before rollout, without changing the native route root.

### Proposed Render settings, pending live verification

- Runtime: Docker. Service root: repository root (clear the existing `backend` Root Directory). Docker context: `.`. Dockerfile: `./Dockerfile.public-stash`.
- Keep the same repository and an explicitly reviewed release commit/branch. No new service name, region, plan or spending decision is inferred. Review combined API/web memory and image traffic before confirming capacity; the existing Free QA service is not production availability evidence.
- Disable automatic deployment for the controlled rollout (`autoDeployTrigger: off` if managed through a Blueprint). Do not create or sync a root `render.yaml` during planning. Export the existing settings before any later approved changes; build/configuration edits can themselves trigger deployment.
- Preserve the verified existing Docker command initially. The documented QA command is `npm run start:render-free-test`; it starts five queue consumers, notifications and analytics maintenance and forces `postgres_qa` search. Replacing it with the new image's default `node dist/index.js` would change worker ownership and search startup. This is a release blocker until the live command and every consumer are mapped. A production split into API/ingestion/notification/analytics workers is a separate reviewed infrastructure transition, not an implicit consequence of combining web and API.
- Bind to `0.0.0.0` and Render's supplied `PORT`; existing Express code already does this. Use `/health` for the current liveness check, plus mandatory external schema/search/ingestion/public-web readiness checks. `/health` alone is not a release acceptance signal. Before adopting a new combined readiness path, implement and verify it; no such path is claimed to exist today.
- No database migrations in Docker build, image startup or an unreviewed pre-deploy command. Preserve the existing backend dependency lockfile and runtime tooling.

Render references: [Docker](https://render.com/docs/docker), [monorepo root/context behavior](https://render.com/docs/monorepo-support), [Blueprint fields and auto-deploy behavior](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks). Leave the root directory unset for repository-root builds; a `backend` root prevents access to shared components even if a Docker context is changed.

### Environment, secrets and staging isolation

Verify variable names, sources and scopes without copying secret values into this document or client artifacts. Carry forward the existing Supabase, Redis, search, provider, worker and analytics configuration. Backend service-role/provider keys remain server secrets, never `EXPO_PUBLIC_*`, Docker `ARG`, committed env files or client assets. Only the public Supabase URL/anon key and verified store URLs belong in the web build arguments. The new image already sets `PUBLIC_STASH_WEB_DIR=/app/public-web`.

Keep `PUBLIC_STASH_ENABLED=false` through initial verification; enable only after all gates pass. Mobile owner controls remain behind `EXPO_PUBLIC_PUBLIC_STASH_ENABLED`; adding web must not silently change installed app configuration. Retain existing analytics consent, maintenance and withdrawal behavior. Verify the actual maintenance consumer remains active even when public access is disabled.

Staging-origin isolation is a release blocker. `publicStashApi` uses relative web requests, but the Dockerfile currently embeds `https://mystash.in` for shared user/analytics helpers. Make all public-web API requests same-origin through a web-only adapter while preserving the native configured API URL. Validate sign-in, user settings, consent, analytics and save/outbound calls on the staging hostname; none may call the apex production API. Public canonical/share URLs can remain the apex for production, but prevent staging indexing/sharing from exposing test destinations. Staging must not consume production queues or automatically start real extraction workers. Use isolated approved database/queue/provider settings or the offline smoke harness until remote staging is explicitly authorized.

Allow only the approved staging and production web callback URLs in Supabase Auth when that remote configuration is authorized. Supply verified certificate fingerprints, Apple Team ID and live store listing URLs; association endpoints and missing store actions stay fail-closed until supplied. Do not invent signing identities or listings.

### Verification and later cutover sequence

1. Read-only inventory: export current Render build/start command, branch/commit, root/context, env variable names and groups, worker ownership, queue persistence, search provider, health path, auto-deploy behavior and domain ownership. Identify the obsolete website backend separately. Inventory existing apex/`www` DNS read-only and retain the previous records; do not edit them.
2. Local configuration preparation: fix root ownership and web API origin isolation; preserve the verified mobile start command and worker topology. Produce a concrete settings diff and pin the exact release commit. Re-run the combined container smoke check and existing mobile API regression baselines. Recheck the intended Render target architecture; prior local container evidence is Linux arm64, not a Render-architecture validation.
3. Database preflight: compare installed migration history and grants with the release, verify existing writer compatibility and recovery/backup arrangements. Later apply `20261117120000_public_stash.sql` followed by `20261117130000_public_stash_measurement.sql` only in the approved environment. No historical backfill is needed. Never leave old merge writers running against the new publication semantics.
4. Configuration review: confirm all values and unresolved gates above. This planning request does not authorize deployment, unsuspension, domain attachment, migration application or DNS writes. After configuration verification, present the concrete rollout for explicit execution approval.
5. Only after execution approval: deploy the exact combined image with public access off; validate existing mobile calls at the unchanged API hostname, worker/queue health, search, notifications and analytics retention. Test Public Stash with approved staging settings/test accounts, both themes, same-origin auth/save/shopping, no paid discovery, automatic images/attribution, five metrics, source privacy and open-tab revocation.
6. Only after the staging/compatibility gates pass and DNS cutover is approved: attach/verify `mystash.in` on the combined service and update only the required domain records. Preserve the API hostname and unrelated DNS/mail records. Inspect the `www` behavior Render adds for an apex domain rather than assuming it is unused. Render's [custom-domain process](https://render.com/docs/custom-domains) requires service attachment, DNS configuration and verification; none is performed during planning.
7. Verify TLS, root placeholder, Public Stash canonical/metadata, callback, assets, association files and existing API behavior on the final domain. Enable public access in a controlled step only after all launch metrics and privacy/regression gates pass. Measure photos, egress, latency, database/analytics load and capacity; do not reuse the old on-request-photo cost estimate.

Rollback: first disable `PUBLIC_STASH_ENABLED` without affecting private saving. Retain the last verified combined release and settings snapshot. If a backend rollback is needed, use a schema-compatible checkpoint with the publication-aware merge/unsave writers; blindly restoring the old pre-migration image can violate invariants even while public pages are off. Do not run down migrations or drop retained selections as an emergency rollback. DNS rollback is a separately approved decision and must not make the mobile API hostname unavailable.

Acceptance requires `/` to remain independent, legacy mobile clients to work without endpoint changes, same-origin staging behavior, verified worker/search ownership, and a reviewed Render settings diff. Until the live inventory and the listed code/configuration blockers are resolved, the rollout is **not configuration-verified and not ready for deployment**.

## Tests and remaining release gates

```sh
npm run typecheck:client
cd backend && npm run typecheck
npm run test:public-stash
npm run test:public-stash:sql
```

The scratch SQL runner creates and removes a local PostgreSQL cluster listening only on a temporary Unix socket. It applies real membership migrations/functions plus minimal unrelated-domain stubs. It does not connect to Supabase or any remote database.
It tests RLS/grants, explicit publication, privacy toggles, direct Place membership, idempotent saving, soft deletion, merge precedence, concurrent unsave, analytics ingestion and late-retry deduplication.
It is not a full replay of the repository's migration history: linked-environment migration/grant verification remains a release gate.

Additional UI checks: `node scripts/check-public-product-page.cjs`, `node scripts/check-places-ui.cjs`, `node scripts/check-empty-states-ui.cjs`; pure queue tests live in `src/public-stash/photoQueue.test.ts`.
The Places harness's photo-key fixture now includes the existing lead/canonical discriminator introduced by the pre-existing working-tree change; its assertions were retained.

Required release-only validation: real Supabase JWT/Storage integration, Google photo relevance/provider billing, Android/iOS signed-build App/Universal Links, browser auth email delivery, accessibility/device gestures and representative Render/database load.
The code emits `public_stash.request` durations/status and `public_stash.photo_counters` (metadata, media, failures, coalescing) without source URLs or private inputs.
Each non-coalesced successful Google load normally costs one metadata lookup plus one media lookup; no-photo results can stop after metadata. Multiply measured load rates by current provider prices, and measure CDN image bytes separately. There is no public-browsing extraction/search budget.
The previous fixed-photo-budget estimate no longer applies. Production latency, egress and monthly cost have not been measured; no production-SLO claim is made from fixture or container results.

Final local regression results: client/backend TypeScript checks passed; 171 backend tests and 65 client tests passed, plus 100 Places UI and 102 empty-state UI checks. The disposable PostgreSQL suite checks all five counters, retry receipts, publication/unsave concurrency, RLS/grants and soft deletion. Public web auth uses a platform adapter that excludes native push-token listeners. Aggregate retention continues when the Public Stash access flag is disabled (an absent pre-migration RPC is tolerated).

Web store actions accept verified release listing URLs through build arguments `EXPO_PUBLIC_MYSTASH_ANDROID_STORE_URL` (the existing Android package) and `EXPO_PUBLIC_MYSTASH_IOS_STORE_URL` (an App Store numeric listing). No listing URL is fabricated. Until real listings are supplied, web shows only the explicit Open in Mystash action, including on scoped item details. Visitor shopping country is resolved by the backend; explicit choices are stored per visitor/account and never use the curator’s settings.

Full root-context image also built successfully as `mystash-public-stash-local` on Linux arm64. `scripts/public-stash-container-smoke.cjs` ran the actual compiled Express entry in `--network none`, with disposable loopback Supabase/OpenSearch fixtures, and passed public JSON/HTML, canonical/Open Graph metadata, immutable assets, existing `/cart` authentication, and Private revocation. Node runtime: v22.18.0. Command: `docker run --rm --network none -v "$PWD/scripts/public-stash-container-smoke.cjs:/app/smoke.cjs:ro" mystash-public-stash-local node smoke.cjs`.

Final browser verification used the production export at 390×844 and 1280×800: Product offers/fallback, anonymous Save continuation, Place detail, automatic photo resource requests, both themes, nested refresh and unavailable state passed against offline fixtures. Photo counters recorded two automatic requests and zero discovery calls. A final SQL regression also verifies that an explicit unpublish of an already-unpublished membership prevents an older merged identity from reviving publication. Test servers and the proof container were stopped afterward.

## Authorized development rollout — access preflight update

The owner now explicitly authorizes the existing live development rollout: compatible Supabase migrations, existing Render API/workers and web hosting, mystash.in DNS, development flags and a fresh Android APK. No separate staging environment is required. No new paid service or plan change is authorized. This supersedes the earlier planning-only/staging requirements above. Stop for access/credential, destructive-operation or spending blockers.

Live Render verification: service `srv-dbjc8rh42hec73cjrscg` (`mystash-free-test`) is Live, Docker Free, Singapore, repository `rishabh2317/mystash-app`, branch `codex/share-v2-pilot`, last deployed commit `42d0c7df1ce9e067187c10725b76d6e4fd544309`. Root Directory `backend`; Dockerfile `Dockerfile`; context `.` relative to that root; command `npm run start:render-free-test`; health `/ready/ingestion`; Auto-Deploy Off; Render subdomain Enabled. Keep this command, health check, existing env/secrets and queue ownership when changing root/context to the combined Dockerfile. No suspended website service was resumed. No Render settings were saved during this preflight.

Supabase and GitHub access are verified. Linked migration history matches all existing local migrations; only `20261117120000` and `20261117130000` are pending. No migration was applied yet.

Local rollout fixes: Express `/` now serves independent placeholder HTML; the Expo root renders a landing placeholder. The public-web Babel configuration rewrites shared API-base reads to the browser's current origin, leaving native Render profile handling unchanged. Android cloud-release workflow enables Public Stash and App Links. Client/backend TypeScript checks passed; six API-origin/profile transform tests pass. The Render backend environment currently has the existing server Supabase variables, not the new public build-variable names: configure public build values or an explicit safe Docker argument mapping before deploying.

DNS read-only lookup confirms `dina.ns.cloudflare.com` and `lennon.ns.cloudflare.com`; apex is currently proxied by Cloudflare. Cloudflare in-app browser redirects to sign-in and no local Cloudflare DNS API credential/certificate is configured. User sign-in to Cloudflare is the current access blocker. Render remains signed in in the in-app browser. No deployment, remote flag, DNS edit, migration application or APK build occurred in this rollout attempt.
