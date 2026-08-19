# PHASE 4 — COLLECTION + REEL INTEGRATION (Implementation Plan)

**Status:** Planning only — no code, migrations, commits, or pushes.  
**Baselines:**
- `frontend/docs/REEL_FE_ARCHITECTURE_PLAN.md` (canonical Reel contract)
- `frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md` (Collection / Product / Cart / Reel domains)
- `frontend/docs/PRODUCT_FE_IMPLEMENTATION_PLAN.md` (Phase 1 ProductCard / ProductDetailsSheet)
- `frontend/docs/CART_FE_IMPLEMENTATION_PLAN.md` (Phase 2 Cart boundary)
- `frontend/docs/CREATOR_FE_IMPLEMENTATION_PLAN.md` (Phase 3 Creator Profile + CollectionTile)

**Hard constraints:**
- Do **not** redesign the Home Reel Feed (visual or behavioral).
- Do **not** invent a new Collection UX — implement the **already-designed** Collection experience.
- One canonical Collection destination for all surfaces; no Creator/Search/Saved/Home product-list forks.
- Reel remains presentation-oriented; Collection remains SoT for identity, media, and ordered products.

---

## 0. Target architecture (Phase 4)

```text
                         ┌─────────────────────────────────────┐
                         │     Collection (domain SoT)          │
                         │  GET /collections/:id aggregate     │
                         └──────────────┬──────────────────────┘
                                        │
                          mapCollectionAggregate(...)
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
         CollectionDetailViewModel                  ReelViewModel
                    │                                       │
                    ▼                                       ▼
      /collection/[collectionId]                 /reel/[collectionId]
      (canonical Collection page)              (focused immersive Reel)
                    │
                    └── ProductCard (standard) + ProductDetailsSheet
                         onAddToCart → useProductAddToCartHandler → CartContext
                         onBuy → useProductBuyHandler → shoppingClick
```

**Entry surfaces (all → same Collection page):**

| Surface | Entry | Destination |
|---------|-------|-------------|
| Home Reel dock “View More” | `BottomDock` | `/collection/[collectionId]` |
| Creator Profile | `CollectionTile` | `/collection/[collectionId]` |
| Future Search | Collection hit | `/collection/[collectionId]` |
| Future Saved | Saved tile | `/collection/[collectionId]` |
| Future Discovery | Collection hit | `/collection/[collectionId]` |

**Focused Reel** is a **sibling** immersive presentation of the same Collection (not a separate product domain). Entry from Collection page media affordance or explicit control — see §11.

**Reconciliation with prior docs:** `FE_DOMAIN_ARCHITECTURE_V1.md` §9.3 originally listed `CollectionTile → Focused Reel` as the primary open target. Phase 4 adopts the refined model above: **Collection page is the canonical browse destination** (evolution of the approved “View All Products” role); **Focused Reel is optional immersive mode** at `/reel/[collectionId]`. This does not contradict Reel protection — Home Feed unchanged; only navigation targets and legacy route migration change.

---

## 1. Existing Collection UX/design being reused

From approved FE architecture (not to be redesigned):

### 1.1 What “Collection experience” means in V1

**Not** a metadata-heavy Collection Detail page (explicitly forbidden in FE_DOMAIN §9.3).

**Is** the approved **View All Products / browse-a-Collection** experience:

| Element | Source of truth in specs |
|---------|--------------------------|
| **Role** | Browse all shoppable products for one Collection + see source media | FE_DOMAIN §9.4, PRODUCT_FE §12 |
| **Discovery card** | `CollectionTile` — thumbnail, title, creator, product count | FE_DOMAIN §9.2 |
| **Product presentation** | Canonical `ProductCard` `variant="standard"` | FE_DOMAIN §6.2, PRODUCT_FE |
| **Product details** | `ProductDetailsSheet` (modal/sheet, not a stack route) | FE_DOMAIN §6.3 |
| **Media** | Constrained embed preview (reuse YT/IG media primitives); full-screen = Reel route | REEL_FE §7, FE_ARCHITECTURE_AUDIT |
| **Creator context** | Creator snapshot on Collection (display only on page header/metadata) | FE_DOMAIN §4.3 |
| **Public browse** | Anonymous may view Collection + products + open details | FE_DOMAIN §10 |
| **Cart / Buy** | Auth-gated Add to Cart; Buy via Shopping boundary | CART_FE, PRODUCT_FE |
| **Save / Follow** | Auth + intent-resume; **Phase 5** — extension points only in Phase 4 | FE_DOMAIN §11 |

### 1.2 Closest live analogue today

`app/product-list/[id].tsx` implements the **structural role** (product list + video section) but is **not** the approved canonical implementation (legacy data, inline card, mock cart, light template styling).

Phase 4 **replaces the implementation** while preserving the **designed information architecture** (products-first scroll, media section, cart header affordance).

---

## 2. Current implementation audit

### 2.1 What exists in code

| Asset | Status | Notes |
|-------|--------|-------|
| `CollectionViewModel` + `CollectionTile` | **Exists** | Tile-only; list metadata, no products/media |
| `CreatorCollectionList` | **Exists** | Grid layout for Creator Profile |
| `listCreatorCollections()` | **Exists** | `GET /collections?creator_id=` |
| `collectionMapper.mapPublishedCollectionListItem` | **Exists** | List DTO → tile VM |
| `GET /collections/:id` (backend) | **Exists** | Returns `{ collection, media, tags }` aggregate |
| `fetchCollectionById` (FE) | **Missing** | No FE client for aggregate |
| `CollectionDetailViewModel` | **Missing** | No detail/browse model |
| `ReelViewModel` + mappers | **Missing** | Planned in REEL_FE |
| `/collection/[collectionId]` route | **Missing** | |
| `/reel/[collectionId]` route | **Missing** | |
| `app/product-list/[id].tsx` | **Legacy** | Supabase `Video`; inline ProductCard; mock cart |
| Home `BottomDock` → View More | **Live** | `router.push('/product-list/${video.id}')` |
| Creator `CollectionTile.onPress` | **Stub** | Alert “Coming soon” |
| Canonical `ProductCard` + orchestration | **Exists** | Used on Cart; hooks in `productActionOrchestration.ts` |
| `CartContext` + `POST /cart/items` | **Exists** | Phase 2 complete |
| Engagement Save API (BE) | **Exists** | No FE save on Collection/Reel |
| Engagement Follow API (FE partial) | **Exists** | Creator Profile only |

### 2.2 Dual-write reality

Publish sets **`videoId === collectionId`** (`backend/src/publish.ts`). Home Feed still loads Supabase `videos`. Canonical Collection page should load **`GET /collections/:id`** (Collection SoT), with optional Supabase video fallback only for drift resilience during migration.

---

## 3. Canonical Collection FE model

### 3.1 Layered models (one Collection, two projections)

```text
CollectionDetailViewModel          ← canonical Collection PAGE input
  ├── identity: collectionId, slug
  ├── title, caption (optional display)
  ├── creator: { id, username, displayName, avatarUrl }
  ├── qualityScore?               ← collection.qualityScore (stash_score analogue)
  ├── counters: { views, saves }
  ├── primaryMedia: CollectionMediaViewModel
  ├── products: CatalogProductViewModel[]   ← ordered, publish-surface tags
  └── publishedAt?

CollectionMediaViewModel
  ├── platform: 'youtube' | 'instagram' | 'unknown'
  ├── sourceUrl, embedUrl?, thumbnailUrl
  └── title?

ReelViewModel                      ← canonical REEL input (from REEL_FE)
  ├── collectionId
  ├── title, qualityScore?
  ├── creator: { id?, handleOrName, username? }
  ├── primaryMedia: { platform, sourceUrl, embedUrl?, thumbnailUrl }
  └── products: ReelProductChip[]  ← dock display; subset of Collection products
```

**`CollectionViewModel`** (existing) remains the **tile/list** projection — subset of detail fields. Do not fork tile vs detail into separate domain entities; detail extends/list-maps from the same aggregate.

### 3.2 Mapping from backend aggregate

**Source:** `GET /collections/:id` → `CollectionAggregate`:

```text
{ collection: Collection, media: CollectionMedia[], tags: CollectionProductTag[] }
```

| FE field | Backend source |
|----------|----------------|
| `collectionId` | `collection.id` |
| `slug` | `collection.slug` |
| `title` | `collection.title` |
| `caption` | `collection.caption` |
| `creator.id` | `collection.creatorId` |
| `creator.username` | `collection.creatorUsername` |
| `creator.displayName` | `collection.creatorName` |
| `creator.avatarUrl` | `collection.creatorAvatar` |
| `qualityScore` | `collection.qualityScore` |
| `counters` | `collection.viewsCount`, `collection.savesCount` |
| `primaryMedia` | `media.find(m => m.isPrimary) ?? media[0]` |
| `products` | `tags.filter(isPublishSurfaceTag).sort(sortOrder)` → hydrate to `CatalogProductViewModel` |

**Platform detect:** `collection.originPlatform` or `detectPlatform(primaryMedia.sourceUrl)`.

**Embed URL:** `primaryMedia.embedUrl` ?? `transformToEmbedUrl(primaryMedia.sourceUrl)` (same as `ReelItem` today).

### 3.3 Product hydration strategy (no new Product SoT)

Tags carry `catalogProductId` + snapshots (`nameSnapshot`, `imageSnapshot`, `brandSnapshot`) but **no price or verification** on the tag row.

**V1 (no backend change):**

1. Load aggregate from `GET /collections/:id`.
2. Collect `catalogProductId`s from publish-surface tags.
3. **Batch-fetch `catalog_products` via Supabase** (same join pattern as `src/services/supabase.ts` `fetchProductsForVideos`) — Catalog SoT stays in catalog table; Collection references via tags.
4. Map each tag → `CatalogProductViewModel` via `catalogRowToViewModel` when row exists; else `tagSnapshotToViewModel` fallback (mirrors `draftProductToViewModel` pattern in `catalogProductMapper.ts`).

This satisfies canonical `ProductCard` without a second cart or dummy product model.

### 3.4 `Video` → shared projections (Home compatibility)

Until Phase 8, Home continues loading `Video[]`. Shared mappers:

- `mapVideoToCollectionDetailViewModel(video)` — for drift fallback / tests
- `mapVideoToReelViewModel(video)` — Home `ReelItem` adapter (behavior-preserving)
- `mapCollectionAggregateToReelViewModel(aggregate, products)` — focused Reel

Both Reel and Collection page should derive from the **same aggregate** when Collection HTTP is available.

---

## 4. Canonical Collection page component hierarchy

```text
app/collection/[collectionId].tsx          ← CollectionHost (route)
  │
  ├── load: fetchCollectionAggregate(id)
  ├── hydrate: batch catalog rows for tag ids
  ├── map: → CollectionDetailViewModel
  │
  └── CollectionScreen                     ← presentation
        ├── CollectionPageHeader           ← back, title, cart icon (reuse product-list role)
        ├── CollectionMetadataRow          ← creator label, optional score (display)
        ├── CollectionProductSection
        │     └── ProductCard (standard) × N
        │           onPress → ProductDetailsSheet
        │           onAddToCart → useProductAddToCartHandler()
        │           onBuy → useProductBuyHandler() (+ collection/creator attribution)
        ├── CollectionMediaSection         ← “Video” / source media (constrained embed)
        │     └── YouTubeReelItem | InstagramReelItem (isActive=true, same as product-list box)
        └── CollectionImmersiveEntry       ← navigates to /reel/[collectionId] (minimal affordance)
              (tap media or “Full screen” — do not redesign page layout)

ProductDetailsSheet (sibling, host-owned visibility state)
```

**Forbidden:** `CreatorCollectionPage`, `SearchCollectionPage`, `HomeProductListPage` as separate trees. One `CollectionScreen` reused by the route.

**Styling:** Adopt Titanium/Nebula via `useThemeMode()` (match Cart / Creator Profile). Do not copy product-list’s hardcoded white `#ffffff` template — that is legacy, not the approved design language.

---

## 5. Collection → Reel relationship

```text
Same aggregate fetch (or shared cached query)
        │
        ├── mapCollectionAggregateToCollectionDetail(...)
        └── mapCollectionAggregateToReelViewModel(...)
                │
                ▼
        CanonicalReel (= evolved ReelItem)
          ├── MediaLayer (YT/IG)
          ├── Header
          └── BottomDock
```

| Concern | Owner |
|---------|--------|
| Collection identity, creator, media refs, ordered products | Collection aggregate / mappers |
| Full-screen layout, playback facade, dock chrome | Canonical Reel |
| `isActive`, volume bridge | Reel host |
| View All from dock | Reel host injects `onViewAllProducts` → `/collection/[collectionId]` |

**Focused host:** `app/reel/[collectionId].tsx` — single item, `isActive=true`, back navigation.

**Do not** duplicate media/product fetching in Reel host if Collection host already loaded — optional shared hook `useCollectionSession(collectionId)` returning both VMs.

---

## 6. Collection → Product relationship

- Collection **references** products via `CollectionProductTag` → `catalogProductId`.
- Collection page renders **`CatalogProductViewModel[]`** only (canonical Product FE).
- Product order = tag `sortOrder` among publish-surface tags (`isPublishSurfaceTag` — mirror backend).
- `ProductCard` `onPress` opens `ProductDetailsSheet` with the same VM instance.
- Provenance for analytics/cart/shopping: pass `sourceCollectionId`, `creatorId` from Collection detail into handlers (Shopping `videoId` param may remain collection id under dual-write — see §8).

---

## 7. Product → Cart relationship

**Frozen chain (CART_FE + PRODUCT_FE):**

```text
ProductCard.onAddToCart(product)
  → useProductAddToCartHandler()
      → if authenticated: CartContext.addItem(catalogProductId) / requestAddToCart
      → if guest: router.push(buildAddToCartLoginHref(catalogProductId))
  → POST /cart/items (via cartBoundary)
```

**Collection page MUST:**

- Use `components/commerce/ProductCard` — **not** inline legacy card.
- Wire `onAddToCart={useProductAddToCartHandler()}` on every shoppable product row.
- Never call `console.log` mock cart or local bag state.

**Out of scope:** quantity UI on Collection page (Cart owns quantity at `/cart`).

---

## 8. Product → Buy relationship

**Frozen chain:**

```text
ProductCard.onBuy(product)
  → useProductBuyHandler() or host wrapper
  → openProductShopping({
       catalogProductId,
       videoId: collectionId,      // dual-write: collection id = legacy video id
       creatorId: collection.creator.id,
     })
  → GET /products/:id/redirect (backend Shopping boundary)
```

Collection page host may wrap buy handler to attach Collection provenance. **Do not** implement client-side merchant URL selection.

---

## 9. View All Products migration

### 9.1 Current behavior

`BottomDock.handleViewAll()` → `router.push('/product-list/${video.id}')`.

### 9.2 Target behavior

`BottomDock` receives injected navigation callback (REEL_FE recommendation):

```text
onViewAllProducts(collectionId) → router.push(`/collection/${collectionId}`)
```

Under dual-write, `video.id === collectionId` — **same id**, new canonical route.

### 9.3 Home protection

- Dock **visual design unchanged** (chips, “View More” label, layout).
- Only the **navigation target** changes from legacy product-list to canonical Collection.
- Home Feed paging, media, mute, and chip presentation untouched.
- Implementation: optional prop `onViewAll` on `BottomDock`; Home passes callback; default preserves legacy URL until cutover flag removed (or single-step swap if QA confirms same id).

---

## 10. `/product-list/[id]` migration strategy

### 10.1 Audit verdict: **legacy — not canonical**

| Aspect | Legacy (`product-list`) | Required (canonical) |
|--------|-------------------------|----------------------|
| Data | Supabase `Video` + `fetchVideoById` | `GET /collections/:id` aggregate |
| Products | Inline local `ProductCard` | `components/commerce/ProductCard` |
| Cart | `console.log` mock | `useProductAddToCartHandler` |
| Theme | Hardcoded light template | Titanium/Nebula |
| Domain model | `Video` / `Product` | `CollectionDetailViewModel` + `CatalogProductViewModel` |
| Role | View All destination | **Same role** — fulfilled by `/collection/[id]` |

### 10.2 Recommended migration (safest)

**Phase 4B — Collection page**

1. Implement `/collection/[collectionId]` as canonical destination.
2. Rewire `BottomDock` + Creator `CollectionTile` to `/collection/...`.

**Phase 4C — Compatibility shim**

3. Replace `app/product-list/[id].tsx` body with **redirect**:

```text
/product-list/:id  →  router.replace(`/collection/${id}`)
```

   Or thin wrapper that re-exports Collection host with same param.

4. Keep route registered in `app/_layout.tsx` temporarily for deep links / bookmarks.
5. Remove mock `ProductCard` and Supabase video load from product-list once redirect verified.

**Do not** maintain product-list as a permanent parallel surface.

### 10.3 Fallback resilience

If `GET /collections/:id` returns 404 but Supabase `fetchVideoById(id)` succeeds (dual-write drift), Collection host may:

- Show legacy-mapped detail from `Video` with banner in dev, **or**
- Show not-found with retry.

Prefer aggregate; document drift in Phase 8 checklist.

---

## 11. `/collection/[collectionId]` route recommendation

**Route:** `app/collection/[collectionId].tsx`

**Register** in root Stack (mirror `cart`, `creator/[username]`).

**Param:** `collectionId` (UUID; equals legacy `video.id` today).

**Slug routing (optional later):** Backend supports `GET /collections/by-slug/:slug`; FE may add `/collection/s/[slug]` alias in a later phase — **not required for Phase 4**.

**Public access:** No auth gate on route load. Cart/Save actions auth-gated at action time.

---

## 12. `/reel/[collectionId]` relationship

**Route:** `app/reel/[collectionId].tsx`

| | Collection page | Focused Reel |
|--|-----------------|--------------|
| **Purpose** | Browse all products + media preview | Immersive full-screen Reel |
| **Layout** | Scroll: products → constrained media | Full-screen: media → Header → BottomDock |
| **Data** | Same aggregate + mappers | Same → `ReelViewModel` |
| **Products** | Standard ProductCard list | Dock chips only (protected visual) |
| **View All** | N/A (you are here) | Dock → `/collection/[collectionId]` |
| **Entry** | Tiles, Home View More, Search*, Saved* | Collection media affordance; optional future “Play” |

\*Future phases — routes planned now, not implemented in Phase 4.

**Implementation reuse:** `ReelItem` / CanonicalReel accepts `ReelViewModel` + `ReelActions` per REEL_FE_ARCHITECTURE_PLAN.md.

---

## 13. CollectionTile integration

**Current:** `app/creator/[username].tsx` → `onPressCollection` → Alert stub.

**Target:**

```text
onPressCollection(collection) → router.push(`/collection/${collection.collectionId}`)
```

**No Creator-specific Collection route.** Same tile, same destination as Search/Saved will use later.

Optional: long-press or secondary action to `/reel/[collectionId]` — **defer** unless already specified; default tap opens Collection page per Phase 4 target architecture.

---

## 14. Home Reel compatibility

| Requirement | Plan |
|-------------|------|
| No visual redesign | No changes to ReelItem layout, Header, BottomDock chrome, chip frames |
| No paging/refresh changes | `app/(tabs)/index.tsx` FlatList unchanged |
| View More destination | Update to `/collection/[id]` via injected callback |
| Data path | Keep `fetchVideos()` until Phase 8 |
| ReelItem typing | Optional adapter `mapVideoToReelViewModel` — behavior-preserving |
| Dock router decoupling | Inject `onViewAll`; default can point to Collection route with same id |

**Regression gate:** Home manual QA (swipe, YT mute, IG embed, View More opens Collection with correct products, theme crossfade).

---

## 15. Loading / error / empty states

### 15.1 Collection page (`/collection/[collectionId]`)

| State | UX |
|-------|-----|
| **Loading** | Header skeleton + ActivityIndicator (match Creator Profile / Cart patterns) |
| **Not found** | 404 from aggregate + no fallback → “Collection not found” + back |
| **Private / draft** | Backend returns 404 to anonymous → same as not found |
| **Empty products** | Show media section + “No products in this collection” |
| **Partial catalog hydrate failure** | Render products with tag snapshots; disable Buy/Cart when `catalogProductId` missing |
| **Network error** | Message + Retry |

### 15.2 Focused Reel (`/reel/[collectionId]`)

| State | UX |
|-------|-----|
| **Loading** | Full-screen spinner on Reel background |
| **Not found** | Fallback message + back |
| **Invalid media** | Reuse ReelItem invalid/unsupported platform UI |

### 15.3 Legacy redirect (`/product-list/[id]`)

Instant replace — loading handled by Collection host.

---

## 16. Save / Follow — extension points (Phase 5 — do not implement)

Document hooks only:

```text
CollectionPageHeader (future)
  onSave?: (collectionId) => void     → auth gate → POST /engagement/collections/:id/save
  onFollowCreator?: (creatorId) => void → auth gate → followCreator()

ReelActions (future)
  onSave?, onFollow?, onCreatorPress?
```

Use existing `authIntent` patterns (`SAVE_COLLECTION`, `FOLLOW_CREATOR`) when Phase 5 wires Engagement FE. Phase 4 leaves props unset or omits UI controls — **no Save button, no Follow on Collection page** unless a designed control already exists (it does not).

---

## 17. Exact files expected to change

*(Implementation phases — not executed in this planning task.)*

### New files

| File | Purpose |
|------|---------|
| `app/collection/[collectionId].tsx` | Canonical Collection host |
| `app/reel/[collectionId].tsx` | Focused Reel host |
| `src/types/collectionDetail.ts` | `CollectionDetailViewModel`, media VM |
| `src/types/reel.ts` | `ReelViewModel`, `ReelProductChip`, `ReelActions` |
| `src/mappers/collectionDetailMapper.ts` | Aggregate → detail VM; tag → product |
| `src/mappers/reelMapper.ts` | Aggregate/Video → ReelViewModel |
| `src/services/collectionHydration.ts` | Optional: aggregate fetch + catalog batch |
| `components/collection/CollectionScreen.tsx` | Presentation layout |
| `components/collection/CollectionPageHeader.tsx` | Back + title + cart |
| `*.test.ts` | Mapper + hydration tests |

### Modified files

| File | Change |
|------|--------|
| `src/services/collectionApi.ts` | Add `fetchCollectionById` / aggregate client |
| `app/_layout.tsx` | Register `collection/[collectionId]`, `reel/[collectionId]` |
| `app/product-list/[id].tsx` | Redirect shim → `/collection/[id]` |
| `components/BottomDock.tsx` | Inject `onViewAllProducts`; default Collection route |
| `components/ReelItem.tsx` | Accept `ReelViewModel` (+ Video adapter) |
| `app/creator/[username].tsx` | Wire tile → `/collection/[id]` |
| `src/services/catalogProductMapper.ts` | Add `tagSnapshotToViewModel` helper |
| `src/services/supabase.ts` | Optional: `fetchCatalogProductsByIds` batch helper |

### Unchanged (consume later)

| File | Notes |
|------|-------|
| `app/(tabs)/index.tsx` | Protected — only pass `onViewAll` if dock signature changes |
| `components/YouTubeReelItem.tsx` | Protected media |
| `components/InstagramReelItem.tsx` | Protected media |
| `components/Header.tsx` | Protected chrome |
| Search / Saved screens | Future phases |

---

## 18. Explicitly protected files

| Path | Protection |
|------|------------|
| `app/(tabs)/index.tsx` | Home Feed paging, refresh, viewability — no redesign |
| `components/BottomDock.tsx` | Visual design, chip layout, metadata hierarchy — navigation injection only |
| `components/Header.tsx` | Brand chrome |
| `components/YouTubeReelItem.tsx` | Playback facade |
| `components/InstagramReelItem.tsx` | Playback facade |
| `app/(tabs)/search.tsx` | Out of Phase 4 scope |
| `app/cart.tsx` | Cart architecture complete — consume hooks only |
| `components/commerce/ProductCard.tsx` | Do not fork Collection-specific card |

---

## 19. Backend gaps

### 19.1 Audit: `GET /collections?creator_id=`

**Status: sufficient** for Creator Profile tiles.

Returns `PublishedCollectionListItem[]` with id, slug, title, heroThumbnailUrl, productTagCount, creator snapshot, counters. Already wired in `listCreatorCollections()`.

### 19.2 Audit: `GET /collections/:id`

**Status: sufficient** for Collection page + Reel mapping **with FE catalog hydration**.

Returns full aggregate:

- `collection` — identity, creator snapshots, title, caption, qualityScore, counters, heroThumbnailUrl, slug, status, visibility
- `media[]` — primary embed URLs, thumbnails, platform refs
- `tags[]` — ordered product associations with `catalogProductId` + display snapshots

**Not included:** joined catalog product rows (price, verification, gallery). This is intentional separation of concerns (Collection vs Catalog SoT).

### 19.3 Audit: `GET /collections/by-slug/:slug`

Exists; optional for share links later.

### 19.4 Genuine backend gap?

**No blocking backend gap** for Phase 4.

FE V1 hydrates catalog via existing Supabase `catalog_products` batch read (proven in Home feed path). No new Collection backend model or duplicate API required.

**Optional future optimization (non-blocking):** `GET /collections/:id?include=catalog_products` returning minimal catalog summaries on tags — reduces dual-fetch latency. Document only; **do not implement** unless perf requires it.

**Separate backend gap doc:** Not created — no blocker identified. See `backend/docs/CREATOR_FE_BACKEND_GAP_PLAN.md` for historical list-by-creator gap (now closed in code).

---

## 20. Test strategy

| Layer | Tests |
|-------|-------|
| **Mappers** | Aggregate → `CollectionDetailViewModel`; publish-surface tag filter + sort; platform/embed fallback; Video → Reel VM parity |
| **Product hydration** | Tags + catalog rows → `CatalogProductViewModel`; snapshot fallback when catalog missing |
| **collectionApi** | fetch by id success/404/network error |
| **CollectionScreen** | Renders N ProductCards; empty products; opens ProductDetailsSheet |
| **Cart/Buy wiring** | Mock handlers invoked; guest add-to-cart routes to login href |
| **product-list shim** | `/product-list/x` replaces to `/collection/x` |
| **Focused Reel host** | Loads same id; View All → Collection route |
| **Manual regression** | Home Feed unchanged; View More opens Collection; Creator tile opens Collection; Cart add from Collection page |

---

## 21. Implementation order

### Phase 4B — Canonical Collection page (foundation) — **CLARIFIED SCOPE**

**In scope (4B only):**

1. Types: `CollectionDetailViewModel`, extend mappers from existing `CollectionViewModel`.
2. `collectionApi.fetchCollectionById` → aggregate (**Collection HTTP only** — no Video fallback).
3. Catalog batch hydrate + `tagSnapshotToViewModel`.
4. `CollectionScreen` + `app/collection/[collectionId].tsx` — **new canonical page** (Titanium/Nebula + canonical ProductCard).
5. Wire canonical `ProductCard` + `ProductDetailsSheet` + `useProductAddToCartHandler` + Shopping boundary for Buy.
6. Loading / error / empty states.
7. Unit tests for mappers.

**Explicitly out of scope for 4B:**

- **Do not** migrate, refactor, or redesign Home Reel (`fetchVideos()` / `ReelItem` / `BottomDock` unchanged).
- **Do not** implement `/reel/[collectionId]` focused Reel (4C).
- **Do not** wire Home View More, Creator `CollectionTile`, or `/product-list` redirect (4C).
- **Do not** preserve or copy legacy `/product-list/[id]` implementation (deprecated; redirect is 4C).

**Legacy `/product-list/[id]`:** Treat as deprecated. Do not copy its styling, `Video` data source, inline ProductCard, mock cart, or direct shopping wiring. The approved UX **role** (media context, creator context, products-first browse, details, cart, buy) is implemented fresh on `/collection/[collectionId]`.

**Home Reel (intentional split):** Home continues Supabase `Video` → `fetchVideos()` until Phase 8. Collection page does **not** depend on Video. View More → `/collection/[id]` is wired in **4C** only.

**Cart / Product:** Phase 1 `ProductCard` + Phase 2 `useProductAddToCartHandler` → `CartContext` → `POST /cart/items`. Buy via `openProductShopping` with collection/creator attribution. No dummy/local cart.

### Phase 4C — Navigation migration + Reel hosts

8. `product-list/[id]` → compatibility redirect to `/collection/[id]` (replace legacy body — do not preserve).
9. `BottomDock` inject `onViewAllProducts` → `/collection/[id]` (Home regression QA).
10. Creator `CollectionTile` → `/collection/[id]`.
11. `ReelViewModel` + mappers from same aggregate.
12. `app/reel/[collectionId].tsx` focused host (Canonical Reel).
13. Collection page → immersive entry to `/reel/[collectionId]`.
14. `ReelItem` adapter for `ReelViewModel` (Home still passes Video via mapper).

### Explicitly later (not Phase 4)

- Search / Saved navigation to Collection
- Save / Follow UI on Collection or Reel
- Home Feed Collection HTTP migration (Phase 8)
- BottomDock `ProductCardFrame` → `ProductCard compact` (Phase 8 parity)
- Slug-based Collection URLs

---

## 22. Consistency audit against existing FE architecture/specs

| Spec rule | Phase 4 plan |
|-----------|--------------|
| One canonical Collection representation | **Aligned** — `CollectionDetailViewModel` + shared aggregate |
| No metadata-heavy Collection Detail | **Aligned** — products + media preview role preserved |
| No surface-specific Collection pages | **Aligned** — single `/collection/[id]` |
| CollectionTile shared across surfaces | **Aligned** |
| Focused Reel reuses ReelItem stack | **Aligned** — `/reel/[id]` |
| Home Reel protected | **Aligned** — dock visual unchanged; destination only |
| ProductCard emit-only; Cart/Shopping in orchestration | **Aligned** |
| No guest cart / no local cart | **Aligned** — removes product-list mock |
| Public browse Collection | **Aligned** |
| Save/Follow Phase 5 | **Aligned** — extension points only |
| `Video` legacy until Phase 8 on Home | **Aligned** |
| Dual-write id coupling | **Aligned** — same id for collection/video/view-all |
| PRODUCT_FE deferred product-list | **Resolved in Phase 4** — canonical card on Collection page |
| CART_FE deferred product-list | **Resolved in Phase 4** — real cart on Collection page |
| REEL_FE CanonicalReel + hosts | **Aligned** — shared mappers from aggregate |
| FE_DOMAIN §9.3 CollectionTile → Reel primary | **Refined** — Collection page primary; Reel immersive sibling (documented in §0) |

---

## Summary

| Question | Answer |
|----------|--------|
| What Collection UX is reused? | Approved View All / browse experience: products + media, `CollectionTile`, canonical ProductCard — **not** a new detail page design |
| What exists in code? | Tile, list API, legacy product-list, Reel stack — **not** canonical Collection route or aggregate FE client |
| What does product-list do today? | Legacy Video load + inline card + mock cart + constrained embed |
| What must be replaced? | Data source, ProductCard, cart, theme, route identity — **not** the information architecture |
| Does `GET /collections/:id` suffice? | **Yes**, with FE catalog hydration from `catalog_products` |
| One canonical destination? | **`/collection/[collectionId]`** |
| Focused Reel? | **`/reel/[collectionId]`** — same aggregate, presentation-only |
| View All from Home? | **`/collection/[collectionId]`** (same id as today) |
| Backend changes required? | **None blocking** |
| product-list fate? | **Temporary redirect shim** — not a permanent surface |

---

*Phase 4 planning complete. Do not treat this file as permission to modify the Home Reel Feed visual design. Proceed to Phase 4B implementation with an explicit task.*
