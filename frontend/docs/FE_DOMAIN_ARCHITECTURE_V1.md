# Mystash FE Domain Architecture V1

**Status:** Phase 0 — **FROZEN** (canonical FE domain architecture V1)  
**Audience:** FE + product engineering for consumer surfaces  
**Date:** 2026-08-11 (frozen — Product action-emission boundary + auth/Cart/Save policy)  
**Baseline audit:** [`FE_ARCHITECTURE_AUDIT.md`](./FE_ARCHITECTURE_AUDIT.md)  
**Code authority:** If this document and the repo disagree, prefer the **repository** and record the discrepancy here. Do not silently invent alignment.

**Scope of this document:** Architecture only. No TS/TSX changes, no new APIs, no Reel Feed redesign.

**Freeze rule:** Downstream phases (1–8) implement against this document. Do not reopen frozen decisions without an explicit product revision.

---

## 0. Document purpose

Establish the **canonical FE domain architecture** for Mystash consumer/product surfaces **before** implementing them phase by phase.

Primary consumer objects:

1. Collection / Reel  
2. Product  
3. Creator  
4. Cart  

Search is a **discovery surface** that composes those objects. It does not own them.

---

## 1. Current FE architecture baseline

Validated against `FE_ARCHITECTURE_AUDIT.md` and the repo (2026-08-11).

### 1.1 Stack (unchanged by Phase 0)

| Layer | Reality |
| --- | --- |
| App | Expo ~54 + React Native 0.81 + Expo Router (repo root, not a `frontend/` package) |
| Language | TypeScript strict |
| State | Screen-local `useState`; Context for Auth + Theme; module Maps for curation drafts / feed reload |
| Data | Supabase (auth + legacy `videos` feed) + `fetch` to Node backend (`EXPO_PUBLIC_MYSTASH_INGEST_URL`) |
| Styling | StyleSheet + Titanium/Nebula `ThemeContext`; NativeWind present but **unwired** |
| Tests | No FE test harness |

### 1.2 Surfaces today

| Surface | Status |
| --- | --- |
| Home Reel Feed | Production UX — full-screen paging reels + BottomDock product chips + View More → `/product-list/[id]` |
| Search tab | Placeholder — client filter over Supabase videos; non-interactive rows |
| Create | Ingest / review / publish (creator tooling; out of Phase 1–6 consumer rebuild except as product-card origin) |
| Profile tab | **Signed-in account** settings/auth — not public Creator Profile |
| Cart route | Stub UI; `CartProvider` **exists but is not mounted** in `app/_layout.tsx`; buy links are placeholder |
| Product details | `ProductDetailsSheet` (commerce) on Create Review; separate inline cards on product-list |

### 1.3 Domain vocabulary gap

Backend SoT is **Collection / Catalog / User / Engagement / Search / Shopping**.  
FE still speaks **Video / Product (legacy) / creator_name strings**.

Publish dual-writes Collection id ≈ `videos.id`, but the app navigates and loads by **video** tables.

### 1.4 Audit ↔ code consistency notes

| Claim | Validation |
| --- | --- |
| CartProvider not in root layout | **Confirmed** (`app/_layout.tsx` only Theme + Auth) |
| Dual CartContext files | **Confirmed** — `contexts/CartContext.tsx` and `components/CartContext.tsx` |
| SearchProductCard unused | **Confirmed** — export only |
| No public Creator route | **Confirmed** |
| No Collection FE model | **Confirmed** |
| Backend Search/Engagement/User routes exist | **Confirmed** — FE does not call them yet |
| Collection HTTP has GET by id/slug | **Confirmed** — no dedicated “list collections by creator” route found in `collection/routes.ts` (gap for Creator Profile) |

---

## 2. Target FE architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                         SURFACES (compose)                       │
│  Home Feed* │ Search │ Creator Profile │ Saved │ Cart │ Create   │
└───────┬─────────┬──────────┬─────────────┬───────┬──────────────┘
        │         │          │             │       │
        ▼         ▼          ▼             ▼       ▼
┌───────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
│ Reel UX*  │ │ Search │ │ Creator  │ │ Save   │ │ Cart     │
│ (protect) │ │ client │ │ Profile  │ │ UI     │ │ domain   │
└─────┬─────┘ └───┬────┘ └────┬─────┘ └───┬────┘ └────┬─────┘
      │           │           │           │           │
      │     ┌─────┴───────────┴───────────┘           │
      │     │  CANONICAL DOMAIN COMPONENTS            │
      │     │  CollectionTile │ CreatorCard │ ProductCard │ ProductDetails
      │     └─────────────────────────────────────────────┘
      │                         │
      ▼                         ▼
┌──────────────┐      ┌─────────────────────┐
│ Collection   │      │ Product VM          │
│ presentation │      │ (from Catalog)      │
│ model        │      └──────────┬──────────┘
└──────┬───────┘                 │
       │                         ▼
       │              ┌─────────────────────┐
       │              │ Shopping redirect   │
       │              │ (backend Shopping)  │
       └──────────────┴─────────────────────┘
```

\* Home Reel Feed remains the protected primary Collection presentation for the timeline. Other surfaces open Collections via a **focused Reel presentation host** that **reuses** existing reel media components — not a redesigned Feed.

### 2.1 Architectural rules (normative)

1. **Domain ownership over screen ownership.**  
2. **One canonical representation** per major object (Product, Creator, Collection, Cart).  
3. **Screens compose** domain components; they do not redefine them.  
4. **Search does not own** Product / Creator / Collection.  
5. **Cart is its own** FE/domain boundary — **authenticated, DB-backed** membership SoT (not Product SoT).  
6. **Engagement owns** Save / Follow (FE consumes Engagement APIs) — **authenticated-only**.  
7. **Catalog owns** Product truth (FE maps to view-models).  
8. **User owns** Creator identity (FE maps public profile).  
9. **Collection owns** Collection truth (FE maps presentation models).  
10. **Reel Feed is protected** until Phase 8.  
11. **Browse is public; Save / Add to Cart / Follow require authentication** (no guest Save/Cart).  
12. **No premature global state framework** (no Redux/Zustand/React Query unless a concrete requirement appears).  
13. **No duplicate** models/components/APIs per surface.  
14. **No FE business logic** that belongs in backend domains (ranking, shopping destination, verification, purchase detection).  
15. **No speculative infrastructure** without a concrete requirement (trending, Recs, ML).

### 2.2 Authentication policy (FROZEN)

Mystash is **browseable without authentication**.

**Anonymous users MAY:**

- Browse Reel Feed, Collections/Reels, product lists, Product Cards, Product Details  
- Browse public Creator Profiles and Creator Collections  
- Use Search (landing, autocomplete, results) and other **read-only** discovery  

**Anonymous users MAY NOT** (must gate → Login → resume intent):

- **Save** / Unsave  
- **Add to Cart**  
- **Follow** / Unfollow  

```text
Save | Add to Cart | Follow
        ↓
authentication check
        ↓
if unauthenticated → Login / auth UI
        ↓
return to original context
        ↓
complete originally requested action (intent resume)
```

**Explicitly forbidden in V1:**

- Guest Save / local anonymous saved Collections  
- Guest Cart / anonymous cart / AsyncStorage guest cart / guest cart merge / anonymous cart API  
- Anonymous database cart records  

Authentication state is the prerequisite for **user-owned state**: Cart, Saved Collections, Following.  
These must **not** be merged into Profile tab UI architecture (Profile remains account settings).

---

## 3. Domain boundaries

| FE domain | Owns | Does not own |
| --- | --- | --- |
| **Product** | Presentation model, ProductCard, ProductDetails; emit `onAddToCart` / `onBuy` only | Authentication, navigation, Cart persistence, merchant checkout, catalog merge/verification |
| **Cart** | Authenticated cart membership (DB SoT), remove, buy orchestration, purchase-confirmation UX, efficient Product hydration for display | Product metadata SoT, guest/anonymous cart, Search, Feed ranking |
| **Creator** | CreatorCard, public CreatorProfile (public browse), follow UI hooks gated by auth | Signed-in account settings, auth session SoT |
| **Collection** | Collection presentation model, CollectionTile, open→Reel navigation (public browse) | Product SoT, media hosting, Feed ranking |
| **Reel Feed** | Timeline presentation (protected, public browse) | Discovery Search, Cart, Save SoT |
| **Engagement FE** | Save/unsave/follow client + shared interaction hooks (**auth required**) | Guest save, Search CTR telemetry, Feed ranking |
| **Search** | Query UI, landing/results layout, autocomplete, Search telemetry client (**public**) | Entity SoT, trending/recs engines, Save/Cart |
| **Auth / Session** | Supabase session (existing AuthContext); **action-intent resume** gate for Save / Add to Cart / Follow | Public content gating; Product presentation |
| **Theme** | Titanium/Nebula (existing) | Domain data |

---

## 4. Canonical domain objects

### 4.1 Product (canonical FE view-model)

**Start from:** existing `CatalogProductViewModel` (`src/types/catalogProduct.ts`).

**Decision:** Treat `CatalogProductViewModel` as the **seed** of the canonical Product FE model. Phase 1 may rename/alias (e.g. `ProductViewModel`) and extend fields required by Cart/Search without creating parallel models.

**Required fields (V1):**

- Stable FE id + `catalogProductId` (shopping key)  
- `title`, `brand`, `merchant`  
- `heroImage` / gallery  
- `verificationStatus`, `availability`  
- `price`, `currency` (display only; Shopping owns destination)  

**Optional / contextual:**

- `description`, `specifications`, `metadataCompleteness`  
- Provenance hints: `sourceCollectionId`, `sourceVideoId`, `creatorId` (for Cart attribution / telemetry — **not** Product SoT)

**Legacy to stop growing:**

- `src/mocks/videos.ts` `Product` (`name`/`image`/`provider`) — **deprecate later** after mappers unify feed + product-list  
- Inline product-list card model — **deprecate later**

### 4.2 Creator (canonical FE view-model)

**Start from:** backend `PublicUserProfile` shape (`GET /users/by-username/:username`), mapped to FE `CreatorViewModel`.

**Required:** `userId`, `username`, `displayName`, `avatarUrl`, `isCreator`, public stats (followers, collections).  
**Optional:** bio, website, social links, follow state (from Engagement).

**Not the same as:** signed-in Profile tab user object.

### 4.3 Collection (canonical FE view-model)

**Start from:** Collection domain aggregate + Search Collection hits, mapped to FE `CollectionViewModel`.

**Owns references, not nested SoT:**

- Collection identity (`collectionId`, `slug`)  
- Title / context  
- Creator snapshot (denorm for display)  
- Primary media ref (thumbnail / platform / embed keys)  
- Product **references** (ids / count) — hydrate Products via Catalog/mapper when needed  
- Engagement counters as **display signals** only (views/saves) when provided  

**Legacy:** `Video` remains the Home Feed load model until Phase 8; CollectionViewModel is used by Search / Creator / Saved first.

### 4.4 Cart (canonical FE model)

**FROZEN:** Cart is an **authenticated** shopping workspace. **DB is the source of truth** for cart membership. **No guest cart.**

```text
User (authenticated)
  ↓
Cart (membership SoT — DB-backed)
  ↓
CartItem[]   UNIQUE(userId, catalogProductId)
  ├── cartItemId
  ├── catalogProductId          ← identity reference (not Product SoT)
  ├── addedAt / updatedAt
  ├── cart state + purchase-confirmation state
  └── optional source attribution (collectionId / creatorId / …)
        ↓
hydrate → canonical ProductViewModel (Catalog truth) for UI
```

**Rules:**

- Cart stores **product identity/reference + cart state**, not a second Product database  
- Catalog remains SoT for title, price, merchant, image, metadata, verification, shopping destination  
- Cart API (Phase 2 / Cart backend design) must support **efficient hydration** of items → Product presentation (avoid FE N+1 `GET /product/1..N`)  
- **One unique cart line per Catalog Product per user** — adding again does **not** create duplicates  
- **No quantity / quantity steppers in V1**  
- Cart does **not** process payment  

Optimistic UI may use local memory for responsiveness; it is **not** persistent SoT.

### 4.5 Search result DTO → presentation

Search HTTP returns blended entity hits. FE maps each hit into **canonical** Collection / Creator / Product presentation models (or thin `SearchHit` wrappers that **embed** those models). Search must not invent `SearchProduct` / `SearchCreator` domain types as parallel SoTs.

---

## 5. Canonical components

| Domain | Canonical components | Variants / notes |
| --- | --- | --- |
| Product | `ProductCard`, `ProductDetails` | Card: `compact` \| `standard` via props — **not** surface-named wrappers by default |
| Creator | `CreatorCard`, `CreatorProfile` | Profile ≠ Profile tab |
| Collection | `CollectionTile` (card), existing **Reel** media stack | No new Collection Detail product UI in V1 |
| Cart | `CartScreen`, cart rows via `ProductCard` + cart actions | |
| Engagement | `SaveControl` / `FollowControl` (shared hooks/components) | Phase 5 |
| Search | Search screen chrome only | Composes tiles/cards |

**Forbidden by default:** `SearchProductCard`, `CreatorProductCard`, `CartProductCard`, `CollectionProductCard` as separate implementations. Existing unused aliases (`SearchProductCard`, `PublishedVideoProductCard`) → **deprecate later** (leave until Phase 1 cleanup).

**Create-only exception:** `ReviewProductCard` (Include toggle) may remain a **curation** wrapper; it must still compose canonical `ProductCard`.

---

## 6. Product architecture

### 6.1 Pipeline

```text
Catalog / API / joins
        ↓
product mapper (extend catalogProductMapper)
        ↓
Canonical ProductViewModel
        ↓
┌─────────────┬──────────────────┬────────────┐
│ ProductCard │ ProductDetails   │ Cart item  │
└─────────────┴──────────────────┴────────────┘
```

### 6.2 ProductCard — one architecture

**Prefer configuration over forked components.**

| Concern | Spec |
| --- | --- |
| Canonical props | `product: ProductViewModel`, `variant: 'compact' \| 'standard'`, `isLight` (theme), `onPress`, optional `onAddToCart`, optional `onBuy`, optional `footer`/`actions` slots |
| Required data | id, title, hero image, verification (for price gating), catalogProductId when buy enabled |
| Optional data | brand, merchant, price, currency, availability badge |
| Actions | Press → Product Details (default). Add-to-cart / Buy are **callbacks** owned by parent |
| Variants | `compact` — reel dock / dense lists (image+price heavy). `standard` — Search / View All / Creator / Cart |
| Navigation | Parent decides route/sheet; card emits `onPress(product)` |
| Add-to-cart boundary | Card never mutates Cart and **never owns auth**. Calls `onAddToCart?.(product)`. Parent/orchestration: if authenticated → Cart add; else → Login → resume `addToCart(catalogProductId)` |
| Buy boundary | Card/Details call `onBuy?.(product)` → parent/service invokes existing `openProductShopping` (Buy itself is not gated as Add-to-Cart; browsing/buy redirect may remain available — Add-to-Cart is the auth-gated cart membership action) |

**Reel dock today:** `BottomDock` `ProductCardFrame` is a **visual special** of the protected Reel surface. Phase 1 defines the canonical compact contract; **Phase 8** may swap dock chips to `ProductCard variant="compact"` only if pixel/UX parity is preserved.

### 6.3 Product Details — one experience

**Decision (recommended):** Keep **`ProductDetailsSheet`** as the **canonical Product Details** experience for V1 consumer surfaces.

**Rationale:**

- Already implements gallery, verification, merchant, specs, View Product → shopping redirect  
- Action config already allows surface-specific secondary actions (`productDetailsActions`)  
- Avoids maintaining sheet + full screen for the same job  

**When a stack screen would be justified (not V1 default):** deep-link share URLs requiring standalone product pages, or accessibility constraints that sheets cannot meet. Record as open if product requires shareable product URLs.

**Opens from:** ProductCard, Search, Creator Collections, View All Products, Cart.

**Does not own:** merchant checkout, Cart persistence, **authentication / login navigation** (emits add-to-cart / buy; parents gate Add-to-Cart).

**View All Products (`/product-list/[id]`):** remains the Reel “View More” destination (protected UX). Phase 1–8 should gradually render **canonical ProductCards** inside it without changing the page’s role (video + product list). Anonymous users may browse this page; Add to Cart remains auth-gated.

### 6.4 Shopping / buy

Reuse `src/services/shoppingClick.ts` → `GET /products/:catalogProductId/redirect`.  
FE never selects merchant destinations.

### 6.5 Product action emission boundary (FROZEN)

**FROZEN:** `ProductCard` and `ProductDetails` emit `onAddToCart` and `onBuy`; they **never** own authentication, navigation, or Cart persistence.

```text
ProductCard / ProductDetails
  → onAddToCart(product) | onBuy(product)
        ↓
Parent / domain orchestration
  → authentication (if Add to Cart and logged out → Login → intent resume)
  → navigation (sheets/routes)
  → Cart persistence / Shopping redirect execution
```

Intent resume should preserve enough context to perform `addToCart(catalogProductId)` (and surface context) after login without forcing the user to re-find the product when reasonably possible.

---

## 7. Cart architecture

### 7.1 Product role

Cart = **multi-merchant shopping workspace**, not checkout.

```text
Cart
 ├── Product A → Merchant A
 ├── Product B → Merchant B
 └── Product C → Merchant C
```

Capabilities (Phase 2):

- Add (authenticated) from Collection/Reel/Product Details/Search via Product callbacks + auth gate  
- View product (→ Product Details) — public product browse; cart membership requires auth  
- Remove / delete  
- Buy (→ external merchant redirect)  
- Handle unavailable products (availability / redirect failure UX)  
- **Purchase confirmation** after return to foreground (explicit Yes/No — not automatic detection)  

### 7.2 Ownership

| Owner | Responsibility |
| --- | --- |
| Cart domain (DB-backed) | Membership SoT, uniqueness, confirmation flags, cart screen, hydrated list fetch |
| Catalog / Product mapper | Product presentation for cart rows |
| Product components | Emit `onAddToCart` / `onBuy` only — **no auth, no cart writes** |
| Auth orchestration | Gate Add-to-Cart; preserve/resume intent |
| Shopping service | Open redirect URL |
| Search / Collection / Creator / Reel | Must not store cart |

### 7.3 Persistence (FROZEN)

**Authenticated DB-backed Cart is the V1 source of truth.**

```text
User → Cart → Cart Items → catalogProductId → (hydrate) Catalog Product presentation
```

**Removed / not V1:**

- Guest cart  
- Anonymous cart  
- AsyncStorage as cart SoT / guest cart persistence  
- Guest cart merge  
- Anonymous cart API  

Local UI may still be used for optimistic updates; it is **not** the persistent SoT.

Exact schema/API belongs to the **Cart backend design phase** — not invented here. FE requirement: authenticated cart CRUD + **batch/efficient Product hydration**.

### 7.4 Uniqueness (FROZEN)

`UNIQUE(userId, catalogProductId)` — one cart line per product per user.  
Re-adding the same product does not create duplicate lines.  
**No quantity controls in V1.**

### 7.5 Buy → external → return → purchase confirmation (FROZEN shape)

```text
Cart item
  → Buy
  → mark item awaiting purchase confirmation
  → open external shopping destination (Shopping redirect)
  → Mystash returns to foreground (AppState)
  → ask "Did you buy this product?"
       YES → remove Cart item
       NO  → retain Cart item (clear awaiting flag)
```

**V1 does NOT** automatically determine whether a purchase occurred.  
**Do NOT infer purchase from:** URL return, merchant page, browser history, external app behavior, or redirect success alone.

**Non-goals:** payments, checkout, orders, fulfillment, purchase verification, merchant APIs owned by FE.

### 7.6 Existing cart code

| Artifact | Classification |
| --- | --- |
| `app/cart.tsx` | **CANONICALIZE** into CartScreen in Phase 2 (replace stub; remove quantity steppers) |
| `contexts/CartContext.tsx` | **CANONICALIZE** — mount as authenticated cart client over DB API (not AsyncStorage SoT) |
| `components/CartContext.tsx` | **DEPRECATE LATER** (duplicate) |
| Quantity stepper UX in stub | **DEPRECATE** — not V1 |

---

## 8. Creator architecture

### 8.1 Distinction (mandatory)

| Concept | Route / surface | Purpose |
| --- | --- | --- |
| **Current User Profile** | `/(tabs)/profile` | Auth, settings, theme, account |
| **Public Creator Profile** | New route e.g. `/creator/[username]` | Discovery identity, follow, collections |

Do **not** overload the Profile tab as public Creator Profile.

### 8.2 Components

| Component | Role |
| --- | --- |
| `CreatorCard` | Compact identity for Search / lists — avatar, name, username, optional stats |
| `CreatorProfile` | Full public profile header + follow control + `CreatorCollectionList` |
| `CreatorCollectionList` | Renders `CollectionTile[]` for that creator |

### 8.3 Data

- Profile: `GET /users/by-username/:username` → `CreatorViewModel` (**public browse**)  
- Follow: Engagement `POST/DELETE /engagement/creators/:id/follow` + `GET /engagement/me/following` — **authenticated-only** with Login → intent resume (same pattern as Save / Add to Cart)  
- Collections list: **API gap** — no first-class list-by-creator route observed in Collection routes. Phase 3 must not invent FE-only ranking; **depends on** an agreed read API (existing backend capability extension is **out of Phase 0 code** — flagged under Open Decisions / Risks).

### 8.4 Reachability

CreatorCard / attribution taps → Public Creator Profile from Search, Collection/Reel (Phase 8), Creator lists, future discovery.

### 8.5 Follow authentication boundary (FROZEN)

```text
Creator Profile → Follow
  ↓
if logged out → Login → resume Follow
  ↓
if logged in → Engagement Follow
```

Public Creator Profiles and their Collections remain browseable without authentication.

---

## 9. Collection architecture

### 9.1 Model

```text
CollectionViewModel
  ├── identity (id, slug)
  ├── title / context
  ├── creator snapshot (display)
  ├── primaryMedia (refs only)
  ├── productRefs[] / productCount
  └── engagement display signals (optional)
```

Collection **references** Products and Media; it does not embed Catalog SoT or host video binaries.

### 9.2 Discovery representation

**`CollectionTile`** (name: Tile preferred over “Card” to avoid clashing with ProductCard):

Used by Creator Profile, Search, Saved, future discovery — thumbnail, title, creator, product count.

### 9.3 Opening a Collection (V1)

**Do not create a separate Collection Detail product architecture** (metadata-heavy page replacing Reel).

**Evaluation of existing Reel navigation:**

- Home Feed = vertical timeline of many reels — **no deep-link** to a single collection today  
- `/product-list/[id]` = View All Products (video + list) — **not** the primary open target for a Collection hit  

**Recommended V1 destination:** a **focused Reel presentation route** (e.g. `/reel/[collectionId]`) that:

- Reuses `ReelItem` / YouTube / Instagram / BottomDock patterns  
- Presents **one** Collection full-screen  
- Preserves Reel visual hierarchy (media + dock + View All Products)  
- Does **not** redesign Home Feed  

This is a **navigation host**, not a new Collection Detail design language.

**Home Feed** continues loading legacy `videos` until Phase 8 optionally aligns ids/models.

### 9.4 View All Products

Remains: focused reel / Home dock → `/product-list/[id]` (id = collection/video id dual-write today). Protected behavior.

---

## 10. Reel Feed protection

**Constraint (normative for Phases 1–7):**

The existing Home Reel Feed is a **stable, protected product UX**.

**Do NOT:**

- Redesign or replace it  
- Restructure its navigation or paging model  
- Change visual hierarchy (full-screen media → creator/context → compact products → View All)  
- Change product-card placement in the dock  
- Remove/hide existing information  
- Change View All Products UX  
- Force-migrate it onto new components “for consistency”

**May (Phase 8 only, minimal):**

- Wire canonical ProductViewModel behind dock/list data  
- Wire Save / Creator navigation / Add-to-cart callbacks (**with auth gates**; do not change Reel visual hierarchy)  
- Swap dock chip implementation **only** with strict UX parity  

Canonical domains must be designed so the Feed can **consume** them later.

**Public browse (FROZEN):** Logged-out users can watch Reel, inspect product cards, open View All Products, open Product Details. **Save → Login. Add to Cart → Login.** Do not change existing Reel UX to accommodate auth.

---

## 11. Save / Engagement architecture

**FROZEN:** Save is **authenticated-only**. Engagement owns Save. **No guest Save.**

```text
UI (Reel | CollectionTile | Search | Creator Collection | future discovery)
        ↓
authentication check
        ↓
if unauthenticated → Login → preserve Save(collectionId) intent → resume
        ↓
if authenticated → Engagement FE service (Bearer auth)
        ↓
POST/DELETE /engagement/collections/:id/save
GET /engagement/me/saves
```

**Rules:**

- **One** Save interaction pattern everywhere Save is exposed  
- Screens do **not** keep private save stores / Search Save / Creator Save / Reel Save forks  
- Do **not** create guest saved Collections or local anonymous saved Collections  
- Follow uses the same auth + intent-resume pattern  
- Search telemetry ≠ Engagement (Search click posts remain Search-owned)  
- Impression/view recording may attach later; not required to block Save FE  

**Phase 5** delivers Saved Collections surface composing `CollectionTile` (auth required to use Saved).

---

## 12. Search architecture

### 12.1 Role

Search is a **consumer** of Collection / Creator / Product presentation + backend Search APIs.

**Must not own:** Feed ranking, Trending, Recommendations, Engagement aggregation, entity SoT.

**FROZEN:** Search is **public**. Do **not** gate Search behind login. Anonymous users may open Search, autocomplete, search, view results, open Collection/Reel, Creator Profile, and Product Details. Only **Save** and **Add to Cart** (and Follow) require authentication.

### 12.2 States

| State | Contents |
| --- | --- |
| **A. Landing / Discovery** | Search bar + default discovery content. **Until** backend trending/popular/discovery feeds exist: use only **honest** interim content (e.g. recent published collections **if** product accepts chronological landing) — **do not invent** trending/recs systems |
| **B. Active results** | Blended Collections (primary), Creators, Products via canonical tiles/cards |

### 12.3 Composition

```text
                     SEARCH
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   CollectionTile   CreatorCard   ProductCard
        │              │              │
        ▼              ▼              ▼
   Focused Reel   CreatorProfile  ProductDetails
                                      │
                                      ▼
                                     Cart
```

### 12.4 Client responsibilities

- `GET /search`, `GET /search/autocomplete`, `POST /search/telemetry/click`  
- Map DTOs → canonical VMs  
- Cursor pagination when wired  
- Local UI state for query / focus / sheet  

### 12.5 Current Search screen

`app/(tabs)/search.tsx` placeholder → **CANONICALIZE** in Phase 6 (replace implementation; keep tab route).

---

## 13. Navigation architecture

### 13.1 Target paths (not implemented in Phase 0)

| From | To |
| --- | --- |
| CollectionTile | Focused Reel (`/reel/[collectionId]` proposed) |
| CreatorCard | Public Creator Profile (`/creator/[username]` proposed) |
| ProductCard | ProductDetailsSheet (canonical) |
| ProductDetails | Add to Cart / Buy |
| Cart item | ProductDetails / Buy |
| Search Collection | Focused Reel |
| Search Creator | Creator Profile |
| Search Product | ProductDetails |
| Creator Profile Collection | Focused Reel |
| Saved Collection | Focused Reel |
| Reel dock View More | `/product-list/[id]` (**unchanged**) |
| Header bag / cart entry | `/cart` (existing route) |

### 13.2 Current route gaps

| Gap | Notes |
| --- | --- |
| Public Creator Profile | Missing |
| Focused single Collection Reel | Missing (needed for Search/Creator/Saved opens) |
| Saved Collections screen | Missing |
| Product share stack route | Optional; sheet-first V1 |
| Collection slug routing | Backend supports slug; FE may use id first |

### 13.3 Smallest correct architecture

1. Keep tabs: Home / Search / Create / Profile  
2. Keep `/cart`, `/product-list/[id]`  
3. Add stack routes for **Creator Profile**, **Focused Reel**, **Saved** (Phase-aligned)  
4. Mount authenticated Cart client/provider at root when Phase 2 lands (loads DB cart only when session present)  

### 13.4 Auth return / intended action (architecture)

Cross-cutting **action-intent** boundary (owned with Auth orchestration, not ProductCard):

| Intended action | Resume payload (conceptual) |
| --- | --- |
| Add to Cart | `addToCart(catalogProductId)` + optional source attribution |
| Save | `save(collectionId)` |
| Follow | `follow(creatorId)` |

After successful authentication, FE should return to the original context and complete the action when reasonably possible. Do not implement the auth flow in Phase 0.

---

## 14. State ownership

| Kind | Examples | Pattern |
| --- | --- | --- |
| **Local UI** | Search input, sheet visibility, reel active index, confirmation modal, pending action-intent | `useState` in screen/component / short-lived intent holder |
| **Server state** | Catalog products, creator profiles, collections, saves/follows, search results, **DB cart membership** | Fetch in services + screen state; focus reload / cancelled flags (existing pattern). Introduce shared cache **only** if duplication pain is proven |
| **Domain state** | Auth session, Theme mode; Cart **client** mirrors DB SoT when authenticated | Context (Auth/Theme exist; Cart client mounted Phase 2) |
| **Ephemeral cross-screen** | Feed reload after publish | Existing `feedRefresh` pub/sub |

**User-owned state (auth required):** Cart, Saved Collections, Following — not Profile-tab UI ownership.

**Do not** introduce Redux/Zustand/React Query in Phase 0–6 **unless** pagination/cache complexity forces it (re-evaluate at Search Phase 6).

---

## 15. Data ownership

**FROZEN ownership boundaries:**

```text
Catalog          → product mapper      → ProductViewModel (presentation)
User             → identity / auth-related user state; public Creator mapper → CreatorViewModel
Collection       → collection mapper   → CollectionViewModel
CollectionMedia  → media truth (via Collection refs)
Engagement       → engagement service  → save/follow/view/impression facts & edges
Cart             → DB membership SoT   → catalogProductId refs → hydrate ProductViewModel
Search           → search DTO mapper   → canonical VMs (composed) + search telemetry
Shopping         → redirect only       → (no FE merchant model)
Authentication   → gate for user-owned / state-changing actions + intent resume
Product components → presentation only
```

**Rules:**

- UI never binds to DB rows or OpenSearch documents directly  
- Do not duplicate backend SoT in FE  
- Cart must **not** become SoT for title/price/merchant/image/metadata/verification/shopping URL  
- Legacy `Video` mapping remains Feed-owned until Phase 8  
- No domain duplicates another domain’s source of truth  

---

## 16. Backend integration boundaries

| Backend domain | FE consumption | Existing entry points (do not redesign) |
| --- | --- | --- |
| **User** | Public Creator Profile, me/settings, auth subject | `/users/by-username/:username`, `/users/me*` |
| **Collection** | Collection VM, open reel, creator lists (public read) | `GET /collections/:id`, `GET /collections/by-slug/:slug` (+ **list-by-creator gap**) |
| **CollectionMedia** | Via Collection aggregate / media refs | Embedded in Collection reads |
| **CollectionProductTag** | Product refs on Collection | Tags on Collection aggregate |
| **Catalog** | Product VM / Cart hydration | Today: Supabase joins + Create drafts; prefer backend catalog reads as FE migrates off raw table access |
| **Engagement** | Save/Follow/Saved (**auth**) | `/engagement/collections/:id/save`, `/engagement/creators/:id/follow`, `/engagement/me/saves`, `/engagement/me/following` |
| **Search** | Discovery query (**public**) | `/search`, `/search/autocomplete`, `/search/telemetry/click` |
| **Shopping** | Buy | `/products/:id/redirect` |
| **Cart (future backend)** | Authenticated cart membership + hydrated products | **Not present yet** — design in Cart backend phase; FE must not invent schema here |

**FE-facing requirements (no new API design in Phase 0):**

- Authenticated Bearer pattern (existing curation/shopping)  
- Mappers for public Collection + products for View All / Reel hydration  
- Creator Profile needs a **supported** way to list that creator’s published Collections (gap)  
- Cart Phase 2 depends on a DB-backed Cart API with efficient Product hydration  

---

## 17. Cross-domain dependency graph

```text
Auth/Session
    │
    ├── gates: Save, Add to Cart, Follow (+ intent resume)
    ├── Cart (authenticated DB membership)
    ├── Engagement (save/follow)
    └── optional user id on Search telemetry

Catalog ──────────► Product ──────────► Cart (refs catalogProductId; hydrates Product)
                         │
                         └──► Buy / Shopping redirect

User ─────────────► Creator (public) ──► CreatorCollectionList ──► Collection
                                                              │
Collection ────────► Focused Reel / (Phase 8) Home Feed        │
    │                                                         │
    └── productRefs ──► Product                               │
                                                              │
Engagement ◄────── Collection (save, auth)                    │
Engagement ◄────── Creator (follow, auth)                     │
                                                              │
Product + Creator + Collection ────────────────────────► Search (public)
Collection ────────────────────────────────────────────► Save / Saved (auth)

Theme ── (orthogonal) ── all UI chrome
```

**Additional from codebase:**

- Create/Review depends on Product + ingest (creator tooling; parallel track)  
- Home Feed currently depends on Supabase `videos` (legacy), not Collection HTTP  
- Publish dual-write couples Collection id ↔ video id (migration awareness for Phase 8)  
- Existing FE CartContext is local/unmounted stub — **not** V1 SoT

---

## 18. Existing duplication / legacy map

| Area | Artifact | Classification |
| --- | --- | --- |
| Product model | `CatalogProductViewModel` | **KEEP → CANONICALIZE** (rename/extend carefully) |
| Product model | `mocks/videos.Product` | **DEPRECATE LATER** |
| ProductCard | `components/commerce/ProductCard` | **KEEP → CANONICALIZE** (add variants) |
| ProductCard | BottomDock `ProductCardFrame` | **LEAVE UNCHANGED** until Phase 8; then optional swap with parity |
| ProductCard | product-list inline card | **DEPRECATE LATER** |
| Wrappers | `SearchProductCard`, `PublishedVideoProductCard` | **DEPRECATE LATER** (aliases) |
| Wrapper | `ReviewProductCard` | **KEEP** (Create-only composition) |
| Product Details | `ProductDetailsSheet` | **KEEP → CANONICALIZE** |
| Creator | Profile tab | **LEAVE UNCHANGED** as account settings |
| Creator | public profile | **Missing → CREATE** in Phase 3 |
| Collection | FE Collection VM / Tile | **Missing → CREATE** in Phase 4 |
| Reel | Home Feed + ReelItem stack | **LEAVE UNCHANGED** (protected) |
| Cart | stub screen + unmounted local contexts | **CANONICALIZE** in Phase 2 to authenticated DB-backed cart client; dedupe contexts; remove quantity |
| Search | `app/(tabs)/search.tsx` | **CANONICALIZE** in Phase 6 |
| Data | Supabase videos feed | **REUSE** until Phase 7/8; migrate reads deliberately |
| Theme | Titanium/Nebula + Themed* | **KEEP** |
| NativeWind | unused | **LEAVE UNCHANGED** (do not migrate) |

---

## 19. Proposed phased implementation order

Recommended sequence matches the proposed plan with **one clarification** (not a reorder): Phase 4’s “Collection navigation” includes the **Focused Reel host** required by Search/Creator/Saved — still **without** redesigning Home Feed.

| Phase | Name | Why this order |
| --- | --- | --- |
| **0** | FE Domain Architecture | This document — shared contracts before code |
| **1** | Product FE Foundation | Universal dependency for Cart, Search, View All |
| **2** | Cart | Needs stable Product + buy boundary |
| **3** | Creator | Needs identity before Collection lists UX; Follow via Engagement |
| **4** | Collection | Tiles + focused Reel host; Creator Collections presentation |
| **5** | Save / Engagement FE | Needs Collection identity + tiles |
| **6** | Search FE | Needs all three result components + navigation targets |
| **7** | Discovery / Feed / Trending | Only when backend capabilities exist — **do not invent** |
| **8** | Reel Feed Integration | Last — consume canonical pieces with **minimal** UX change |

**Rejected reorder:** Search earlier — would force duplicate temporary cards.  
**Rejected reorder:** Cart before Product — Cart must display canonical Product.  
**Rejected reorder:** Reel integration early — violates protection constraint.

---

## 20. Phase-by-phase scope

### Phase 0 (current)

- This architecture document only  

### Phase 1 — Product FE Foundation

- Canonical ProductViewModel + mapper consolidation  
- ProductCard variants (`compact` / `standard`)  
- ProductDetailsSheet as canonical details (`onAddToCart` / `onBuy` callbacks)  
- Shopping / buy boundary  
- **Add-to-Cart authentication boundary** (orchestration + intent resume; no Cart persistence yet)  
- **Non-goals:** DB Cart implementation, Search, Creator, Feed changes, guest cart  

### Phase 2 — Cart

- **Authenticated users only**  
- **DB-backed persistence** (membership SoT)  
- **One unique cart line per Catalog Product** (no quantity)  
- Cart screen; add/remove  
- Efficient Product hydration for display  
- Buy → external merchant  
- AppState/foreground purchase confirmation (“Did you buy?”)  
- Yes → remove; No → retain  
- **Non-goals:** checkout, payments, orders, guest cart, purchase auto-detection  

### Phase 3 — Creator

- CreatorCard, public CreatorProfile (public browse)  
- Creator Collections presentation  
- **Follow authentication boundary** (Login → resume)  
- **Non-goals:** redesign Profile tab into public profile  

### Phase 4 — Collection

- CollectionViewModel + CollectionTile  
- Collection navigation + Focused Reel presentation host (reuse reel components)  
- **Preserve existing Reel Feed** (no redesign)  
- **Non-goals:** new Collection Detail product UI  

### Phase 5 — Save / Engagement FE

- **Authenticated users only**; Login gate + intent resume  
- Save/Unsave via Engagement; one Save pattern  
- Saved Collections surface  
- **Non-goals:** guest Save, reinvent Engagement SoT  

### Phase 6 — Search FE

- **Publicly accessible** — no login required to search  
- Landing + active results, autocomplete, telemetry  
- Collection / Creator / Product results via canonical components  
- Save / Add to Cart require authentication (gates only)  
- **Non-goals:** owning trending/recs; gating Search behind login  

### Phase 7 — Discovery integrations

- Wire real trending/popular/recs **when backends exist**  

### Phase 8 — Reel Feed Integration

- Minimal wiring of Product/Creator/Save/Cart into protected Feed  
- Auth gates for Save / Add to Cart without changing Reel visual hierarchy  
- Strict UX parity gate  

---

## 21. Explicit non-goals (all near-term phases)

- Redesigning Home Reel Feed  
- NativeWind / new design system migration  
- Redux/Zustand/React Query introduction without proven need  
- Payment / checkout / order management / automatic purchase verification  
- **Guest Cart / guest Save / AsyncStorage cart SoT / anonymous cart APIs**  
- FE-owned trending, recommendations, or ranking engines  
- Parallel Product/Creator/Collection models per surface  
- New backend domain redesign inside Phase 0 (Cart backend design is a later phase, not invented here)  
- Video hosting / upload product  
- Implementing Phase 1–8 in Phase 0  
- Quantity steppers in Cart V1  

---

## 22. Open architectural decisions

### 22.1 Resolved (FROZEN this revision)

| ID | Decision | Resolution |
| --- | --- | --- |
| OD-3 | Cart quantity | **V1 unique product lines; no quantity** |
| OD-4 | Cart persistence | **DB-backed for authenticated users** (not AsyncStorage SoT) |
| OD-9 | Guest Cart | **No** |
| OD-10 | Purchase confirmation trigger | **Explicit Yes/No after AppState foreground return**; no automatic purchase inference |
| — | Guest Save | **No** |
| — | Browse without auth | **Yes** (read-only discovery / Reel / Search / Creator / Product Details) |
| — | ProductCard / ProductDetails ownership | **Emit `onAddToCart` / `onBuy` only**; never own authentication, navigation, or Cart persistence |

### 22.2 Still open (later phases)

| ID | Decision | Options / notes |
| --- | --- | --- |
| OD-1 | Focused Reel route shape | `/reel/[collectionId]` vs `/collection/[id]/play` — recommend reel host naming to avoid “Detail page” confusion |
| OD-2 | Product Details as sheet-only vs shareable stack route | Recommend sheet-first V1 |
| OD-5 | Search landing interim content | Empty state vs chronological recent Collections — **no fake trending** |
| OD-6 | Creator Collections list API | Backend list-by-creator (or equivalent) required before Phase 3 completion |
| OD-7 | When Feed stops using Supabase `videos` | Phase 8 vs earlier read migration |
| OD-8 | Compact ProductCard vs keep custom dock chrome permanently | Phase 8 parity test decides |
| OD-11 | Cart backend domain placement | Exact schema/API/service ownership for DB Cart (Commerce vs new Cart BC) — **not invented in FE Phase 0** |
| OD-12 | Intent-resume storage mechanics | In-memory vs short-lived persisted intent across auth deep links — implement in Phases 1–5 |

---

## 23. Risks / dependencies

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Video ↔ Collection dual-write drift | Broken deep links | Treat ids as coupled until explicit migration; Phase 8 checklist |
| Missing creator collection list API | Blocks Creator Profile completeness | Resolve OD-6 before Phase 3 done criteria |
| No trending backend | Weak Search landing | Honest empty/recent only (OD-5) |
| **No Cart backend yet** | Blocks Phase 2 completion | Cart backend design before/with Phase 2; FE must not invent schema in Phase 0 |
| Cart stub implies guest/local cart | Architecture drift | Treat stub as legacy; Phase 2 replaces with auth DB client |
| Integrating Product into Feed too early | UX regression | Hard Phase 8 gate |
| Search FE before CollectionTile/CreatorCard | Duplicate UI | Keep Phase 6 after 3–4 |
| Engagement vs Search telemetry mix-up | Wrong analytics owner | Separate clients/events |
| Auth intent loss across OAuth | User must re-tap Save/Add | Design intent resume (OD-12); Profile auth already exists |
| FE reading Supabase tables bypassing domain APIs | Drift from SoT | Prefer domain HTTP as surfaces rebuild |

---

## 24. Consistency audit

### 24.1 Against existing FE architecture (`FE_ARCHITECTURE_AUDIT.md`)

| Topic | Existing FE | Target architecture | Conflict? |
| --- | --- | --- | --- |
| Stack / Expo Router | Yes | Keep | No |
| State approach | Local + Context | Keep; authenticated Cart client over DB | No |
| Theme Titanium/Nebula | Yes | Keep | No |
| ProductDetailsSheet | Create Review | Promote to canonical consumer details | Intentional elevation |
| Dual Product models | Legacy + Catalog VM | Catalog VM wins | Known debt |
| Reel Feed UX | Protected production | Explicit protection until Phase 8; public browse | Aligned |
| Search tab | Placeholder filter | Rebuild Phase 6; **public** | Aligned |
| Profile tab | Account | Remains account; public Creator separate | Aligned |
| Cart stub / local Context | Unmounted AsyncStorage-style cart | **Superseded** — auth DB Cart; stub is legacy | **Intentional supersession** of prior Phase 0 AsyncStorage recommendation |
| Guest browse | Implicitly possible today | Explicit public browse policy | Aligned |
| NativeWind | Unused | Stay unused | Aligned |

### 24.2 Against backend domain specs

| Spec | Relevant claim | FE architecture alignment |
| --- | --- | --- |
| **CATALOG_DOMAIN_SPEC / IMPLEMENTATION_PLAN** | CatalogService sole write authority; Catalog owns product identity/metadata/verification | **Aligned** — Cart must not become Product SoT; hydrate from Catalog |
| **ENGAGEMENT_DOMAIN_SPEC** | Save/Follow edges owned by Engagement; Save requires user (relationship edges); anonymous allowed for some view/impression facts | **Aligned** — FE Save/Follow auth-gated; no guest Save edges |
| **USER_DOMAIN_SPEC** | User = auth identity + profile; shopping carts listed as **not** User-owned (Commerce) | **Aligned on User ≠ Cart SoT**; **gap** — DB Cart backend BC not specified yet (OD-11) |
| **SEARCH_DOMAIN_SPEC** | Search is read-side discovery; does not own Engagement/Cart; optional anonymous hot query cache | **Aligned** — Search public; Save/Cart not Search-owned |

**Discrepancy handling rule:** Prefer repository + frozen product decisions in this doc; update when Cart backend lands.

---

## 25. Design system constraint

Reuse only:

- `ThemeContext` (Titanium/Nebula)  
- `constants/theme.ts`, `ThemedText`, `ThemedView`, `IconSymbol`  
- Existing commerce + media components  

Do **not** introduce NativeWind migration, new styling frameworks, or unrelated visual redesigns during Phases 1–8.

---

## 26. Summary of key architectural decisions

1. **`CatalogProductViewModel` → canonical Product** (extend; stop new legacy `Product` usage).  
2. **One ProductCard** with `compact` | `standard` variants; no surface-named product cards by default.  
3. **ProductDetailsSheet is canonical Product Details** for V1.  
4. **Browse is public; Save / Add to Cart / Follow require authentication** with Login → intent resume.  
5. **Cart is authenticated + DB-backed**; unique `(userId, catalogProductId)`; no quantity; no guest/AsyncStorage SoT.  
6. **Catalog remains Product SoT**; Cart stores references + cart state; efficient hydration required.  
7. **Buy stays Shopping redirect**; purchase confirmation is explicit Yes/No after AppState foreground — no auto-detect.  
8. **ProductCard / ProductDetails emit `onAddToCart` and `onBuy` only** — they never own authentication, navigation, or Cart persistence.  
9. **Public Creator Profile ≠ Profile tab**; Follow auth-gated.  
10. **CollectionTile + Focused Reel host**; Home Feed protected; Collections publicly browseable.  
11. **Save/Follow via Engagement only**; one Save pattern; no guest Save.  
12. **Search is public** and composes domain components; does not own entities or trending.  
13. **Implementation order 0→8**; Reel integration last.  

---

### Frozen decision register (Phase 0 complete)

| Area | Frozen decision |
| --- | --- |
| Product presentation components | Emit `onAddToCart` / `onBuy` only; no auth / navigation / Cart persistence |
| Browse | Public without authentication |
| Save / Add to Cart / Follow | Authenticated; Login → intent resume |
| Cart | Auth-only; DB SoT; unique product lines; no quantity; no guest cart |
| Catalog | Product SoT; Cart holds references + hydrates |
| Purchase confirmation | Explicit Yes/No after AppState foreground |
| Reel Feed | Protected until Phase 8 |
| Search | Public discovery surface; composes domain components |

---

*Phase 0 FROZEN. No implementation performed in this document. Do not treat this file as permission to modify the Reel Feed. Proceed to Phase 1 (Product FE Foundation) for code.*
