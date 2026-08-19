# Cart FE Implementation Plan

**Status:** Phase 2B planning only — **no TS/TSX implementation in this task**  
**Spec / BE plan:** [`../../backend/docs/CART_DOMAIN_SPEC.md`](../../backend/docs/CART_DOMAIN_SPEC.md), [`../../backend/docs/CART_DOMAIN_IMPLEMENTATION_PLAN.md`](../../backend/docs/CART_DOMAIN_IMPLEMENTATION_PLAN.md)  
**Architecture authority:** [`FE_DOMAIN_ARCHITECTURE_V1.md`](./FE_DOMAIN_ARCHITECTURE_V1.md) (FROZEN), [`PRODUCT_FE_IMPLEMENTATION_PLAN.md`](./PRODUCT_FE_IMPLEMENTATION_PLAN.md)  
**Git checkpoint:** `ee5f16f` — Product FE Phase 1 callbacks + OAuth auth-intent hardening  

**Scope:** FE Cart domain architecture, client/service, state, screens, Product/auth integration, purchase confirmation UX, navigation/badge, tests, exact files. No code in this phase.

---

## 0. Current FE baseline (audit)

| Asset | Reality | Phase 2 action |
|-------|---------|----------------|
| `src/services/cartBoundary.ts` | Dev log placeholder | **Replace** with real authenticated Cart API client calls |
| `src/services/productActionOrchestration.ts` | Auth gate + intent + `requestAddToCart` | Keep gate; swap boundary to Cart API |
| `src/navigation/authIntent.ts` | `ADD_TO_CART` + OAuth redirectTo | **Reuse** — do not reinvent |
| `app/cart.tsx` | Empty stub + **quantity** + `example.com` | **Replace** with V1 CartScreen |
| `contexts/CartContext.tsx` | Unmounted in-memory | **Canonicalize** as authenticated Cart client over API |
| `components/CartContext.tsx` | Duplicate | **Delete or stop exporting** (deprecate) |
| Tabs | Home / Search / Create / Profile — **no Cart tab** | Keep stack `/cart`; entry via header/bag (existing patterns) |
| ProductCard / ProductDetailsSheet | Callback-only | Pass `onAddToCart` from parents that should support it |
| Create/Review | `onBuy` only; **no** `onAddToCart` | **Preserve** (no Cart in Create) |
| Reel / product-list | Protected | **Do not modify** in Phase 2 unless tiny wiring is impossible — prefer leave product-list Add-to-Bag stub alone (deferred) |

---

## 1. FE domain role

```text
Cart Screen / Cart client
  → Cart API (Bearer)
  → CartItems + hydrated CatalogProductViewModel
  → ProductCard (standard) + cart actions (Remove / Buy)
```

**Cart owns:** presentation of membership, add/remove orchestration (via service), Buy orchestration via existing shopping, purchase-confirmation UX, loading/empty/error.

**Cart does not own:** Product metadata SoT, auth system, Shopping URL resolution, Engagement Save, Search, Reel Feed.

**ProductCard** remains reusable presentation — **does not know** it is inside Cart.

---

## 2. Authentication integration (reuse Phase 1 / 1.1)

```text
Logged out + Add to Cart
  → useProductAddToCartHandler
  → Profile + intent=ADD_TO_CART&catalogProductId
  → auth (email or Google; cold callback preserves intent)
  → consume intent → Cart API add
  → (optional) navigate to /cart or stay

Logged in + Add to Cart
  → Cart API add
```

**Rules:**

- Do **not** create a second auth gate  
- Do **not** put `useAuth` inside ProductCard / ProductDetailsSheet  
- Replace `requestAddToCart` body with `cartApi.addItem`  
- After successful intent resume, clear route params (already Profile pattern); optionally `router.push('/cart')` — product decision, default **stay / silent add** unless UX wants bag open  

**Recommended V1 after resume:** silent successful add + optional toast; do not force Cart screen unless product asks.

---

## 3. Cart client / state (no new global framework)

### 3.1 Recommendation

| Layer | Choice |
|-------|--------|
| Framework | **No** Redux / Zustand / React Query |
| Pattern | **CartContext** (canonicalize `contexts/CartContext.tsx`) + thin `src/services/cartApi.ts` |
| SoT | **Server DB** via Cart API |
| Local state | Mirror of last successful `GET /cart`; optimistic remove where safe |
| Persistence | **None** local (no AsyncStorage Cart) |
| Mount | Root `app/_layout.tsx` inside `AuthProvider`; load **only when `user` present**; clear on sign-out |

### 3.2 CartContext responsibilities

- `items`, `itemCount`, `status: idle | loading | ready | error`  
- `refresh()` → GET /cart  
- `addItem(catalogProductId, source?)` → POST (idempotent)  
- `removeItem(catalogProductId, reason?)` → DELETE  
- `awaitingConfirmationProductId: string | null` (FE ephemeral)  
- `beginBuy(product)` / `resolvePurchaseConfirmation(yes: boolean)`  

### 3.3 Optimistic UI

| Action | Optimistic? | Reconcile |
|--------|-------------|-----------|
| Remove | Yes — remove from local list immediately | On failure, refresh + error |
| Add | Optional — append placeholder only if hydrated product known; else await POST then refresh | Idempotent POST |
| Confirm YES | Same as remove | — |
| Confirm NO | Clear awaiting flag only | — |

---

## 4. Cart API client

**File:** `src/services/cartApi.ts` (new)

- Base: `EXPO_PUBLIC_MYSTASH_INGEST_URL` (same as shopping/ingest)  
- Headers: `Authorization: Bearer ${session.access_token}`  
- Methods: `fetchCart`, `addCartItem`, `removeCartItem`  
- Map response → `{ cartItemId, catalogProductId, addedAt, availability, product: CatalogProductViewModel, source? }`

**File:** `src/services/cartBoundary.ts`

- Become a thin facade calling CartContext setter **or** cartApi (avoid dual SoT). Prefer orchestration calling **cartApi** or a `cartActions` module used by both Context and intent resume.  
- Intent resume on Profile must call the **same** add path as in-app Add to Cart.

---

## 5. Screens and UX

### 5.1 CartScreen (`app/cart.tsx`)

Replace stub. V1 must show:

| Element | Behavior |
|---------|----------|
| List | `ProductCard` `variant="standard"` |
| Fields | Image, title, price (per ProductCard VERIFIED rules), merchant line |
| Remove | Cart-owned control (footer/actions slot or adjacent button) — **not** inside ProductCard defaults unless `footer` used |
| Buy | Pass `onBuy` → shoppingClick / `useProductBuyHandler` + set awaiting confirmation |
| Unavailable | Badge/label; Buy disabled; Remove still available |
| NO_DESTINATION | Buy disabled; copy: link unavailable |
| Loading | Skeleton / spinner |
| Empty | Clear empty state + CTA (e.g. back to Home) |
| Error | Retry |
| Auth gate | If logged out opens `/cart` → prompt Sign in (link Profile); empty otherwise |

**Remove quantity steppers and `example.com` buy links.**

### 5.2 Product Details from Cart

`onPress` → open `ProductDetailsSheet` with `onBuy` / optionally omit `onAddToCart` (already in cart) or pass no-op hide.

### 5.3 Purchase confirmation modal

Triggered when:

1. User tapped Buy from Cart (or Cart-driven Details) for `catalogProductId` P  
2. AppState returns to `active`  
3. `awaitingConfirmationProductId === P`

UI:

- Title: “Did you buy this product?”  
- YES → `removeItem(P, 'purchase_confirmed')`  
- NO → clear awaiting flag  

Ignore unrelated AppState blips if possible (debounce / require `active` after `background`/`inactive`).

**Do not** infer purchase from URL.

---

## 6. Product integration

| Surface | Phase 2 wiring |
|---------|----------------|
| Future Search / Creator / Saved | Pass `onAddToCart={useProductAddToCartHandler()}` when those surfaces exist |
| ProductDetailsSheet (consumer surfaces) | Pass `onAddToCart` where Add is offered |
| Create/Review | **Do not** pass `onAddToCart` |
| Reel / BottomDock / product-list | **Do not modify** (protected / deferred) |
| CartScreen | ProductCard without Add; with Buy + Remove |

`catalogProductId` guard remains in ProductCard — never call add without id.

---

## 7. Navigation

| Topic | Recommendation |
|-------|----------------|
| Route | Keep stack `app/cart.tsx` (`/cart`) — already registered |
| Tab bar | **No new Cart tab in V1** (smallest change) |
| Entry | Reuse bag affordances: `SharedHeader` / product-list header patterns → `router.push('/cart')`; Profile row optional |
| Badge | If authenticated and `itemCount > 0`, show count on bag icon; hide when 0 / logged out |
| Return from merchant | System back to app → AppState handler on Cart client or CartScreen |

**OD-C6:** Badge recommended but **non-blocking** — ship CartScreen first; badge can land same PR if header wiring is small.

---

## 8. Buy / Shopping boundary

```text
CartScreen onBuy(product)
  → set awaitingConfirmationProductId
  → useProductBuyHandler / openProductShopping
  → existing backend redirect
```

Do **not** change `src/services/shoppingClick.ts` unless a TypeScript tweak is required.  
Do **not** open `example.com`.

---

## 9. Exact files (planned touch list)

### Create / replace

| File | Role |
|------|------|
| `src/services/cartApi.ts` | HTTP client |
| `contexts/CartContext.tsx` | Authenticated cart client (rewrite) |
| `app/cart.tsx` | CartScreen rewrite |
| `components/commerce/CartPurchaseConfirmModal.tsx` (optional) | Confirm YES/NO UI |

### Modify

| File | Role |
|------|------|
| `src/services/cartBoundary.ts` | Real add entry for intent resume |
| `src/services/productActionOrchestration.ts` | Call real add |
| `app/_layout.tsx` | Mount CartProvider under Auth |
| `app/(tabs)/profile.tsx` | Intent resume → real add (via boundary) |
| Header / bag entry points that already navigate to `/cart` | Optional badge |
| Surfaces that should offer Add to Cart in Phase 2 | Pass `onAddToCart` (**not** Create/Review, **not** Reel) |

### Delete / stop using

| File | Role |
|------|------|
| `components/CartContext.tsx` | Duplicate — remove export/usages |

### Do not modify

- `components/BottomDock.tsx`, `ReelItem.tsx`, Instagram/YouTube reel items  
- `app/product-list/[id].tsx` (deferred)  
- `shoppingClick.ts` (unless tiny typing)  
- Phase 0/1 planning docs (except this new FE plan)  
- Backend (Phase 2A separate)

---

## 10. Implementation order (Phase 2B)

1. `cartApi.ts` against Phase 2A routes  
2. Rewrite `CartContext` (load on auth; clear on logout)  
3. Mount provider in `_layout`  
4. Replace `app/cart.tsx` (list / empty / loading / error / remove / Buy)  
5. Wire `cartBoundary` + orchestration + Profile intent resume to API  
6. Purchase confirmation AppState flow  
7. Pass `onAddToCart` on approved consumer surfaces (minimal set for QA)  
8. Bag badge if approved  
9. Remove duplicate `components/CartContext.tsx`  
10. QA checklist below  

**Dependency:** Prefer Phase 2A API available before 2B; FE can stub client behind flag only if needed — **not** AsyncStorage.

---

## 11. Test / QA plan (FE)

No full FE harness today — use manual QA + optional validation scripts. Do not claim automated coverage that does not exist.

| Case | Expected |
|------|----------|
| Empty cart | Empty state |
| Loading | Skeleton/spinner |
| Hydrated products render | Card shows Catalog fields |
| Logged-in Add | Item appears after refresh/optimistic |
| Logged-out Add | Login intent → resume → item in cart |
| Duplicate add | Still one line |
| Remove | Disappears; server confirms |
| Buy | External merchant via shoppingClick |
| Return YES | Removed |
| Return NO | Retained |
| Unavailable product | Shown unavailable; Buy off; Remove on |
| Missing destination | Buy disabled |
| API failure | Error + retry; no silent guest cart |
| Sign-out | Cart client cleared; no local persistence |
| No quantity UI | Confirmed |
| Create/Review unchanged re: Add | Confirmed |
| Reel untouched | Diff check |

---

## 12. Explicit non-goals (Phase 2B)

- Guest / AsyncStorage Cart  
- Quantities, checkout, payment, coupons  
- Purchase auto-detection  
- Wishlist  
- Reel Feed / product-list migration  
- New global state libraries  
- Creator Profile / Search FE / Discovery  

---

## 13. Consistency with Phase 0 / Phase 1

| Rule | Plan stance |
|------|-------------|
| Auth-only DB Cart | Yes |
| ProductCard presentation-only | Yes |
| Auth outside Product | Yes |
| Shopping owns Buy | Yes |
| No quantity | Yes — delete stub steppers |
| Intent resume | Reuse Phase 1.1 |
| Canonicalize `app/cart.tsx` + Context | Yes |
| No CartProductCard | Yes — use ProductCard standard |

---

## Document history

| Date | Change |
|------|--------|
| 2026-08-11 | Initial Cart FE Implementation Plan (Phase 2B planning) |
