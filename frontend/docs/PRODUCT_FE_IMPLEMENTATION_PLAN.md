# PHASE 1 — PRODUCT FE FOUNDATION (Implementation Plan)

**Status:** Planning only (no code changes)  
**Document path:** `frontend/docs/PRODUCT_FE_IMPLEMENTATION_PLAN.md`  
**Baseline:**  
1) `frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md` (authoritative canonical Product architecture)  
2) `frontend/docs/FE_ARCHITECTURE_AUDIT.md` (what exists today)  
**Hard constraint:** Do **not** modify Reel Feed or any TS/TSX in this task.

---

## 1. Phase 1 objective

Phase 1 establishes the **canonical Product FE foundation** that can later be reused by:

- the existing Reel/Collection experience (compact presentation)
- `/product-list/[id]` (View All products)
- Cart (standard presentation + add-to-cart boundary)
- Creator Collections
- Search results (active results)
- future discovery surfaces

Phase 1 must implement the architecture safely against the current frontend codebase, without redesigning surfaces in this phase.

Canonical Product architecture is frozen in:

- `frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md`

Phase 1 may change implementation details of Product components to **conform** to the frozen contract, but it must not redesign the Reel Feed.

---

## 2. Frozen Product decisions (non-negotiable constraints)

From `FE_DOMAIN_ARCHITECTURE_V1.md` + this task:

1. **`CatalogProductViewModel` is the seed** of the canonical Product FE model.
2. **One canonical ProductCard** with variants:
   - `compact`
   - `standard`
3. **Do NOT create** surface-named product card components (`SearchProductCard`, `CartProductCard`, etc.). Wrappers may exist only if already present; if wrappers are required later, they must compose canonical `ProductCard`.
4. **ProductDetailsSheet** is the canonical V1 Product Details experience.
5. Product components **must not** own:
   - authentication
   - Cart state / persistence
   - navigation decisions (routing/sheet opening)
6. Product components expose callbacks such as:
   - `onPress`
   - `onAddToCart`
   - `onBuy`
7. Parent/domain orchestration decides:
   - how Product Details opens
   - auth gating for add-to-cart
   - future Cart boundary behavior
   - shopping redirect execution
8. **Buy is not authentication-gated.**
9. **Add to Cart is authentication-gated.**
10. **No guest Cart.**
11. **No AsyncStorage Cart persistence.**
12. **Cart is Phase 2 and DB-backed.**
13. Phase 1 only prepares the **Add-to-Cart boundary**, it does not implement Cart persistence.
14. Catalog remains the Product source of truth.
15. Shopping owns merchant destination resolution (via existing `shoppingClick.ts` boundary).
16. Existing Reel Feed is protected until Phase 8.

---

## 3. First: audit current Product implementation (what exists now)

### 3.1 Canonical types + mapping

**Type:** `src/types/catalogProduct.ts`
 - `CatalogProductViewModel` includes:
   - `id` (frontend identity)
   - `catalogProductId` (shopping identity key; may be `null` for some draft paths)
   - `title`, `brand`, `merchant`
   - `heroImage`, `galleryImages`, `description`, `shortDescription`
   - `specifications`
   - `verificationStatus` (`VERIFIED | UNVERIFIED | UNRESOLVED`)
   - `availability`
   - `price`, `currency`, `lastVerifiedAt`, `metadataCompleteness`

**Mapper:** `src/services/catalogProductMapper.ts`
 - `catalogRowToViewModel(row: CatalogProductRow)`: maps persisted catalog rows
 - `draftProductToViewModel(draft)`: maps Create/Review draft products (including optional denormalized draft data fallback)
 - `displayHeroUri(product)`: selects hero image fallback or placeholder

### 3.2 Canonical ProductCard (exists, but contract gaps)

**File:** `components/commerce/ProductCard.tsx`

Current implementation:
 - Props currently are **only**:
   - `product: CatalogProductViewModel`
   - `isLight: boolean`
   - `onPress(product)`
 - There is **no `variant` prop** (no `compact | standard`)
 - There is **no `onAddToCart`**
 - There is **no `onBuy`**
 - UI currently shows:
   - image
   - brand (optional)
   - title
   - `VerificationBadge`
   - merchant
   - price only when `verificationStatus === VERIFIED`

### 3.3 Canonical ProductDetailsSheet (exists, but contract gaps)

**File:** `components/commerce/ProductDetailsSheet.tsx`

Current implementation:
 - Props currently are:
   - `visible`, `product`, `isLight`, `onClose`, `actions?: ProductDetailsActionConfig`
 - It **already has a View Product CTA** (`"View Product"`)
 - That CTA **directly calls** `openProductShopping` from `src/services/shoppingClick.ts` inside the component
 - There is **no** `onBuy` callback hook
 - There is **no** `onAddToCart` hook/button
 - Verification behavior:
   - showPrice depends on `product.price` truthiness (not verification status)
 - Shopping destination behavior:
   - if `product.catalogProductId` is missing, it alerts “Link unavailable…”

### 3.4 Current consumers (how Product components are used today)

**ProductCard consumers**
 - `app/(tabs)/create/review.tsx` via `ReviewProductCard` (Create-only wrapper)

**ProductDetailsSheet consumers**
 - `app/(tabs)/create/review.tsx` directly (Create-only product details modal)

**Wrappers**
 - `components/commerce/wrappers/ReviewProductCard.tsx`: composes `ProductCard`
 - `components/commerce/wrappers/SearchProductCard.tsx`: composes `ProductCard` (unused by current Search tab)
 - `components/commerce/wrappers/PublishedVideoProductCard.tsx`: composes `ProductCard` (unused by current Reel feed)

### 3.5 Legacy / duplicated product representations (must migrate safely later)

Legacy product sources used by protected surfaces today:
 - `src/mocks/videos.ts` (legacy `Video` and legacy `Product` types)
 - `components/BottomDock.tsx` uses `BottomDock`’s local `ProductCardFrame` to render compact reel dock chips (legacy `Product`)
 - `app/product-list/[id].tsx` uses an inline `ProductCard` (legacy `Video.Product` + Buy Now/Add to Bag stub)

### 3.6 Shopping redirect boundary (already exists)

**File:** `src/services/shoppingClick.ts`
 - `openProductShopping({ catalogProductId, videoId?, creatorId?, country? })`
 - Opens only backend redirect URL via `Linking.openURL`
 - Client never resolves merchant destinations directly.

Today:
 - ProductDetailsSheet calls `openProductShopping` directly
 - Other areas call `openProductShopping` directly (e.g. inline product-list card).

Phase 1 goal:
 - move “Buy redirect execution” into parent/orchestration via `onBuy` callback (contract alignment).

---

## 4. Product implementation audit (classify what to keep / change in Phase 1)

This classification describes what Phase 1 should do with each discovered Product artifact.

### Migration table (Phase 1 scope only)

| Artifact | Current role | Consumers today | Target role | Phase 1 action | Risk |
| --- | --- | --- | --- | --- | --- |
| `src/types/catalogProduct.ts` (`CatalogProductViewModel`) | canonical Product view model seed | mapper + ProductCard/Sheet | **KEEP as canonical seed** | none (may add alias only if needed) | low |
| `src/services/catalogProductMapper.ts` | maps catalog/draft rows into canonical view model | Create review + mappers | **CONSOLIDATE** canonical mapping usage | none, but ensure Phase 1 uses view-model consistently | low |
| `components/commerce/ProductCard.tsx` | exists but lacks variant + action callbacks | Create review via `ReviewProductCard` | **CANONICALIZE** to contract: `variant`, `onAddToCart`, `onBuy` | extend props + optional actions rendering | medium (must keep current create/review UX unchanged) |
| `components/commerce/ProductDetailsSheet.tsx` | exists but does direct buy execution | Create review | **CANONICALIZE** to contract: `onBuy`, `onAddToCart` | refactor CTA to call callbacks; add add-to-cart UI only if callback provided | medium (must preserve existing “View Product” behavior via `onBuy`) |
| `components/commerce/wrappers/ReviewProductCard.tsx` | Create-only composition | create review | KEEP (composition only) | no behavioral change; ensure wrapper compiles with new ProductCard props | low |
| `components/commerce/wrappers/SearchProductCard.tsx` | thin alias wrapper | none today | DEPRECATE LATER | leave; ensure it composes updated ProductCard | low |
| `components/commerce/wrappers/PublishedVideoProductCard.tsx` | thin alias wrapper | none today | DEPRECATE LATER | leave; ensure it composes updated ProductCard | low |
| `app/product-list/[id].tsx` inline legacy `ProductCard` | View All products current implementation | route `/product-list/[id]` | LEAVE UNCHANGED in Phase 1 | **defer** canonical ProductCard integration (UX mismatch) | low |
| `components/BottomDock.tsx` `ProductCardFrame` | protected reel dock | Home reel feed | LEAVE UNCHANGED (Phase 8) | no changes in Phase 1 | zero risk (protected) |
| `src/mocks/videos.ts` legacy `Product` | legacy product type | Reel feed + product-list | DEPRECATE LATER | Phase 1 only document; no migration | medium in later phases |
| `src/services/shoppingClick.ts` | redirect boundary | used across app | KEEP boundary | no changes; Product components call it via callbacks in Phase 1 | low |

### Protected reel feed identification

If the planned Phase 1 edits touch only `components/commerce/*` and `app/(tabs)/create/review.tsx`, then protected reel feed usage is unaffected because reel dock uses `BottomDock`’s own local legacy card.

Any attempt to integrate `components/commerce/ProductCard` into `BottomDock` is explicitly deferred to Phase 8.

---

## 5. Canonical Product model plan (how `CatalogProductViewModel` becomes canonical)

### 5.1 Naming decision

For Phase 1, minimize churn:

- **Decision:** keep `CatalogProductViewModel` as the canonical type name in the codebase.
- Optionally (future-facing): introduce `export type ProductViewModel = CatalogProductViewModel` as an alias for readability, but do not change the primary name in this planning document unless the implementation team agrees.

### 5.2 Field audit vs component needs

**ProductCard needs (already present):**
- hero image / thumbnail: `heroImage` or `galleryImages[0]`
- title: `title`
- merchant text: `merchant`
- verification: `verificationStatus` (for price display + badge)
- price display: `price`, `currency`
- fallback/placeholder: `displayHeroUri(product)`

**ProductDetailsSheet needs (already present):**
- gallery: `galleryImages` and/or `heroImage`
- brand: `brand`
- title: `title`
- merchant: `merchant`
- verification: `verificationStatus`
- price/currency: `price`, `currency`
- availability: `availability`
- description: `description`
- specs: `specifications`
- shopping destination identity: `catalogProductId`

### 5.3 What is missing for Phase 1 (and should NOT be invented)

Phase 1 does **not** require:
- cart membership state fields
- quantity
- dedicated “reel dock” product-specific fields

Phase 1 **does** require contract-aligned *component props*:
- `variant`
- `onAddToCart`
- `onBuy` callbacks

---

## 6. Mapper / data flow (exact flow)

Frozen canonical data flow:

```text
Catalog / backend catalog join
  ↓
catalogProductMapper (catalogRowToViewModel / draftProductToViewModel)
  ↓
CatalogProductViewModel
  ↓
ProductCard (variant: compact|standard)
  ↓
ProductDetailsSheet (sheet-first details)
```

Notes:
- Draft path is still supported by `draftProductToViewModel` (Create/Review).
- Phase 1 should avoid any additional product mapping logic in UI components beyond calling mapper outputs.

---

## 7. ProductCard architecture (Phase 1 plan)

### 7.1 Can `components/commerce/ProductCard.tsx` evolve directly?

Yes: evolve the existing ProductCard in place to match the frozen contract.

### 7.2 Target ProductCard props contract

Phase 1 should add:

- `variant: 'compact' | 'standard'` (default: `standard` for backward compatibility)
- optional action callbacks:
  - `onAddToCart?: (product: CatalogProductViewModel) => void`
  - `onBuy?: (product: CatalogProductViewModel) => void`
- required existing props remain:
  - `product`
  - `isLight`
  - `onPress(product)`

All action and auth logic stays outside the component:
- ProductCard calls callbacks
- Parent/orchestration performs:
  - auth check
  - intent resume
  - Cart/Buy execution

### 7.3 Required UI variants

#### Standard variant
- Preserve existing layout as much as possible
- Keep:
  - merchant line
  - verification badge
  - price only when `verificationStatus === VERIFIED` (current behavior)
- Add optional action UI only when `onAddToCart` / `onBuy` is provided.

#### Compact variant
- Must be designed for later Reel dock integration (Phase 8), but not wired now.
- Target behavior (design guidance, not a redesign now):
  - show image and minimal price/verification
  - hide verbose text (brand/merchant) to match dock density
  - still display verification badge if that’s required by product policy

### 7.4 Loading / missing / unavailable behavior (Phase 1 expectations)

Phase 1 should rely on existing view-model semantics:

- **Missing image:** `ProductHeroImage` already substitutes `CATALOG_IMAGE_PLACEHOLDER` when URI is missing or not HTTP.
- **Missing price:** show no price/price line when `product.price` is `null` or price gating conditions fail.
- **Unverified:** price should not be shown because current `showPrice` logic depends on `verificationStatus === 'VERIFIED'`.
- **Missing shopping destination (`catalogProductId === null`):**
  - ProductCard should either:
    - hide Buy/Add to Cart actions, OR
    - disable them and present “unavailable” state
  - It must not silently call actions with missing identity.

### 7.5 Action buttons / accessibility

Phase 1 should specify:
- Action touch targets are buttons (accessibilityRole="button")
- Accessibility labels:
  - “Add to cart” should include product title
  - “Buy” should include product title

Touch behavior:
- Card press remains the canonical “open product details” affordance.
- Add-to-cart/buy actions should not trigger `onPress` unless explicitly configured.

---

## 8. ProductDetailsSheet architecture (Phase 1 plan)

### 8.1 Current state

ProductDetailsSheet currently:
- is sheet-first (Modal)
- already renders rich product presentation
- includes a “View Product” CTA that directly calls `openProductShopping`
- has no add-to-cart CTA.

### 8.2 Target contract in Phase 1

Phase 1 should extend ProductDetailsSheet to accept callbacks:
- `onBuy?: (product: CatalogProductViewModel) => void`
- `onAddToCart?: (product: CatalogProductViewModel) => void`

Behavior:
- “View Product” CTA:
  - if `onBuy` exists → call `onBuy(product)`
  - else → (implementation decision) optionally preserve current direct openProductShopping for temporary backward compatibility
  - the preferred architecture is that parents execute shopping redirect; ProductDetailsSheet should not.
- Add-to-cart CTA:
  - only render if `onAddToCart` provided
  - calling `onAddToCart(product)` triggers auth gate via parent/orchestration.

### 8.3 Existing Create/Review action configuration compatibility

ProductDetailsSheet currently supports `actions.enabled` with:
- replace / refresh / remove

Phase 1 must not break:
- `detailsActions` passed by `app/(tabs)/create/review.tsx`

Recommended implementation behavior:
- add-to-cart UI should be additive and only appear when callback provided.
- create/review does not pass callbacks (or passes `undefined`) so UI remains unchanged.

### 8.4 Verification and availability in sheet

Do not invent new UI semantics:
- use existing `verificationStatus` and `availability` fields already rendered.

### 8.5 Shopping/buy integration (Phase 1)

Replace internal redirect execution with `onBuy`:
- existing `src/services/shoppingClick.ts` remains unchanged
- parent/orchestration calls it based on product identity (`catalogProductId`)

---

## 9. Shopping / buy integration

### 9.1 Exact integration point

Phase 1 will align with frozen ownership:

| Responsibility | Location |
| --- | --- |
| Determine shopping redirect URL | `shoppingClick.ts` (already exists) |
| Execute redirect (`Linking.openURL`) | via parent/orchestration calling `openProductShopping` |
| Trigger buy from UI | `ProductCard` / `ProductDetailsSheet` calls `onBuy(product)` |

### 9.2 Current behavior when fields are missing (do not invent)

From current code:
- ProductDetailsSheet “View Product” checks `product.catalogProductId`:
  - if null → alert “Link unavailable…”
- ProductCard currently has no buy button (Phase 1 will add logic).

Phase 1 should preserve this semantics:
- missing destination must not attempt redirect
- should show/alert consistently with current sheet CTA behavior.

### 9.3 Existing consumers of shoppingClick

Today:
- ProductDetailsSheet calls shoppingClick directly
- inline product-list card calls shoppingClick directly

Phase 1 scope:
- only change canonical product components to use `onBuy` callback,
  - keep other legacy consumers intact.

---

## 10. Add-to-cart authentication boundary (Phase 1 plan)

Phase 1 must prepare Product layer for Phase 2 without implementing cart persistence.

### 10.1 Where the authentication check belongs

Per frozen architecture:
- ProductCard/ProductDetailsSheet must not own auth.
- Parent/domain orchestration decides:
  - if user is authenticated → execute add-to-cart boundary (Phase 2 later)
  - if unauthenticated → navigate to Login UI and preserve intent

### 10.2 Current login UI / auth architecture

Auth state is exposed by:
- `contexts/AuthContext.tsx` (`useAuth()` gives `{ user, loading, signInWithEmail, ... }`)

Login UI route:
- `app/(tabs)/profile.tsx` acts as current signed-in profile/auth UI.

### 10.3 Phase 1 responsibilities

Phase 1 should implement:
- Product components accept and invoke `onAddToCart(product)` callback.

Phase 1 does NOT implement:
- DB cart persistence
- Cart API
- guest cart

### 10.4 Intent resume architecture (OD-12 remains open)

Phase 1 should define *where* intent is represented, without committing to exact storage mechanics:

Possible mechanisms (to be selected during implementation):
1) Navigation params:
   - after login, parse `intent` + `catalogProductId` and resume
2) Short-lived in-memory intent store:
   - set before navigating to profile
3) Deep-link back from external auth:
   - if needed by platform specifics

**Phase 1 plan output must not decide storage mechanics** as an implementation mandate unless product confirms OD-12 solution.

---

## 11. Intent-resume boundary (planning for OD-12)

**Frozen requirement:** intent resume should allow Add to Cart to resume `addToCart(catalogProductId)` after login.

**What exists today:**
- profile screen currently handles sign-in UI but does not parse any intent-resume payload.
- `AuthCallbackScreen` redirects to `/(tabs)/profile` after session.

**Phase 1 plan:**
- define a future contract:
  - “Login action must optionally accept resume payload”
- specify that OD-12 will be resolved in Phase 1 implementation:
  - either navigation params or an in-memory store.

This planning document does not implement it.

---

## 12. View All Products compatibility (`/product-list/[id]`)

### 12.1 Current implementation

`app/product-list/[id].tsx` uses:
- a local inline `ProductCard` that:
  - displays legacy `Video.Product` fields
  - offers “Buy Now” (calls `openProductShopping`) and “Add to Bag” (stubbed / console + alert)

### 12.2 Compatibility decision for Phase 1

Because the inline product-list card has a materially different visual hierarchy and actions,
Phase 1 should **defer integrating** canonical `components/commerce/ProductCard` into `/product-list/[id]`.

Reasons:
- UX mismatch: inline card is “image + stacked title + price + large buttons”
- canonical ProductCard is a compact horizontal row designed for commerce cards and later dock compatibility
- switching in Phase 1 would alter the View All surface, which the task forbids.

**Phase 1 action:** none on `/product-list/[id]`. Defer integration to a later phase (likely Phase 6 or Phase 8 depending on domain plan).

---

## 13. Create / Review compatibility

Create review uses canonical product components today:
- `ReviewProductCard` composes `ProductCard`
- `ProductDetailsSheet` opens as details modal

Phase 1 must:
- preserve existing review UX:
  - tapping a card still opens details
  - details sheet shows View Product and replace/refresh/remove actions

Implementation plan changes:
- update `ProductDetailsSheet` so “View Product” uses `onBuy` callback.
- update create/review to pass `onBuy` that calls `openProductShopping` so behavior remains unchanged.
- keep `onAddToCart` undefined in create/review so add-to-cart UI does not appear.

This ensures creator tooling remains visually and behaviorally stable.

---

## 14. Reel Feed — hard protection (Phase 1)

Protected surfaces:
- `components/BottomDock.tsx` and `ProductCardFrame`
- `components/ReelItem.tsx` and platform reel wrappers

Phase 1 must NOT:
- modify bottom dock product chip UI
- modify reel interactions
- replace `BottomDock` chips with canonical `components/commerce/ProductCard`

How Phase 1 supports reel later:
- implement the `compact` variant in canonical `ProductCard` so Reel can integrate in Phase 8 without inventing a new representation.

---

## 15. Legacy product migration plan (safe & incremental)

Goal: stop new duplication while keeping the app working.

### Migration approach (no deletion in Phase 1)

1) Canonical components evolve:
   - ProductCard and ProductDetailsSheet align to frozen contracts
2) New consumers (future phases) use canonical model:
   - Search, Creator Collections, Cart
3) Protected legacy surfaces remain untouched:
   - Reel Feed dock chips
   - View All Products page UI

### Legacy items and Phase 1 involvement

| Legacy artifact | Classification | Phase 1 action | Deprecation target |
| --- | --- | --- | --- |
| `src/mocks/videos.ts` legacy `Video.Product` | DEPRECATE LATER | none | Phase 7–8 integration |
| `components/BottomDock.tsx` `ProductCardFrame` | LEAVE UNCHANGED | none | Phase 8 only |
| inline `app/product-list/[id].tsx` ProductCard | LEAVE/DEFER | none | later integration |
| `SearchProductCard`, `PublishedVideoProductCard` wrappers | DEPRECATE LATER | keep compiling with new ProductCard signature | later cleanup |

---

## 16. State / data ownership (Phase 1 only)

Per frozen architecture:
- Local UI state:
  - sheet visibility, gallery index, description expansion (ProductDetailsSheet already owns these)
- Server state:
  - Product data from catalog mapper (already exists)
- Domain state:
  - Auth state from AuthContext
  - Future Cart state (DB-backed) is Phase 2; Phase 1 does not implement

No global state frameworks (Redux/Zustand/React Query) should be introduced in Phase 1 unless the current implementation forces it. Current product usage is local + mapper-based.

---

## 17. Product states and UI behaviors (Phase 1 expectations)

Use the existing catalog semantics from `CatalogProductViewModel`:

### 17.1 Loading
- ProductCard: if `product` is absent, do not render (parent ensures data exists)
- ProductDetailsSheet: current code returns `null` when `product` is null; review screen owns product availability

### 17.2 Missing image
- already handled by `ProductHeroImage` placeholder

### 17.3 Missing price
- ProductCard shows price only if:
  - `verificationStatus === VERIFIED`
  - `product.price` exists and is not `'—'`
- ProductDetailsSheet shows price only if `product.price` is truthy

### 17.4 Unavailable
- ProductDetailsSheet already renders `product.availability` if present
- ProductCard should not invent new UI; it may show actions disabled if availability is a known policy

### 17.5 Unverified / unresolved
- ProductCard currently:
  - always shows VerificationBadge
  - hides price when not verified

### 17.6 Missing shopping destination
- ProductDetailsSheet already alerts on View Product when `product.catalogProductId` is missing
- ProductCard action buttons (Phase 1 implementation) must similarly disable/hide Buy/Add-to-Cart actions when `catalogProductId` missing

### 17.7 Redirect failure
- current “View Product” catches and alerts “Could not open the product link”
- Phase 1 should preserve this behavior via parent/orchestration or keep consistent error handling

---

## 18. Performance plan

Phase 1 must avoid:
- N+1 requests in ProductCard/ProductDetailsSheet
- redundant product mapping logic

Current performance characteristics:
- ProductCard reads only from `CatalogProductViewModel` prop
- ProductDetailsSheet reads only from `CatalogProductViewModel` prop and renders memoized gallery

Performance rules for Phase 1 implementation:
- keep `ProductCard` rendering pure and cheap
- do not add data fetching to Product components
- preserve memoization patterns where already present (ProductDetailsSheet gallery memo)

---

## 19. Testing / verification plan (minimal, no new test harness claims)

The FE currently has no established test harness.

Phase 1 verification should be:
- TypeScript correctness:
  - ensure build/tsc (or expo lint/typecheck) passes
- Manual acceptance scenarios (must be executed by developers/QA):
  1. ProductCard renders canonical Product with `variant=standard`
  2. ProductCard renders canonical Product with `variant=compact`
  3. ProductCard triggers `onPress(product)` to open ProductDetailsSheet (Create review flow)
  4. ProductDetailsSheet opens from ProductCard in Create review
  5. “View Product” still redirects via `shoppingClick` after refactor (Create review)
  6. ProductDetailsSheet shows add-to-cart UI only when `onAddToCart` callback is provided
  7. Auth boundary is wired (Phase 1 should only wire the boundary entry point; actual Cart persistence is Phase 2)
  8. Create/Review remains functional:
     - replace/refresh/remove actions still show and fire
  9. Reel Feed remains unchanged (no integration in Phase 1)
  10. View All Products remains functional (no refactor in Phase 1)

No new automated FE tests are asserted in this plan.

---

## 20. Exact file changes (expected in Phase 1 implementation)

Planning-only. The table states what the implementation team should change later.

| Create/Modify/Reuse/Deprecate Later/Do not touch | File path | Reason | Exact type of change (implementation intent) | Consumer impact | Risk | Touches protected Reel Feed? |
| --- | --- | --- | --- | --- | --- | --- |
| MODIFY | `components/commerce/ProductCard.tsx` | Bring ProductCard to frozen contract | Add `variant` prop + optional `onAddToCart`/`onBuy` callbacks; render action UI only when callbacks exist | Create review still compiles; no UX change if callbacks absent | medium | No |
| MODIFY | `components/commerce/ProductDetailsSheet.tsx` | Make ProductDetailsSheet canonical buy/add-to-cart contract | Replace internal `openProductShopping` with `onBuy` callback; add optional `onAddToCart` UI/button | Create review continues to show “View Product” by passing `onBuy` | medium | No |
| MODIFY | `app/(tabs)/create/review.tsx` | Maintain behavior with new callbacks | Pass `onBuy` to ProductDetailsSheet; do not pass `onAddToCart` in Create review | Keeps create tooling UX unchanged | low/medium | No |
| MODIFY | `components/commerce/wrappers/ReviewProductCard.tsx` | Ensure wrapper compiles with ProductCard prop changes | Update wrapper prop types if needed; keep composition only | Create review stable | low | No |
| MODIFY | `components/commerce/wrappers/SearchProductCard.tsx` and `PublishedVideoProductCard.tsx` | Compile with new ProductCard signature | Update wrapper types to pass required props or rely on defaults | No runtime change yet | low | No |
| DO NOT TOUCH | `components/BottomDock.tsx` | Reel Feed protected | none | none | zero | YES (must not touch) |
| DO NOT TOUCH | `components/ReelItem.tsx`, platform reel item components | Reel Feed protected | none | none | zero | YES (must not touch) |
| DO NOT TOUCH | `app/product-list/[id].tsx` | View All must not be redesigned | none | no UX change | zero | No |

---

## 21. Implementation order (safest sequence)

This is the recommended safest sequence within Phase 1:

1. **Canonical component contract updates**
   - Update `ProductCard` to accept:
     - `variant` (default `standard`)
     - optional callbacks: `onAddToCart`, `onBuy`
   - Ensure existing Create review still compiles and renders identical UI when callbacks not supplied.
2. **ProductDetailsSheet callback refactor**
   - Update `ProductDetailsSheet` to use `onBuy` callback rather than direct `openProductShopping`.
   - Add optional add-to-cart UI only when `onAddToCart` provided.
3. **Create/Review compatibility**
   - Update `app/(tabs)/create/review.tsx` to pass `onBuy` so “View Product” remains functional.
4. **Wrapper type compatibility**
   - Update `ReviewProductCard`, `SearchProductCard`, `PublishedVideoProductCard` to compile.
5. **Manual verification**
   - Run manual QA scenarios listed in §19.

No integration into protected Reel Feed and no View All redesign occurs in Phase 1.

---

## 22. Risks

1. **Contract mismatch with frozen architecture**
   - ProductCard and ProductDetailsSheet currently violate the “no ownership of shopping redirect execution” boundary.
   - Phase 1 must refactor carefully to preserve behavior in Create review.
2. **Create/Review UX regression**
   - If ProductDetailsSheet changes CTA labeling/layout or action button rendering unexpectedly, it may break the creator workflow.
3. **Event tracking consistency**
   - ProductCard uses `product.id` for analytics fields today.
   - If ProductCard events should use `catalogProductId`, this may require attention in Phase 1 implementation.
4. **Variant UX correctness**
   - `compact` variant should be designed for future Reel dock integration; Phase 1 must not break current UI.

---

## 23. Dependencies

- `CatalogProductViewModel` + mapper must remain stable (already exists).
- `shoppingClick.ts` redirect boundary must remain unchanged.
- Auth state must continue to be provided via `useAuth()` from `contexts/AuthContext.tsx`.
- Login UI is currently `app/(tabs)/profile.tsx`.

OD-12 (intent-resume mechanics) is still unresolved and will be decided during Phase 1 implementation planning unless product confirms a mechanism.

---

## 24. Explicit non-goals (Phase 1)

Phase 1 must NOT implement:
- Cart DB / Cart API / Cart persistence in a backend form
- Cart screen UI integration
- quantity steppers
- purchase confirmation (“Did you buy?”)
- “Did you buy?” logic
- Creator Profile
- CollectionTile / focused Reel route
- Save / Follow
- Search FE
- Search landing
- Trending / Recommendations / ranking / scoring
- Reel Feed changes / migration
- standalone Product Details route / share URLs
- payment / checkout / merchant fulfillment / order management
- introducing any new design system or NativeWind migration

Phase 1 is strictly canonical Product foundation + action boundary wiring.

---

## 25. Final consistency audit (PASS / PARTIAL / GAP)

This section is a required planning self-audit.

| Area | Spec | Result |
| --- | --- | --- |
| Canonical Product model | `FE_DOMAIN_ARCHITECTURE_V1.md` (§4) + Catalog VM seed | PASS (type + mapper already exist) |
| ProductCard variants | `FE_DOMAIN_ARCHITECTURE_V1.md` (§6.2) requires compact/standard | PARTIAL (current ProductCard lacks `variant`) |
| ProductCard action callbacks | requires `onAddToCart` / `onBuy` emission | PARTIAL (current ProductCard lacks both) |
| ProductDetailsSheet canonical behavior | must be sheet-first; buy/add-to-cart ownership via callbacks | PARTIAL (sheet currently calls `openProductShopping` directly) |
| Shopping ownership | FE must not resolve merchant destination | PASS at redirect boundary (shoppingClick exists), but components currently call it directly → PARTIAL by ownership rule |
| Auth boundary | Add to Cart auth-gated; Product components do not own auth | PARTIAL (callbacks absent) |
| No guest Cart | no guest cart in Phase 1 | PASS (no cart persistence in Phase 1 plan) |
| No Cart implementation in Phase 1 | Phase 1 must not implement DB Cart | PASS (plan defers Cart) |
| Reel Feed protection | no modifications in Phase 1 | PASS (plan explicitly defers integration) |
| Create/Review compatibility | must not break tooling | PASS (plan only modifies details sheet buy execution + keep add-to-cart absent) |
| View All Products compatibility | must not redesign | PASS (plan defers integration) |
| No Search-specific Product components | do not create new SearchProductCard | PASS (wrappers exist already; plan does not create new) |
| No new global state | avoid redux/zustand/react-query | PASS (plan does not introduce) |

### Contradictions discovered

The current frontend violates several frozen Product component contract details:
- `ProductCard` lacks `variant` and action callbacks
- `ProductDetailsSheet` executes shopping redirect internally

These conflicts are intentional gaps for Phase 1 implementation; the plan addresses them as “expected edits”.

No contradictions exist regarding the Reel Feed protection constraint (Phase 1 defers).

### Gaps that remain unresolved for product input

1. **OD-12 intent-resume mechanics** (in-memory vs navigation params vs other approach)
2. Compact variant visual policy details needed for Phase 8 parity (exact fields to show/hide on dock)

