# Creator Ecosystem — Architecture Audit & Plan

**Status:** Planning / audit only — **no code, schema, migrations, APIs, or UI changes**  
**Date:** 2026-09-25  
**Product:** Mystash creator / curator rebuild (phased)

---

## Headline verdict

Mystash already has a strong **Collection + Catalog** spine, but **creator publish** and **user share-import** are two ununified systems. Rebuild on:

- `collections` / `collection_media` / `collection_product_tags`
- `content_sources` (+ library membership)
- `catalog_products` (product identity)

**Do not** invent parallel product or content identities for brands, creators, or curators.

| Signal | Value |
|--------|--------|
| Ingress systems today | 2 (Create Studio vs Share Import) |
| Connected-account models | 0 |
| Catalog product SoT | 1 (`catalog_products`) |
| Brand / campaign entities | 0 |

### Non-negotiables

- No separate product systems for brands / creators / curators.
- Do not make Instagram / YouTube / Brand / Campaign the **product identity**.
- Content and products stay independently attachable (one content → many products; products attach regardless of source).
- Account authentication/linking ≠ content synchronization ≠ content rendering/playback.
- **VERIFY FIRST** any Instagram / YouTube / Meta / Google API or policy assumption before implementing Phases 2–3.
- Do not implement brand website in this program’s early phases; design seams only until Phase 7.

### Important future business context

Mystash will eventually have a separate **brand web experience** (login, campaigns, product upload, product-fetch API/feed). Those products/campaigns must become available inside the creator/curator experience without a second product system.

A creator/curator should eventually attach a product from:

- video / Reel / Short extraction  
- manual product URL  
- affiliate URL  
- brand campaign  
- brand-provided product  
- brand product API / feed  
- other existing Mystash product sources  

---

## A. Current architecture

### A.1 Two parallel tracks

| Track | Who | Primary entities | Outcome |
|-------|-----|------------------|---------|
| **Create Studio** | `creatorStatus === 'ACTIVE'` | `ingest_requests` → `collections` → `videos` | Published Collection + Home reel |
| **Discover Anywhere (share import)** | Any signed-in user | `user_imports` → `content_sources` → Bag | Extracted products in Stash; **no** feed publish |

These tracks are **not unified**. Create does not use `content_sources` / `user_imports`. Share import never creates Collections or feed videos.

### A.2 Creator / curator identity

**Exists**

- Creator is a **status axis** on `users`, not a separate table.
- `CreatorStatus`: `NONE | ONBOARDING | ACTIVE | SUSPENDED`
- `isCreator(user)` ≡ `creatorStatus === 'ACTIVE'` only
- Lifecycle: `NONE → ONBOARDING → ACTIVE`; suspend/reactivate; abandon onboarding → `NONE`
- APIs: `POST /users/me/creator/start|complete|abandon`
- Canonical UI: two-step form (display name + bio → optional social) in `CreatorOnboardingPanel`, used by Create tab, Products-only, Settings `/settings/creator-onboarding`, and Profile → Create collection
- `start` runs on Continue (step 1), never on mount; `complete` runs on Become a creator (step 2) and must return `ACTIVE`
- `activateCreatorAccount` remains in `userApi` for non-UI callers; Create/Settings screens must not use it (it would skip step 2)
- `AccountType`: `personal | business` exists but is not used for product-path differences

**Missing / weak**

- **No `Curator` role / type / table.** “Curator” is legacy naming (`videos.curator_id`, UI “curator credit”).
- No KYC / social-link verification

**Key files**

- `backend/src/user/domain/types.ts`, `lifecycle.ts`, `UserService.ts`, `routes.ts`
- `components/creator/CreatorOnboardingPanel.tsx`, `src/hooks/useCreatorOnboarding.ts`, `src/ui/creatorOnboarding.ts`
- `app/settings/creator-onboarding.tsx`, `app/(tabs)/create/index.tsx`, `app/(tabs)/create/manual.tsx`
- `src/services/userApi.ts`, `src/types/creator.ts`
- `supabase/migrations/20260806200000_user_domain.sql`

### A.3 Create screen / flow

**Exists**

Tabs: Watch · Search · Create · Stash · Profile.

Create stack (`app/(tabs)/create/`):

1. Sign in (else redirect to Profile)
2. If not ACTIVE → onboarding panel
3. Paste supported YouTube / Instagram URL (+ optional collection title)
4. **Start** (AI extract) **or** **I’ll add products myself** / `manual.tsx`
5. Poll processing → review products (include/exclude, details, add links)
6. Optional story title / caption
7. Publish confirm → success → feed / collection / create another

Also: drafts hub (continue / processing / attention), discard ingest.

Share-import (separate from Create tab):

- `app/import.tsx` — share-sheet acknowledgement
- `app/shares.tsx` — share history + retry/delete

**Missing / weak**

- No blank “empty Collection” composer UI beyond API `POST /collections` with `manual_curation`
- No native video upload UI (`originType: 'native_upload'` exists in schema only)
- Create Studio does **not** use `user_imports` / `content_sources`
- Caption may not fully persist through publish (title path is stronger)

**Key files**

- `app/(tabs)/create/index.tsx`, `manual.tsx`, `review.tsx`, `_layout.tsx`
- `components/create/*`, `src/services/curation.ts`, `src/types/curation.ts`
- `backend/src/publish.ts`, `backend/src/collection/ingestBridge.ts`

### A.4 Collections

**Exists — domain**

| Type | Role |
|------|------|
| `Collection` | Recommendation package SoT: status, visibility, eligibility, origin, creator snapshot, hero thumb, etc. |
| `CollectionMedia` | External content reference + processing metadata (Collection-local) |
| `CollectionProductTag` | Ordered product appearance → **catalog** product |

Statuses include draft → processing → ready_for_review → published / unpublished / archived / deleted.  
Visibility: `public | unlisted | private`.  
Eligibility: feed/search when `published` ∧ `public` ∧ moderation clear ∧ not deleted.

Origin types: `url_ingest | manual_curation | native_upload | import_instagram | import_pinterest | ai_generated` — Create path is mainly `url_ingest`.

Publish (app): review → `publishIngestSelection` → `CollectionService.publish` → **dual-write** `videos` + `video_products` for Home.

**Missing / gaps**

- No FK from `collections` / `collection_media` → `content_sources`
- Unlisted exists in types/DB; Create publish hardcodes `visibility: 'public'`
- Product attachment in Studio goes through **ingest draft products**, then sync to tags — not through `content_source_products`
- CollectionMedia domain spec: **V1 = one primary media**; Mystash does **not** host/transcode video

**Key files**

- `backend/src/collection/domain/types.ts`, `CollectionService.ts`, `routes.ts`
- `backend/docs/COLLECTION_DOMAIN_SPEC.md`, `COLLECTION_MEDIA_DOMAIN_SPEC.md`, `COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md`
- Migrations: `20260806000000_collection_domain.sql`, `20260806120000_collection_media_external_ref.sql`, `20260806210000_collection_product_tag_domain.sql`
- UI: `components/collection/*`, `app/(tabs)/collection/[collectionId].tsx`, `app/reel/[collectionId].tsx`

### A.5 Content model

#### content_sources (Discover Anywhere)

Global processing identity: unique `(platform, external_id)`.

- Platforms: `youtube | instagram | web`
- Media kinds: `VIDEO | WEB_PAGE`
- Processing: `RECEIVED → QUEUED → PROCESSING → READY | FAILED`
- Owns candidates via `content_source_products` (optional bind to `catalog_product_id` **or** `discovered_product_id`)

**Does not** first-class own thumbnails, embed URLs, or permalinks as media assets.

#### user_imports

Per-user share submissions linking to a `content_source_id`. Status is effectively `RECEIVED`; progress is derived from the content source. Feeds Bag / Product Page / Shares UI — **not** Collections or Home.

#### Collection / feed media (Create path)

| Store | Media fields |
|-------|----------------|
| `collection_media` | `external_id`, `canonical_url`, `source_url`, `embed_url`, `thumbnail_url`, `source_provider`, `media_kind`, `provider_creator_*`, `source_published_at`, sync timestamps |
| `videos` (feed projection) | `url`, `embed_url`, `thumbnail`, `collection_id`, `curator_id`, `video_title` |
| `ingest_requests` | `source_url`, `platform`, `thumbnail`, `video_title`, `collection_id` |

**Playback:** always embedded WebView (YouTube / Instagram) — `YouTubeReelItem` / `InstagramReelItem`. No first-party hosted video pipeline in Create.

**Missing**

- Bridge `ingest_requests` ↔ `content_sources` (duplicate extraction stacks)
- User imports never create Collections / feed videos
- No TikTok in Create (collection_media may hint tiktok from URL backfill only)

### A.6 Product architecture

**Identity layers**

| Layer | Table / type | Role |
|-------|----------------|------|
| Catalog SoT | `catalog_products` | Global commerce identity |
| Discovered staging | `discovered_products` | Non-catalog from user content; not Bag |
| URL preview cache | `canonical_products` | Deduped PDP preview by URL — **not** catalogue |
| Creator drafts | `ingest_draft_products` | Per-ingest AI/manual candidates |
| Feed projection | `video_products` | Dual-write from Collection publish |

**How products enter**

| Path | Behavior |
|------|----------|
| Creator URL ingest | Extract → drafts → `resolveIngest` **promotes on miss** → catalog |
| Manual product URLs | Enrich → drafts → catalog |
| User share (Reel/Short/web PDP) | `resolveForUserImport` → catalog **hit** or discovered |
| Search / PI | Resolver + search strategies |

**Attachment**

- Collections: N `collection_product_tags` per collection; **catalog only**; `selectionSource` includes `AI_DETECTED | CREATOR_MANUAL | IMPORT | SYSTEM | …`
- Content sources: N `content_source_products` per source (import cap default 3)
- Bag: catalog **XOR** discovered + source attribution fields

**Shopping / affiliate**

- `ShoppingResolver`: configured → affiliate (if enabled) → preferred → merchant
- Affiliate: stored `affiliate_url` / stubs; live network minting not wired
- Live merchant pricing exists (`MerchantPricingService`)
- `ShoppingConfiguration` explicitly comments **future Campaign/Brand adapters**

**Missing**

- Brand / campaign / advertiser entities
- Brand product feed API
- Collection ↔ discovered attach
- Productized discovered → catalog promotion workflow (column exists; not productized)

### A.7 Account linking / OAuth

**Exists:** Supabase Auth (+ Google OAuth) for Mystash users only.

**Missing:** Instagram Professional/Creator OAuth, YouTube channel OAuth, `connected_accounts`, token vault, refresh/revoke, sync cursors, webhook subscriptions. All content ingress today is **URL-based**.

### A.8 Home / Watch

- Home: `app/(tabs)/index.tsx` → `fetchVideos()` → `videos` table ordered by `created_at`
- Player: `ReelItem` → platform WebViews + overlays / product shelf
- Feed eligibility lives on Collection, but feed **reads `videos`**, not Collections directly
- Imports / future synced library content **do not** appear unless someone publishes a Collection

### A.9 Public profile

- Public: `app/creator/[username].tsx` — tabs **collections | products**
- Personal: collections + saved; Create entry via `PersonalCreateCollectionCard`
- Discover creators: seeded from Home `videos` stream (not a recs service)
- **No posts/reels entity or tab**

---

## B. Existing reusable components / services

| Layer | Reuse for |
|-------|-----------|
| `UserService` + creator lifecycle routes | Onboarding gate; `assertCanCreateCollections` |
| `CollectionService` (+ media + tags + publish) | Recommendation package SoT; attach media; publish eligibility |
| `ContentSourceService` + Processor + Resolution | Global content identity + extract candidates (any URL path) |
| `UserImportService` + shares UI | Curator paste-public-URL capture + progress UX |
| `ProductResolver` (`resolveIngest` vs `resolveForUserImport`) | Match any draft/SKU; promote vs discover policy branch |
| `DiscoveredProductService` | Staging identity before catalog promotion |
| Merchant enrichment + `MerchantPricingService` | Manual/affiliate URL → fields + live prices |
| `ShoppingResolver` + `ShoppingConfiguration` | Campaign buy-URL injection seam (file-backed today) |
| Create Studio UI (review, publish ritual, drafts) | Stepper shells; product include/exclude; publish confirm |
| `CreatorProfile` + `CollectionScreen` + `ReelItem` | Public surfaces without a second profile system |
| `ingestBridge` / `publishVideoProjection` | Bridge until feed reads Collections directly |

---

## C. Existing data models that can support the future

**Principle:** Prefer extending existing entities over parallel tables.  
Content identity ≠ Collection attachment ≠ Product identity ≠ Commercial relationship.

| Need | Existing fit | Gap to close |
|------|--------------|--------------|
| Creator identity | `users.creator_status` + public profile | Richer onboarding; optional curator capability flag (not a second user table) |
| Global content identity | `content_sources` `(platform, external_id, canonicalUrl)` | Media metadata (thumb, permalink, published_at, media_type) or linked cache |
| Collection ↔ content attach | `collection_media` (external refs + sync fields) | Optional FK/ref to `content_sources`; multi-media later if needed |
| Synced library membership | None as first-class library | User/account ↔ `content_source` membership + sync state (**new, thin**) |
| Product identity | `catalog_products` | Keep agnostic; promote discovered when publishing to Collection |
| Product provenance / candidates | `content_source_products` + tag `selectionSource` + `evidenceRefs` | Extend selection/commercial source later — **not** new product SoT |
| Multi-product per content | Tags N:1 collection; CSP N:1 source | Policy: attach products to Collection (optionally pin to media later) |
| Feed distribution | `Collection.feedEligible` + `videos` projection | Eventually feed from Collections; keep projection until then |
| Campaign buy destination | `ShoppingConfiguration` adapter comment | Brand/campaign entities later; inject via configured buying URL |

### Creator vs curator on one content model

Both paths should resolve to the **same** `content_sources` identity, then attach via `collection_media` into a Collection owned by the Mystash user.

| Role behavior | Ingress | Shared entities |
|---------------|---------|-----------------|
| Creator (owned) | Connected account sync → library → select | `content_sources` + library membership + `collection_media` |
| Curator (public) | Paste public Reel/Short URL → import/reference | Same `content_sources` + `collection_media` (no ownership claim) |

Do **not** fork `creator_media` vs `curator_media` tables. Ownership / curation intent lives on membership + `Collection.origin*`, not on a second content type.

### Synced content field mapping (future → existing)

| Needed field | Existing support |
|--------------|------------------|
| platform | `content_sources.platform`; `collection_media.source_provider` |
| external media ID | `content_sources.external_id`; `collection_media.external_id` |
| creator/account ID | `collection_media.provider_creator_id` (partial); connected account model **missing** |
| permalink / canonical | `content_sources.canonical_url`; `collection_media.canonical_url` / `source_url` |
| title / caption | `collection_media.title`; Collection title/caption |
| thumbnail | `collection_media.thumbnail_url`; videos.thumbnail; **not** on content_sources |
| media/video reference | `collection_media.embed_url` (when permitted); playback derived at play time |
| published timestamp | `collection_media.source_published_at` |
| media type | `content_sources.media_kind`; `collection_media.media_kind` |
| sync status / cursor | **Missing** (need on connected account / sync run) |

**Important domain constraint** (`COLLECTION_MEDIA_DOMAIN_SPEC`): CollectionMedia is Collection-local and must not become a shared media library. Cross-collection reuse of extract work belongs in a cache keyed by `(provider, external_id)`. Synced **library** therefore belongs on `content_sources` + membership — not by sharing `collection_media` rows.

---

## D. Missing pieces

### Hard gaps (required for target architecture)

- Connected accounts (Instagram Professional / YouTube channel)
- Encrypted token vault + refresh / revoke
- Sync state, cursors, `last_sync_at`
- Creator content library (membership of `content_sources`)
- Bridge Create Studio ↔ `content_sources` (end dual extract)
- Multi-source product attach UX contracts
- Brand / Campaign / brand-product-feed models (later — Phase 7)
- Create stepper entry (mode choose → content → products → …)

### Soft gaps (present but incomplete)

- `content_sources` lacks playback / thumbnail fields
- CollectionMedia V1 = one primary media
- Collections catalog-only (no discovered tags)
- Feed still reads `videos`, not Collections
- Unlisted publish unused by Create
- Affiliate network live minting (stub / stored URL only)
- Discovered → catalog promotion productized job
- Profile “posts/reels” surface (collections only today)

### External API / policy verification required

**Do not assume capabilities.** Before Phases 2–3, verify:

- Instagram Graph API (Professional/Creator scopes, media listing, Reels fields, embed ToS, token lifetimes)
- YouTube Data API (channel OAuth, uploads/search.list, Shorts identification, quota)
- Platform rules for in-app WebView vs official players
- Brand feed formats and who owns GTIN/SKU mapping

Label any implementation item that depends on these as **VERIFY FIRST**. Degrade path: public URL paste (already works).

---

## E. Risks / architectural debt

| Risk | Why it hurts | Mitigation direction |
|------|--------------|----------------------|
| Dual extraction stacks | `ingest_requests` vs `content_sources` diverge; duplicate cost/bugs | Phases 0–3: Create path resolves `content_source` first |
| Promote-on-miss asymmetry | Creator always catalogs; user import must not — easy misuse | Explicit resolve policy enum; promote only on Collection publish |
| Three “product” tables | `canonical_products` vs catalog vs discovered naming confusion | Document SoT: catalog = identity; discovered = staging; canonical = URL cache |
| `videos` dual-write | Feed can drift from Collection SoT | Keep projection temporary; Phase 6 move reads toward Collections |
| CollectionMedia “not a library” | Spec forbids shared media rows; synced library needs membership elsewhere | Library = `content_sources` + user/account links; CollectionMedia stays attach |
| Platform capability assumptions | IG/YT may block listing, playback, or commercial use | VERIFY FIRST gates; degrade to public URL paste |
| Brand product fork temptation | Separate `brand_products` table splits catalog forever | Ingest brand feeds into `catalog_products` + provenance/campaign edges |
| Products on media vs collection | User wants content↔products; tags hang on Collection today | Keep Collection as package; optional `media_id` on tag later if needed |

---

## F. Target architecture

```text
USER
 ├── Creator / Curator capability (status + flags — one identity)
 ├── Connected Accounts (IG / YT) — auth only
 ├── Content Library — membership of content_sources
 │     ├── owned / synced
 │     └── public / curated
 └── Collections
       ├── Content attachments (collection_media → content identity)
       └── Product attachments (collection_product_tags)
              └── Product
                    ├── catalog identity (catalog_products)
                    ├── discovery / provenance
                    └── commercial source / campaign

BRAND (later)
 └── Campaigns
      └── Products (catalog ids)
           ↓
      Creator / Curator product attachments
```

### Conceptual separations (freeze these)

| Layer | Owns | Must not own |
|-------|------|--------------|
| Product identity | `catalog_products` | Creator, platform, campaign, collection |
| Product source / provenance | How we learned it (extract, URL, feed, campaign) | Buy destination; Collection order |
| Commercial relationship | Campaign, affiliate, brand feed contract | Product name/identity |
| Collection attachment | Tag: which product in which Collection, strength, note | Global product row |
| Content identity | `content_sources` (platform + external id) | Products; Collection lifecycle |
| Content attachment | `collection_media` (Collection-local ref + processing) | Shared library membership |
| Account linking | OAuth tokens, scopes, revoke | Playback; product extract |
| Content sync | Cursor, last sync, library rows | Token crypto; Collection publish |

### Multi-source products — one attachment model

All sources resolve to `catalog_products` (promoting `discovered_products` if needed), then `CollectionProductTag` with `selectionSource` / commercial metadata:

| Source | Notes |
|--------|--------|
| A. Extracted from content | Via content_source / ingest extract |
| B. Manual / affiliate URL | Merchant enrichment → resolve |
| C. Brand campaign | Campaign edge → catalog id |
| D. Brand-uploaded product | Same catalog ingest path |
| E. Brand API / feed | Feed → catalog pipeline |

---

## G. Phased implementation plan

UI redesign is out of scope until the named Create/phase work. Do not implement in this audit.

### Create stepper — reuse map

| Desired step | Exists today | Phase |
|--------------|--------------|-------|
| 1 What are you creating? | Implicit (URL-first studio only) | 1 |
| 2 Add content (IG / YT / paste) | Paste URL only; no linked accounts | 2–3 |
| 3 Add products | AI extract + manual URLs in review/manual | 4 |
| 4 Arrange | Tag toggles / order limited | 5 |
| 5 Collection details | Title/caption on review | 5 |
| 6 Preview | Embed preview in review | 5 |
| 7 Publish | PublishConfirmSheet + dual-write | 5–6 |

---

### Phase 0 — Foundation / data contracts

**Status:** Delivered — see [`creator-ecosystem-phase-0-contracts.md`](./creator-ecosystem-phase-0-contracts.md) and `backend/src/creator-ecosystem/contracts.ts`.

**Objective:** Freeze boundaries so later phases cannot fork product or content identity.

**Exact scope**

- Document contracts: ContentIdentity (`content_sources`), ContentAttachment (`collection_media`), ProductIdentity (catalog), Provenance, CollectionTag, CommercialSource (stub enum only)
- Decide Create Studio will resolve/create `content_sources` before extract (bridge design; no full rewrite yet)
- Inventory `selectionSource` extensions needed for `CAMPAIGN` / `BRAND_FEED` (enum design only)
- List VERIFY FIRST platform API checklist for IG/YT

**Reuse:** `COLLECTION_*_DOMAIN_SPEC.md`, content-source domain types, CollectionProductTag `selectionSource`, ShoppingConfiguration adapter seam  

**New only if genuinely necessary:** Thin design doc + enum stubs — no new tables required yet  

**Dependencies:** None  

**Migration considerations:** No production migration required; additive enum docs only  

**Must remain unchanged:** Publish path, Bag, Home `videos` read, brand web  

**Validation criteria**

- Architecture doc reviewed: no `brand_products` table proposed
- Clear matrix: creator vs curator both → `content_sources`
- VERIFY FIRST list attached to Phases 2–3

---

### Phase 1 — Creator onboarding + redesigned Create entry

**Status:** Delivered — CreateMode entry (`my_content` \| `curate_public` \| `products_only`) on Create index; see `src/ui/createMode.ts`, `components/create/CreateModeSwitch.tsx`.

**Objective:** Clarify creator activation and Create entry modes without OAuth or brand work.

**Exact scope**

- Two-step onboarding (profile then optional social); `ONBOARDING` starts on Continue, not on mount
- Create entry: choose My content | Curate public | Products/collection-only (contracts + IA; minimal shell OK)
- Reuse existing paste-URL + manual product paths behind entry modes
- Do **not** redesign review/publish UI yet

**Reuse:** `CreatorOnboardingPanel`, `UserService` start/complete/abandon, `app/(tabs)/create/*`, `createCopy` / `createDraftSegments`  

**New only if needed:** `CreateMode` type + routing shell; optional capability flag for “can curate public” if product wants non-ACTIVE users later  

**Dependencies:** Phase 0 contracts  

**Migration:** Possibly none; user columns only if capability flags added  

**Must remain unchanged:** `ingest_requests` pipeline, Home feed, share-import Bag path  

**Validation criteria**

- ACTIVE creator can enter Create modes
- Non-creator still gated
- Existing URL ingest still works from My/Curate paste path

---

### Phase 2 — Instagram / YouTube account linking

**Status:** Delivered (VERIFY-gated) — see [`creator-ecosystem-phase-2-verify.md`](./creator-ecosystem-phase-2-verify.md) (docs gate labeled VERIFIED / NOT VERIFIED / BLOCKED / UNKNOWN; **flags remain off**), `backend/src/connected-accounts/`, migration `20260925180000_connected_accounts.sql`.

**Objective:** Auth/linking only — separate from sync and playback. **VERIFY FIRST.**

**Exact scope**

- OAuth abstraction + `connected_accounts` model
- Platform account id, scopes, encrypted tokens, refresh, disconnect/revoke
- UI: connect / disconnect / re-auth status on Create or Settings
- No media sync yet beyond “connection healthy” probe if API allows

**Reuse:** Supabase Auth patterns for Mystash sessions only (do **not** overload for platform tokens); user settings surfaces  

**New only if needed:** `connected_accounts` table, token vault (encrypted at rest), OAuth callback routes + provider adapters  

**Dependencies:** Phase 0; VERIFY Meta IG Graph + Google YT OAuth apps, scopes, policies  

**Migration:** New `connected_accounts` (+ secrets store); no change to `content_sources` yet  

**Must remain unchanged:** content_sources processing, Collection publish, playback still URL/embed based  

**Validation criteria**

- Connect + disconnect + re-auth work for at least one verified provider
- Tokens never logged; revoke clears local secrets
- Create still works via paste if link fails

---

### Phase 3 — Synced creator content library

**Status:** YouTube sync delivered behind `CONNECTED_ACCOUNTS_YOUTUBE_ENABLED`. Instagram sync remains policy-blocked. Library membership is `creator_library_memberships`; identity stays `content_sources`. Selecting a library item into a Collection is Phase 5.

**Objective:** Synced Reels/Shorts enter `content_sources`; user gets a selectable library.

**Exact scope**

- Sync job: list media from connected account → upsert `content_sources`
- Store/sync: platform, external id, account id, permalink, title/caption, thumbnail, media type, published_at, sync status
- Library membership rows (user/account ↔ content_source)
- Create Step 2: pick from library **or** paste public URL (curator)
- Playback still via embed derivation — no hosting

**Reuse:** `ContentSourceService.getOrCreate`, `collection_media` field shapes for thumb/permalink metadata, UserImport URL normalize for curator paste, video extraction cache where applicable  

**New only if needed:** `content_library_items` or `connected_account_media` membership; optional content_source media metadata columns **or** side cache table; `sync_runs` / cursor fields on connected_accounts  

**Dependencies:** Phase 2; VERIFY media list fields & rate limits  

**Migration:** Additive tables/columns; backfill none required; do **not** delete `ingest_requests` yet — dual-run bridge  

**Must remain unchanged:** Bag import path semantics, product identity tables, Home still from published Collections  

**Validation criteria**

- Same Reel synced twice = one `content_source`
- Curator paste of same URL hits same identity
- Library list shows thumb + permalink; select creates draft Collection attachment plan

---

### Phase 4 — Multi-source product attachment

**Status:** Creator library items can list, attach, and remove existing catalog or discovered products on `content_source_products` (`attachment_source = CREATOR_MANUAL`). No Collection is created. Brand/campaign provenance stays reserved.

**Objective:** Attach products from extract, URL, and (stub) campaign/brand sources without new product SoT.

**Exact scope**

- Unify candidate intake → ProductResolver policy → catalog (or discovered then promote-on-publish)
- Extend `selectionSource` / provenance for `CAMPAIGN | BRAND_FEED | AFFILIATE_URL` (as needed)
- Create Step 3: detected + manual/affiliate URL; campaign picker stubbed or feature-flagged empty
- Ensure N products per Collection; optional pin to media id if multi-media not ready

**Reuse:** `ProductResolver`, `content_source_products`, `manualProductAppend` / merchant enrichment, CollectionProductTag APIs, `DiscoveredProductService`  

**New only if needed:** Promote-on-publish helper (discovered → catalog); CommercialSource metadata on tag or side table (**not** `brand_products`)  

**Dependencies:** Phases 0–1; Phase 3 preferred for extract-from-selected-content  

**Migration:** Enum / column additive; no brand tables yet; Collections remain catalog-only at publish  

**Must remain unchanged:** `catalog_products` as only publishable product identity; ShoppingResolver destination order (except future campaign adapter)  

**Validation criteria**

- Extract + manual URL both produce CollectionProductTags
- No duplicate catalog rows for same merchant URL identity
- Campaign stub does not create a second product table

---

### Phase 5 — Collection builder + publish

**Status:** A library item can be copied into a new or existing Collection (`collection_media` + `collection_product_tags`) and published with the existing publish route. Discovered products are copied but stay out of publish until they have a catalog id.

**Objective:** Steps 4–7 — arrange, details, preview, publish on Collection SoT.

**Exact scope**

- Arrange content + products (order, primary tag, `includeInPublish`)
- Collection details (title, caption, intent, visibility)
- Preview + existing publish ritual
- Bridge: selected library items → `collection_media`; tags from Phase 4
- Retire Create-only dependence on ingest draft as SoT (ingest may remain worker)

**Reuse:** `CollectionService` create/publish/attach, `PublishConfirmSheet` / `PublishSuccessScreen`, ingestBridge patterns, eligibility `feedEligible` rules  

**New only if needed:** Builder state machine / draft Collection as SoT for Create; multi-media only if product requires >1 content per Collection (else keep V1 1:1)  

**Dependencies:** Phases 3–4  

**Migration:** Prefer writing Collections earlier in Create; migrate drafts carefully; keep `videos` dual-write on publish  

**Must remain unchanged:** Public Collection page + `/reel/[collectionId]` contracts; feed eligibility rules  

**Validation criteria**

- Publish creates feed-eligible Collection + videos projection
- Creator profile lists new Collection
- Products shoppable on Collection + reel shelf

---

### Phase 6 — Home / Watch integration + feed performance

**Status:** Published Collections, including library copies, upsert the existing `videos` projection on the Collection publish route. Home reads a thumbnail-first page of that projection and mounts one embed player for the active reel. Instagram stays embed/WebView.

**Objective:** One feed model for imported, synced, and curated **published** content; improve startup without redesigning feed UX.

**Exact scope**

- Confirm all published paths share Collection → (projection) → Home
- Prefer thumbnail-first paint; defer WebView; reuse synced thumbnails from library/metadata
- Plan collection-first feed read (or harden projection sync)
- No ranking algorithm rewrite required

**Reuse:** `ReelItem` / YT / IG players, `fetchVideos` + engagement, `Collection.heroThumbnailUrl` / `collection_media.thumbnailUrl`  

**New only if needed:** Feed query from `feed_eligible` Collections if projection retired; startup metrics hooks  

**Dependencies:** Phase 5  

**Migration:** If switching SoT: dual-read period; backfill `videos.collection_id` completeness  

**Must remain unchanged:** Visual Home UX redesign (explicitly out of scope); WebView embed approach unless platform VERIFY forces change  

**Validation criteria**

- Synced-origin and paste-origin Collections both appear when published
- Thumb visible before embed ready
- No separate feed tables for curator vs creator

---

### Phase 7 — Brand campaigns / products / API integration

**Status:** Brands, campaigns, and `campaign_products` point at `catalog_products`. A brand feed dedupes into that catalog. Eligible creators can attach those offerings onto a library item, which copies onto a Collection tag with the same catalog id. Affiliate provenance stays reserved. The brand portal is not built.

**Objective:** Brand → campaign products → creator attach; brand feed into catalog pipeline. **No separate brand product SoT.**

**Exact scope**

- Brand org + Campaign + `campaign_products` (FK to `catalog_products`)
- Optional eligibility rules for creators
- Brand product API/feed → catalog ingest (verification/provenance)
- Creator product picker: available campaign products
- ShoppingConfiguration Campaign adapter for buy URLs
- Brand web portal is a separate deliverable — API contracts first

**Reuse:** `catalog_products` + `ProductResolver`, CollectionProductTag + `selectionSource`, ShoppingConfiguration / `product_clicks`, merchant enrichment patterns for feed normalization  

**New only if needed:** `brands`, `campaigns`, `campaign_products`, `brand_feed_runs`; creator-facing campaign catalog list API  

**Dependencies:** Phases 4–5; brand portal can lag API  

**Migration:** New brand BC tables; catalog rows created/updated by feed — never `brand_products` as SoT  

**Must remain unchanged:** Product page dual subject model; Collection publish eligibility; content identity model  

**Validation criteria**

- Campaign product attaches as CollectionProductTag → same catalog id
- Feed SKU dedupes to existing catalog when identity matches
- Creator can publish Collection mixing extract + campaign products

---

## Appendix — Key file anchors

**Backend domains:** `backend/src/{user,collection,content-source,user-import,discovered,product-intelligence,shopping,merchant-pricing}/`  

**Create / publish:** `app/(tabs)/create/*`, `backend/src/publish.ts`, `backend/src/collection/ingestBridge.ts`  

**Feed / profile:** `app/(tabs)/index.tsx`, `components/ReelItem.tsx`, `app/creator/[username].tsx`, `components/creator/*`  

**Specs:** `backend/docs/COLLECTION_DOMAIN_SPEC.md`, `COLLECTION_MEDIA_DOMAIN_SPEC.md`, `COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md`, user-ingestion docs under `docs/mystash-user-ingestion-*.md`  

**Migrations:** `20260806*` collection/user, `202609201*` content_sources / user_imports / discovered_products  

---

*End of audit. No implementation in this document.*
