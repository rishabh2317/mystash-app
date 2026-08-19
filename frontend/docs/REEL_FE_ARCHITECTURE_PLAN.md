# PHASE 4A — REEL FE ARCHITECTURE PLAN (Canonical Reel)

**Status:** Planning only — no implementation, migrations, commits, or pushes.  
**Baseline:** Code audit of the current Expo/RN Reel stack + `frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md`  
**Hard constraint:** The existing **Home Reel Feed** must remain functionally and visually unchanged. Any future abstraction must be behavior-preserving for Home.

---

## 1. Current Reel architecture audit

### 1.1 What exists today

| Layer | Location | Role |
|-------|----------|------|
| Home Feed host | `app/(tabs)/index.tsx` | Vertical paging `FlatList` of reels; viewability → `isActive`; loads `Video[]` via `fetchVideos()` |
| Reel composer | `components/ReelItem.tsx` | Validates/transforms URL → routes to YouTube or Instagram; composes media + `Header` + `BottomDock` |
| YouTube media | `components/YouTubeReelItem.tsx` | Thumbnail → fade → WebView HTML iframe; mute bridge via injectJS |
| Instagram media | `components/InstagramReelItem.tsx` | Same facade pattern; Instagram embed HTML |
| Chrome | `components/Header.tsx`, `components/BottomDock.tsx` | Brand header; title / curator / stash score / product chips / View More |
| View All Products | `app/product-list/[id].tsx` | Loads video by id; list + constrained embed of YT/IG media |
| Feed data | `src/services/supabase.ts` → `videos` + `video_products` (+ catalog join) | Legacy `Video` / `Product` models in `src/mocks/videos.ts` |
| Platform utils | `src/utils/videoUtils.ts`, `youtubeWebViewEmbed.ts`, `instagramWebViewEmbed.ts` | Detect platform, embed URL, WebView HTML |

### 1.2 Composition today (Home)

```text
HomeScreen (FlatList host)
  └── ReelItem(video: Video, isActive, onBuyPress)
        ├── URL validate / embed_url transform
        ├── YouTubeReelItemWrapper | Instagram branch
        │     └── YouTubeReelItem | InstagramReelItem  (media only)
        ├── Header
        └── BottomDock(video, router, volume?)
              └── ProductCardFrame chips (presentation-only)
              └── View More → /product-list/${video.id}
```

### 1.3 What is *not* a separate Reel product today

There is **one** full-screen Reel presentation path used by Home (`ReelItem`).  
`product-list` reuses **media-only** YT/IG components in a non–full-screen box — not a second Reel architecture.

There is **no**:

- `/reel/[collectionId]` focused host  
- HomeReel / CreatorReel / SearchReel forks  
- Save / Follow / Cart UI on the Home dock  
- Press handlers on dock product chips (chips are non-interactive)  
- Wiring from `CollectionTile` → Reel (Creator Profile stubs “Coming soon”)

### 1.4 Domain reality (dual-write)

On publish (`backend/src/publish.ts`), **`videoId === publishedCollection.id`**.  
Home still reads the legacy `videos` / `video_products` projection. Collection domain (`GET /collections/:id` aggregate = collection + media + tags) is the SoT for Collection/media/tags, but the Feed UX still consumes the video dual-write.

---

## 2. Existing reusable components

**Reuse as-is (canonical media + chrome building blocks):**

| Component | Reuse verdict |
|-----------|----------------|
| `YouTubeReelItem` | **Canonical YouTube media primitive** — already presentation-only (playback facade) |
| `InstagramReelItem` | **Canonical Instagram media primitive** |
| Embed HTML builders + `videoUtils` | **Canonical platform adapters** |
| `Header` | Reusable brand chrome for full-screen Reel (Home + focused) |
| `BottomDock` | Reusable dock chrome; today Video-coupled — keep visual design; later accept a dock projection |
| `ReelItem` | De-facto composer; closest to “Canonical Reel” — should become the single composer after a thin model adapter, **not** replaced by surface-named Reels |
| `CollectionTile` | Entry from Creator / Search / Saved — opens focused host, does not embed Reel |
| `ProductCard` / `ProductDetailsSheet` | Canonical Product FE — used from View All / sheets; **not** dock chips until Phase 8 parity |
| `useProductBuyHandler` / `useProductAddToCartHandler` | Action orchestration for Product callbacks |

**Do not duplicate:**

- Separate WebView players per surface  
- Surface-named Reel products (`HomeReel`, `CreatorReel`, …)

---

## 3. Current dependencies

### 3.1 Data

| Consumer | Source | Model |
|----------|--------|--------|
| Home Feed | Supabase `videos` + `video_products` | `Video` + `Product[]` |
| product-list | `fetchVideoById` (+ mock fallback) | same |
| Creator grid | `GET /collections?creator_id=` | `CollectionViewModel` (tile only; no media/products) |
| Focused Reel | **Missing FE client** for `GET /collections/:id` aggregate | Backend aggregate exists |

### 3.2 Navigation

| From | To | Notes |
|------|----|--------|
| Home dock View More | `/product-list/[video.id]` | Protected UX |
| Creator `CollectionTile` | *(stub)* | Phase 4 target: focused Reel host |
| Search Collection hit | *(not wired to open)* | Same focused host |
| Reel → Creator profile | **Not wired** | Dock shows `curator_id` / `creator_name` as text only |
| Reel → Product details | **Not wired on dock** | Only via product-list |

### 3.3 Actions today

| Action | Home Reel | product-list | Notes |
|--------|-----------|--------------|-------|
| Buy / shopping | `onBuyPress` passed into ReelItem → media props | Local Buy Now → `openProductShopping` | **`onBuyPress` is unused inside YT/IG media** — dead prop |
| Add to Cart | — | Mock `console.log` in inline ProductCard | Not canonical Cart boundary |
| Save Collection | — | — | Engagement API exists BE; **no FE save on Reel** |
| Follow Creator | — | — | FE Follow exists on Creator Profile only |
| Volume | YouTube via BottomDock + WebView bridge | — | Instagram toggle is stub |

### 3.4 Coupling problems (for abstraction, not redesign)

1. **`ReelItem` / dock / media typed on legacy `Video`** — blocks Collection-native hydration without a mapper.  
2. **`BottomDock` owns `router.push` for View More** — host should inject navigation.  
3. **Product dock uses private `ProductCardFrame`**, not canonical `ProductCard` — intentional until Phase 8.  
4. **Feed host owns timeline concerns** (paging, active index, refresh) mixed with buy handler that never fires from media.

---

## 4. Canonical Reel model / contract

### 4.1 Principle

**One Canonical Reel presentation** driven by a **Reel session / view model**, fed by hosts.  
Hosts differ (timeline vs single Collection); the Reel does not fork by surface.

### 4.2 Answers to contract questions

#### 1. What is the canonical Reel input/model?

**`ReelViewModel`** (name illustrative) — a FE presentation model, **not** a new backend entity:

```text
ReelViewModel
  collectionId          // SoT id (= video.id under dual-write)
  title                 // video_title | collection.title
  heroThumbnailUrl
  creator: {
    id?                 // UUID when known
    handleOrName        // display string for dock (today curator_id | creator_name)
    username?           // for /creator/[username] when available
  }
  qualityScore?         // stash_score / quality_score display
  primaryMedia: {
    platform: 'youtube' | 'instagram' | 'unknown'
    sourceUrl
    embedUrl?
    thumbnailUrl
    externalId?
  }
  products: ReelProductChip[]   // ordered; dock + View All seed
  // optional engagement display signals later (saved?, counts)
```

**`ReelProductChip`** (dock / list bridge):

```text
id                    // tag id or video_products row id
catalogProductId?
name
price                 // display string
imageUrl
provider?
```

Mappers (host-owned or shared):

- `mapVideoToReelViewModel(Video)` — **identity for Home** (must preserve current fields/UX)  
- `mapCollectionAggregateToReelViewModel(CollectionAggregate + creator projection)` — focused host  

#### 2. What information does a Reel require?

**Required to render media + dock hierarchy:**

- Playable primary media (platform + url/embed + thumbnail)  
- Collection/video id (for View All route)  
- Title string  
- Creator display string  
- Ordered products (may be empty — dock hides chips today when empty)

**Optional / Phase 8+:** creator UUID/username for Follow/profile nav; saved state; stash/quality score (already shown); product press → details.

#### 3. How are Instagram/YouTube/platform-specific media handled?

**Inside Canonical Reel only**, via existing primitives:

```text
platform from primaryMedia / URL detect
  → YouTubeReelItem(isActive, embed, thumbnail, webViewRef?)
  → InstagramReelItem(isActive, embed, thumbnail)
  → unsupported / invalid fallback UI (already in ReelItem)
```

Hosts **never** embed WebViews directly (except product-list’s constrained preview, which already reuses the same media components).

#### 4. How does a Reel obtain its Collection context?

**Host provides it.** Reel does not fetch.

| Host | Context source |
|------|----------------|
| Home Feed | Timeline item already is the Collection dual-write (`Video.id`) |
| Focused Collection | Route param `collectionId` → fetch aggregate → map to `ReelViewModel` |
| Search / Saved | Navigate to focused host with `collectionId` (same as Creator) |

#### 5. How does it obtain ordered Products?

| Host | Source |
|------|--------|
| Home | `video.products` from `video_products.sort_order` + catalog join |
| Focused | Collection tags filtered to publish-surface / included, ordered by `sortOrder`; display from snapshots + `catalogProductId` |

View All continues to use `/product-list/[id]` with **same id** (dual-write). Longer-term may hydrate from Collection tags + catalog — **without** changing the route’s role.

#### 6. How are ProductCard actions provided?

- **Dock chips (V1 / protected):** remain `ProductCardFrame`-style presentation. Actions optional later via host-injected `onProductPress` — **do not** force canonical `ProductCard` into dock in Phase 4.  
- **View All / sheets:** canonical `ProductCard` / `ProductDetailsSheet` emit `onPress` / `onAddToCart` / `onBuy`; parents use `productActionOrchestration`.

#### 7. How are Save / Follow / Cart / Buy actions injected?

**Injection from host (composition), never Reel-owned domain APIs:**

```text
ReelActions (optional callbacks)
  onViewAllProducts(collectionId)
  onCreatorPress?(creator)
  onProductPress?(product)
  onSave?(collectionId)          // auth-gated by host/orchestration
  onFollow?(creatorId)           // auth-gated
  onBuy?(product)                // shopping redirect orchestration
  onAddToCart?(product)          // cart boundary + auth intent
  onVolumeToggle? / volume state // media bridge — may stay internal to YouTube wrapper
```

Reel / BottomDock **present** controls only when callbacks are provided (Home Phase 4A–7: may omit Save/Follow to preserve UX). Phase 8 may wire without changing visual hierarchy.

#### 8. Reel vs host responsibilities

| Belong to **Canonical Reel** | Belong to **Host** |
|------------------------------|--------------------|
| Full-screen layout: media + Header + BottomDock | Fetch / map data to `ReelViewModel` |
| Platform media selection + active playback facade | Timeline vs single-item session |
| Dock visual hierarchy (title, creator text, score, chips, View More chrome) | Paging, viewability, pull-to-refresh |
| Invalid/unsupported media fallbacks | Auth gates + action-intent resume |
| Optional volume bridge for YouTube | Navigation (View All, Creator, Login) |
| | Cart / Engagement / Shopping side effects |
| | Feed ranking / Search ranking |

#### 9. What should Home Feed provide?

- Ordered `ReelViewModel[]` (today: map from `Video[]` 1:1)  
- `activeIndex` / `isActive`  
- Refresh / empty / error UX (unchanged)  
- Optional `ReelActions` — **default = current behavior only** (View More via id; no new buttons)  
- Must **not** become Collection-fetching in Phase 4; keep `fetchVideos()` until Phase 8

#### 10. What should a focused Collection Reel provide?

- Route: **`/reel/[collectionId]`** (aligns with FE_DOMAIN OD-1 recommendation)  
- Load one Collection aggregate → `ReelViewModel`  
- Render **same** Canonical Reel with `isActive=true`  
- Back navigation to previous surface  
- Same View All destination `/product-list/[collectionId]`  
- Wire `ReelActions` as needed (Save/Follow later phases OK)  
- **Must not** open Home FlatList or redesign dock

#### 11. How can Search / Creator / Saved open the same Reel architecture?

```text
CollectionTile / Search hit / Saved row
  → router.push(`/reel/${collectionId}`)
  → FocusedReelHost
  → Canonical Reel (same component tree as Home item)
```

No SearchReel / CreatorReel implementations.

#### 12. Presentation-only vs domain-owned

| Presentation-only (FE Reel) | Domain-owned (services / BE) |
|-----------------------------|------------------------------|
| Layout, theme, WebView facade, dock chrome | Collection aggregate, media refs, tags |
| Mapping DTOs → `ReelViewModel` | Catalog product SoT |
| Emitting UI events | Engagement Save/Follow |
| | Cart persistence |
| | Shopping redirect / click logging |
| | Feed listing / ranking |

---

## 5. Canonical Reel component hierarchy

```text
ReelHost (surface-specific)
  ├── HomeReelHost     = existing FlatList in app/(tabs)/index.tsx
  └── FocusedReelHost  = app/reel/[collectionId].tsx (to add in Phase 4B)

        │  provides: ReelViewModel | ReelViewModel[], isActive, ReelActions

        ▼

CanonicalReel  (= evolved ReelItem; single composer)
  ├── MediaLayer
  │     ├── YouTubeReelItem
  │     └── InstagramReelItem
  ├── Header                 (brand chrome)
  └── BottomDock             (metadata + chips + View More)
        └── ProductCardFrame (protected dock visual; not a separate Product architecture)
```

**Forbidden product architectures:** `HomeReel`, `CreatorReel`, `SearchReel`, `CollectionReel` as divergent trees.  
**Allowed:** thin **hosts** that only differ in data loading and which actions they pass.

---

## 6. Host / context responsibilities

### 6.1 Home Reel Host (protected)

| Responsibility | Detail |
|----------------|--------|
| Load timeline | `fetchVideos()` → map to `ReelViewModel` |
| Paging / snap | Existing FlatList physics |
| Active media | Existing viewability config |
| Actions | Preserve today’s behavior; inject `onViewAllProducts` equivalent without UX change |
| Out of scope until Phase 8 | Migrating feed source to Collection APIs; Save/Follow chrome |

### 6.2 Focused Reel Host (Phase 4 deliverable after this plan)

| Responsibility | Detail |
|----------------|--------|
| Param | `collectionId` |
| Load | `GET /collections/:id` (aggregate) + map media/tags/creator |
| Session | Single reel, always active |
| Back | `router.back()` |
| Errors | Not found / unpublished / private → empty state |
| Actions | At minimum View All; optionally Save/Follow when Product/Engagement phases ready |

### 6.3 Shared injection shape

Hosts pass props; Canonical Reel stays dumb regarding network and auth.

---

## 7. Media / platform abstraction

**Already adequate — do not replace.**

| Concern | Owner |
|---------|--------|
| Platform detect + embed URL | `videoUtils` / media fields on view model |
| YouTube HTML + mute bridge | `youtubeWebViewEmbed` + `YouTubeReelItem` |
| Instagram HTML | `instagramWebViewEmbed` + `InstagramReelItem` |
| Active-only WebView | Existing facade in YT/IG items |
| Full-screen vs constrained | Style/parent size — product-list already reuses media at smaller height |

**Contract rule:** Canonical Reel always receives `primaryMedia`; it does not call Collection or Ingest APIs.

**Note:** `onBuyPress` on media components is currently unused — future cleanup may remove the dead prop **without** changing Home visuals (behavior-preserving). Prefer moving buy to host actions on product press / View All.

---

## 8. Product integration

```text
Reel dock chips  → ReelProductChip[] (display)
View More        → /product-list/[collectionId]
product-list     → should converge on CatalogProductViewModel + ProductCard
                   (Phase 1 already defined; product-list still has legacy inline card)
ProductDetailsSheet ← opened by parents, not by ReelItem
```

**Phase 4A/4B stance:**

- Do **not** swap BottomDock chips to `ProductCard variant="compact"` (Phase 8 + parity).  
- Focused Reel must show the **same dock product presentation** as Home for visual continuity.  
- Hydration from Collection tags must map into the dock chip shape Home already uses.

---

## 9. Save / Cart / Buy integration boundaries

Aligned with `FE_DOMAIN_ARCHITECTURE_V1.md`:

| Action | Boundary |
|--------|----------|
| **Buy** | Host → `openProductShopping` / `useProductBuyHandler` — Reel only emits |
| **Add to Cart** | Host → auth gate + `requestAddToCart` / CartContext — never guest cart |
| **Save** | Host → auth + Engagement `POST/DELETE .../save` — no Reel-local save store |
| **Follow** | Host → auth + Engagement Follow — same intent-resume pattern as Creator Profile |
| **View All** | Navigation only — not a commerce action |

**Home Feed Phase 4:** do not add Save/Follow/Cart chrome if it changes visual hierarchy. Injection points may exist as optional props with Home passing `undefined`.

---

## 10. Home Feed compatibility

**Protected (must not change in Phase 4):**

- `app/(tabs)/index.tsx` paging UX, empty/error/refresh  
- Full-screen media → Header → BottomDock hierarchy  
- Dock chip look, View More → `/product-list/[id]`  
- Theme (Titanium / Nebula) behavior on Header/Dock  
- `fetchVideos()` data path (until Phase 8)

**Allowed behavior-preserving refactors (later implementation, not this doc’s code):**

- Introduce `mapVideoToReelViewModel` used only by Home so `ReelItem` accepts `ReelViewModel`  
- Inject `onViewAll` instead of BottomDock importing router — **same navigation result**  
- Remove dead `onBuyPress` plumbing if proven unused  

**Verdict:** Current Home implementation **almost** is the Canonical Reel already. It does **not** fully satisfy the multi-host contract (Video coupling + no focused host + actions not injectable). Abstraction should **extract**, not redesign.

---

## 11. Focused Collection Reel compatibility

| Requirement | Plan |
|-------------|------|
| Same visual Reel | Reuse CanonicalReel + Header + BottomDock + YT/IG |
| One Collection | Host loads by id; `isActive=true` |
| Entry from tiles | `CollectionTile.onPress` → `/reel/[collectionId]` |
| View All | Same `/product-list/[id]` (id = collection id = video id) |
| Creator attribution | Prefer Collection creator snapshot; dock string can match Home format |

**Not required for V1 focused host:** multi-item swipe between a creator’s collections (can be a later enhancement using the same Canonical Reel in a list host).

---

## 12. Search / Creator / Saved compatibility

| Surface | Open path |
|---------|-----------|
| Creator Profile | `CollectionTile` → `/reel/[collectionId]` |
| Search Collection hit | Same route (after Search wires press) |
| Saved | Same route from Saved `CollectionTile` |
| Future Discovery | Same |

All surfaces share **FocusedReelHost + CanonicalReel**. Differences live in how the user arrived (analytics/source), not in Reel forks.

---

## 13. Exact files that would need changes

*(Implementation phases after 4A — listed for planning; **not** to be edited in 4A.)*

### Phase 4B — Focused host + contract (minimal)

| File / area | Change |
|-------------|--------|
| `app/reel/[collectionId].tsx` | **Add** Focused Reel Host |
| `app/_layout.tsx` (or stack config) | Register focused reel route if needed |
| `src/types/reel.ts` (or similar) | **Add** `ReelViewModel` / `ReelActions` |
| `src/mappers/reelMapper.ts` | **Add** Video → Reel VM; Aggregate → Reel VM |
| `src/services/collectionApi.ts` | **Add** `fetchCollectionById` / aggregate client |
| `components/ReelItem.tsx` | Accept `ReelViewModel` (+ adapter for Video if needed); inject actions |
| `components/BottomDock.tsx` | Accept dock projection + `onViewAll`; avoid hard Router ownership |
| `app/creator/[username].tsx` | Wire `onPressCollection` → focused route |
| Tests | Mapper unit tests; host load error cases |

### Deferred (Phase 5–8, not required to open focused Reel)

| File | Change |
|------|--------|
| Search results press | Navigate to `/reel/[id]` |
| Saved surface | Same |
| `app/product-list/[id].tsx` | Swap legacy ProductCard → canonical ProductCard + cart/buy orchestration |
| Home `index.tsx` | Optional thin adapter only; **no UX change** |
| Engagement FE save helpers | When Save appears on Reel |

### Backend contract gaps (document only — no BE work in 4A)

| Gap | Notes |
|-----|--------|
| FE lacks Collection-by-id client | BE `GET /collections/:id` already returns `CollectionAggregate` |
| Aggregate tags vs catalog enrichment | Snapshots often enough for dock; Buy/Cart need `catalogProductId`; may need catalog hydrate if snapshots thin |
| Creator username on legacy Video | `curator_id` may be handle-like string, not UUID — Follow/profile nav needs Collection/User projection for focused path |
| Feed still on `videos` | Intentional until Phase 8 |

---

## 14. Explicitly protected files

**Do not redesign or behavior-change in Phase 4:**

| Path | Protection |
|------|------------|
| `app/(tabs)/index.tsx` | Home Feed behavior / paging / load UX |
| `components/BottomDock.tsx` | Visual design, chip layout, View More role *(prop injection OK if identical UX)* |
| `components/Header.tsx` | Brand chrome visual |
| `components/YouTubeReelItem.tsx` | Playback facade behavior |
| `components/InstagramReelItem.tsx` | Playback facade behavior |
| `app/product-list/[id].tsx` | Role as View All destination *(may later swap Product cards without changing page role)* |

**Do not touch in Reel workstreams:** Bottom tab IA, Search ranking UI redesign, Cart screen redesign, Campaign/Brand.

---

## 15. Refactor risks

| Risk | Mitigation |
|------|------------|
| Typing ReelItem on `ReelViewModel` breaks Home | Ship `mapVideoToReelViewModel` with golden field parity; visual QA Home YT + IG |
| BottomDock `router` injection changes navigation | Keep default push to `/product-list/${id}` identical |
| Focused host uses Collection media missing `embedUrl` | Mapper falls back to `transformToEmbedUrl(sourceUrl)` like ReelItem today |
| Dual-write drift (collection without video row) | Focused host must not require `videos` row; Home still uses videos. Document dual-write as Phase 8 concern |
| Accidental dock redesign while “cleaning” ProductCardFrame | Forbid compact ProductCard swap until Phase 8 parity checklist |
| Dead `onBuyPress` removal surprises callers | Remove only after confirming no UI path; Home handler can move to optional product press later |
| Over-abstraction (context providers, reel DI frameworks) | Prefer explicit props on CanonicalReel; no global ReelContext required for V1 |

---

## 16. Test strategy

| Layer | What to test |
|-------|----------------|
| **Mappers** | Video → ReelViewModel field parity; Aggregate → media platform + ordered products; empty tags → no dock chips |
| **CanonicalReel** | Renders YT vs IG given platform; invalid URL fallback; `isActive` passed to media |
| **Focused host** | Loading / 404 / success; navigates View All with same id |
| **Creator tile** | `onPress` pushes `/reel/:id` |
| **Regression (manual)** | Home: swipe, active playback, mute (YT), dock chips, View More, theme crossfade |
| **Protected** | Screenshot / interaction parity Home before vs after any ReelItem prop refactor |

No E2E requirement to block Phase 4B if manual Home regression is signed off.

---

## 17. Implementation order

**Phase 4A (this document):** Audit + canonical contract — **done as planning only.**

**Phase 4B — Focused Collection Reel (next code phase):**

1. Define `ReelViewModel` + `ReelActions` types.  
2. Add mappers (`Video`, Collection aggregate).  
3. Add `collectionApi.fetchAggregate(collectionId)`.  
4. Behavior-preserving adapter: Home continues to work (Video mapper or dual props).  
5. Add `FocusedReelHost` at `/reel/[collectionId]` using CanonicalReel.  
6. Wire Creator `CollectionTile.onPress`.  
7. Mapper + host tests; Home manual regression.

**Phase 4C / later (optional polish, still no Home redesign):**

- Inject `onViewAll` into BottomDock (remove router ownership).  
- Remove dead `onBuyPress` from media props.  
- Search / Saved navigate to same focused route.

**Phase 8:** Home consumes Collection-aligned models / optional Save·Follow·Cart wiring **without** visual redesign.

**Explicitly not in order:** Building surface-specific Reel products; redesigning BottomDock; migrating Home off `fetchVideos()` early.

---

## 18. Consistency audit against `FE_DOMAIN_ARCHITECTURE_V1.md`

| V1 rule | 4A plan alignment |
|---------|-------------------|
| Home Reel Feed protected until Phase 8 | **Aligned** — no Home redesign; focused host is separate navigation |
| CollectionTile → focused Reel, not Collection Detail page | **Aligned** — `/reel/[collectionId]` |
| Reuse ReelItem / YT / IG / BottomDock | **Aligned** — single CanonicalReel tree |
| No HomeReel / CreatorReel / SearchReel products | **Aligned** |
| ProductCard emit-only; dock chips special until Phase 8 | **Aligned** |
| Save / Cart auth-gated; public browse of Reel | **Aligned** — optional injected actions; Home may omit |
| View All remains `/product-list/[id]` | **Aligned** |
| Video legacy model Feed-owned until Phase 8 | **Aligned** — focused host uses Collection; Home keeps Video |
| Dual-write id coupling | **Aligned** — treat `collectionId === video.id` for View All |
| OD-1 prefer reel host naming | **Aligned** — `/reel/[collectionId]` |
| Presentation vs domain ownership | **Aligned** — hosts own fetch/actions; Reel presents |

**Residual tensions (accepted):**

1. Home still speaks `Video` while Collection speaks aggregate — bridged by mappers + dual-write, not by forcing Feed migration in Phase 4.  
2. `onBuyPress` / dock non-interactivity vs V1 “inspect product cards” — today inspection is via View All; Phase 8 may add press → details without changing hierarchy.  
3. product-list legacy inline ProductCard vs canonical Product FE — out of Reel Phase 4A scope; tracked under Product/Cart plans.

---

## Summary verdict

| Question | Answer |
|----------|--------|
| Does a complete multi-surface Reel architecture already exist? | **No** — Home has a solid single-surface composer; focused host + shared contract are missing |
| Does current Reel *media + chrome* satisfy the reusable core? | **Yes** — treat `ReelItem` + YT/IG + Header + BottomDock as the Canonical Reel stack |
| Must Home be refactored before focused Reel? | **Only a thin adapter** if needed; **no visual/behavioral redesign** |
| Create surface-specific Reel products? | **No** |
| Backend changes required for 4A? | **None** — document FE client + hydration gaps only |
| Next implementation phase? | **4B:** types/mappers + `/reel/[collectionId]` + Creator tile navigation |

---

*Phase 4A complete as planning. Do not treat this file as permission to modify the Home Reel Feed. Proceed to Phase 4B only with an explicit implementation task.*
