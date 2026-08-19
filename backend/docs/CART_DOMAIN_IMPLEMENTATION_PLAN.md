# Cart Domain Implementation Plan

**Spec:** [`CART_DOMAIN_SPEC.md`](./CART_DOMAIN_SPEC.md) (canonical)  
**Status:** Phase 2A planning only — **no code, no migration, no commit until requested**  
**Template:** Mirror `backend/src/collection/` / `backend/src/engagement/` (types → lifecycle → repo → service → factory → routes → tests)  
**FE companion:** [`../../frontend/docs/CART_FE_IMPLEMENTATION_PLAN.md`](../../frontend/docs/CART_FE_IMPLEMENTATION_PLAN.md)  
**Git checkpoint:** `ee5f16f`

---

## Spec decisions locked for implementation (V1)

| Topic | Decision |
|-------|----------|
| Aggregate | `CartItem` only (no `carts` header table) |
| Owner | `user_id = auth.users.id` |
| Uniqueness | Unique `(user_id, catalog_product_id)` |
| Add | Idempotent; first-write attribution wins |
| Remove | Hard delete |
| Confirmation flag | **Not** in DB (FE ephemeral) |
| Hydration | `GET /cart` embeds Catalog presentation via CatalogService |
| Delete path | `DELETE /cart/items/:catalogProductId` |
| BC location | `backend/src/cart/` |
| Events | Structured `CartItemAdded` / `CartItemRemoved` logs; no required peer consumers |
| Auth | Bearer → `auth.getUser()`; never trust client `userId` |

---

## Architecture

```text
Bearer JWT
  → registerCartRoutes
  → CartService (only mutator of cart_items)
       ├── CartRepository (Supabase | InMemory)
       ├── CatalogCartPort → CatalogService.resolveActiveProduct / batch read
       └── emit CartItemAdded | CartItemRemoved

Shopping remains GET /products/:id/redirect (unchanged)
Engagement / Search do not consume Cart events in V1
```

### Ports (thin)

| Port | Direction | Purpose |
|------|-----------|---------|
| `CatalogCartPort` | Cart → Catalog | `resolveActiveProduct(id)`, `getProductsForCart(ids[])` presentation fields |
| Optional Catalog merge hook | Catalog → Cart | Remap cart lines after MERGED (mirror Collection `catalogRemap`) |

Avoid circular imports: Cart depends on Catalog via port; Catalog notifies Cart remap via port registered in factory (same pattern as Collection tag remap).

---

## Implementation steps (Phase 2A)

### 1. Migration

Create e.g. `supabase/migrations/YYYYMMDDHHMMSS_cart_domain.sql`:

**Table `public.cart_items`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` NOT NULL | FK → `auth.users(id)` ON DELETE CASCADE (or RESTRICT per User soft-delete policy — prefer align with Engagement edges; if User soft-deletes without auth delete, CASCADE from auth is fine) |
| `catalog_product_id` | `uuid` NOT NULL | FK → `catalog_products(id)` |
| `added_at` | `timestamptz` NOT NULL | default `now()` |
| `updated_at` | `timestamptz` NOT NULL | default `now()` |
| `source_collection_id` | `uuid` NULL | optional |
| `source_creator_id` | `uuid` NULL | optional |
| `source_collection_product_tag_id` | `uuid` NULL | optional |
| `source_surface` | `text` NULL | check enum |
| `schema_version` | `int` | default 1 |

**Constraints / indexes**

- `UNIQUE (user_id, catalog_product_id)`
- Index `(user_id, added_at DESC)` for list
- Index `(catalog_product_id)` for merge remap

**RLS**

- Enable RLS
- SELECT / INSERT / DELETE for `auth.uid() = user_id`
- Service-role used by Node CartService (consistent with other domains)

**Do not** create quantity, price snapshot, merchant URL, or order tables.

### 2. Domain module layout

```text
backend/src/cart/
  domain/
    types.ts
    lifecycle.ts          # add/remove/idempotency pure helpers
    lifecycle.test.ts
    events.ts             # CartItemAdded | CartItemRemoved payloads
  CartRepository.ts       # port interface
  InMemoryCartRepository.ts
  SupabaseCartRepository.ts
  CatalogCartPort.ts      # or ports.ts
  catalogRemap.ts         # MERGED survivor remapping + collision
  CartService.ts
  CartService.test.ts
  factory.ts
  routes.ts
  observability.ts
```

### 3. Domain types (sketch)

- `CartItemRecord` — DB membership fields  
- `CartItemView` — membership + `availability` + `product` projection  
- `AddCartItemInput` — `catalogProductId` + optional `source`  
- `CartServiceError` — `unauthorized` | `invalid` | `not_found` | …

### 4. Lifecycle helpers

- Validate `catalogProductId` format (align with FE `isValidCatalogProductId` spirit / UUID)  
- Idempotent add decision  
- Merge collision: when remapping A→S and user already has S, delete A (or A’s row) and keep S  

### 5. Repository

Methods:

- `listByUser(userId)`  
- `findByUserAndProduct(userId, catalogProductId)`  
- `insert(row)`  
- `deleteByUserAndProduct(userId, catalogProductId)` → boolean  
- `remapCatalogProduct(fromId, toId)` → for merge worker  

InMemory repo for unit tests.

### 6. CatalogCartPort

Implement using existing `CatalogService`:

- `resolveActiveProduct` before add  
- Reject null / non-cartable (recommend: missing or `HIDDEN` → not_found; `DISCONTINUED` → allow membership but mark UNAVAILABLE on read — **spec §7**: keep + UNAVAILABLE; add may still succeed for DISCONTINUED if desired — **recommend add only when resolve returns a product; mark availability on read**)  
- Batch fetch presentation fields for `GET /cart` (title, brand, image, price fields as Catalog exposes, verification, merchant display fields if present)

Map to FE-compatible shape (aligned with `CatalogProductViewModel` fields). Do **not** invent fake images/prices.

Availability derivation on read:

| Condition | `availability` |
|-----------|----------------|
| Product missing after resolve | `UNAVAILABLE` (orphan line — still listed + removable) |
| HIDDEN / DISCONTINUED | `UNAVAILABLE` |
| ACTIVE but Shopping would fail / no destination hint | `NO_DESTINATION` if detectable without redirect; else FE disables Buy when shopping fails — prefer Catalog/Shopping signal if cheap |
| ACTIVE otherwise | `AVAILABLE` |

Exact “has destination” probe: **do not** call full redirect on list. Use existing Catalog/Shopping fields already used by UI elsewhere; if unknown, FE still guards Buy via existing shopping click errors / missing `catalogProductId`.

### 7. CartService

| Method | Behavior |
|--------|----------|
| `getCart(userId)` | List items → batch hydrate → compute availability → `itemCount` |
| `addItem(userId, input)` | Resolve product → idempotent insert → event |
| `removeItem(userId, catalogProductId)` | Hard delete → event (idempotent if absent) |
| `remapAfterCatalogMerge(from, to)` | Collision-safe remap |

### 8. HTTP routes

`registerCartRoutes(app)` in `backend/src/index.ts`:

| Route | Handler |
|-------|---------|
| `GET /cart` | requireUser → `getCart` |
| `POST /cart/items` | requireUser → `addItem` |
| `DELETE /cart/items/:catalogProductId` | requireUser → `removeItem` |

Auth helper: copy Engagement/User pattern (`Authorization` header → user-scoped client → `getUser()` → admin/service for writes).

**Do not** accept `userId` in body.

### 9. Events / observability

- `emitCartItemAdded` / `emitCartItemRemoved` → existing ingestLog / structured log pattern  
- Include `userId`, `catalogProductId`, `cartItemId`, `source?`, `reason?: 'user_remove' | 'purchase_confirmed'` when known  
- Purchase confirm reason may only be known if FE sends `?reason=` on DELETE — **optional**; default `user_remove`. Prefer optional query/body `reason` enum on DELETE for analytics without new endpoints.

### 10. Catalog merge wiring

Extend existing Catalog merge remap registration (Collection already remaps tags) to also call Cart remap port. If merge is still stubby in Catalog V1, ship Cart remap function + unit tests; wire when merge emits.

### 11. Factory

`createCartService(admin)` wires Supabase repo + Catalog port from `createCatalogService`.

### 12. Tests (required)

| Case | Type |
|------|------|
| Unauthenticated → 401 | Route / service |
| Authenticated empty cart | Service |
| Add item | Service |
| Duplicate add idempotent + attribution first-write | Service |
| Concurrent duplicate add (unique violation → read existing) | Service / repo |
| Remove existing / remove missing idempotent | Service |
| User isolation (A cannot see B) | Service |
| Invalid catalogProductId | Service |
| Nonexistent product | Service |
| Unavailable / HIDDEN presentation | Service hydration |
| Batch hydration shape | Service |
| Merge remap + collision | Unit |
| Ownership enforcement | Route |
| Event emit on add/remove | Unit (spy) |

Run: existing backend `npm test` / build. **No commit until requested.**

### 13. Rollout

1. Migration apply (dev)  
2. Register routes  
3. FE Phase 2B against staging URL  
4. Deprecate FE placeholder `requestAddToCart` no-op  

### 14. Explicit non-goals (Phase 2A)

- Quantities, checkout, payments, orders  
- Guest cart  
- Wishlist APIs  
- Engagement BuyIntent dual-write  
- Changing Shopping redirect  
- Changing Reel Feed  
- Prisma (project uses Supabase SQL migrations)

---

## Phase 2A → 2B handoff checklist

| Backend deliverable | FE depends on |
|---------------------|---------------|
| `GET /cart` hydrated | Cart screen |
| `POST /cart/items` idempotent | Replace `cartBoundary` |
| `DELETE /cart/items/:catalogProductId` | Remove + confirm YES |
| 401 semantics | Auth gates |
| `itemCount` | Optional badge |
| Stable error codes | Error/retry UX |

---

## Open implementation notes (non-blocking)

1. FK delete behavior when Catalog product hard-removed (rare) — prefer retain row + UNAVAILABLE or ON DELETE RESTRICT.  
2. Whether DISCONTINUED is addable — recommend **allow add** if resolve returns product; mark UNAVAILABLE.  
3. Optional `reason` on DELETE for confirm-YES analytics.

---

## Document history

| Date | Change |
|------|--------|
| 2026-08-11 | Initial Cart Domain Implementation Plan (Phase 2A planning) |
