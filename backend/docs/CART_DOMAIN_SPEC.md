# Mystash Cart Domain Specification

**Status:** Canonical domain specification — **planning only** (no SQL, no Prisma, no APIs, no code, no migrations)  
**Audience:** Platform + FE engineering for authenticated shopping Cart (V1)  
**Principle:** Cart owns **authenticated shopping-membership SoT**. Catalog owns Product SoT. Shopping owns merchant redirect. Engagement owns behavioral facts/edges — not Cart membership.  
**Depends on (identity references only):** [`USER_DOMAIN_SPEC.md`](./USER_DOMAIN_SPEC.md), [`CATALOG_DOMAIN_SPEC.md`](./CATALOG_DOMAIN_SPEC.md)  
**Peers (do not own Cart SoT):** Shopping / Commerce redirect, Engagement, Search, Collection, CollectionProductTag, Product Intelligence, Feed, Recommendations  
**FE authority:** [`../frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md`](../../frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md) (Phase 0 FROZEN), [`../frontend/docs/PRODUCT_FE_IMPLEMENTATION_PLAN.md`](../../frontend/docs/PRODUCT_FE_IMPLEMENTATION_PLAN.md), [`../frontend/docs/CART_FE_IMPLEMENTATION_PLAN.md`](../../frontend/docs/CART_FE_IMPLEMENTATION_PLAN.md)  
**Implementation plan:** [`CART_DOMAIN_IMPLEMENTATION_PLAN.md`](./CART_DOMAIN_IMPLEMENTATION_PLAN.md)  
**Git checkpoint (pre-implementation):** `ee5f16f` — Product FE Phase 1 + OAuth auth-intent hardening  

**Scope of this document:** Domain rules, ownership, lifecycle, invariants, API contract, security, events, integration boundaries, V1 vs Future, open questions. No implementation.

---

## 0. Definition

**Cart** is the bounded context for:

> “Which Catalog products has this **authenticated** user currently added to their Mystash shopping Cart?”

```text
Cart (bounded context)
  └── CartItem (*)     UNIQUE active membership per (userId, catalogProductId)
        ├── Membership identity + timestamps
        ├── Optional source attribution (first-write)
        └── Reference → catalogProductId → CatalogProduct (SoT)
```

**Analogues (inspiration, not clones)**

| Platform pattern | Mystash analogue |
|------------------|------------------|
| Amazon “Add to Cart” (membership) | CartItem membership |
| Pinterest “Save” product pin | **Not** Cart — future Engagement product wishlist if introduced |
| Multi-merchant “bag” with external checkout | Mystash Cart → per-item Buy → Shopping redirect |
| “Did you buy?” post-return prompt | Explicit user confirmation (not purchase verification) |

### What it is not

| Not this | Why | Owning context |
|----------|-----|----------------|
| Product title / price / image / merchant / verification / shopping URL | Product SoT | **Catalog** (+ Shopping for live destination resolution) |
| Guest / anonymous / AsyncStorage cart | Forbidden V1 | — |
| Quantity / line totals / checkout / payment / orders | Out of V1 | Future Commerce |
| Purchase verification / merchant receipt matching | Explicit non-goal | — |
| Wishlist / Saved products (durable desire list) | Distinct from shopping bag | **Engagement** (future edge) if introduced |
| Saved Collections | Social save | **Engagement** |
| Merchant URL construction | Redirect runtime | **Shopping** |
| Search indexing / Feed ranking | Serving | **Search / Feed** |
| Interaction telemetry SoT | Behavioral graph | **Engagement** (may *observe* Cart signals later) |

### Repository baseline (audit — 2026-08-11)

| Check | Reality |
|-------|---------|
| `backend/src/cart/` | **Does not exist** |
| Cart SQL tables / migrations | **None** |
| Cart HTTP routes | **None** |
| FE `src/services/cartBoundary.ts` | Phase 1 **placeholder** — logs in `__DEV__` only |
| FE `app/cart.tsx` | Stub empty bag + **quantity** UI + `example.com` buy — **not** V1 SoT |
| Dual `CartContext` | Unmounted; not root providers |
| Auth intent `ADD_TO_CART` | Phase 1 / 1.1 **implemented** (route params + OAuth `redirectTo`) |
| `useProductAddToCartHandler` | Defined; **not yet wired** from Product surfaces that pass `onAddToCart` |

Cart V1 **creates** the domain; it does not evolve an existing Cart BC.

---

## 1. Aggregate ownership

### 1.1 What Cart owns

| Responsibility | Meaning |
|----------------|---------|
| **Cart membership** | Which `catalogProductId`s are in the user’s active bag |
| **Uniqueness** | At most one active line per `(userId, catalogProductId)` |
| **CartItem lifecycle** | Active membership ↔ removed (V1) |
| **Timestamps** | `added_at` / `updated_at` (and remove timestamp if soft-delete chosen) |
| **Optional source attribution** | Where the item was added from (first-write; not Product SoT) |
| **Authenticated Cart API** | Read (hydrated), add (idempotent), remove |
| **Domain events (if emitted)** | Membership added/removed facts for observability / future consumers |
| **Catalog merge remapping** | When Catalog merges products, Cart lines retarget survivor id (collision policy) |

### 1.2 What Cart must NEVER own

| Responsibility | Owner |
|----------------|-------|
| Catalog product identity / metadata / verification / lifecycle | **Catalog** |
| Merchant destination resolution / affiliate mint / HTTP redirect | **Shopping** |
| Auth identity / profile | **User** + Supabase Auth |
| Save Collection / Follow / wishlist edges | **Engagement** |
| Search documents / query | **Search** |
| Guest cart / offline durable cart | **Forbidden** |
| Quantity, checkout, payment, orders, fulfillment | **Out of V1 / Future Commerce** |
| Automatic purchase detection | **Forbidden V1** |

### 1.3 Conceptual model

```text
User (authenticated; id = auth.users.id)
  ↓
CartItem (membership SoT)
  ↓
catalogProductId
  ↓
Catalog.resolveActiveProduct → CatalogProduct presentation
  ↓
(on Buy) Shopping redirect — external merchant
```

---

## 2. V1 product rules (frozen from Phase 0 + this phase)

| Rule | V1 |
|-----|-----|
| Auth | Authenticated users only |
| Anonymous browse | Allowed; cannot Add to Cart |
| Guest cart | **No** |
| AsyncStorage cart SoT | **No** |
| Guest merge | **No** |
| Persistence SoT | **Postgres / DB** via Cart API |
| Uniqueness | One active line per `(userId, catalogProductId)` |
| Duplicate add | **Idempotent** (no second line) |
| Quantity | **None** |
| Product storage | **Reference only** (`catalogProductId`) |
| Hydration | Efficient Cart read returns membership + Catalog presentation |
| Buy | External Shopping redirect (existing) |
| Purchase verification | **None** — ask “Did you buy?” |
| Confirm YES | Remove Cart item |
| Confirm NO | Retain Cart item |
| Product components | Emit callbacks only; never own Cart writes/auth |
| Auth entry | Existing Phase 1 / 1.1 `ADD_TO_CART` intent + `useProductAddToCartHandler` |

---

## 3. Data model decision

### 3.1 Options evaluated

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A** | `User → Cart → CartItem` | Familiar “cart header”; room for future cart-level fields | Extra table/join with **no V1 cart-level fields** (no name, status, currency, checkout) |
| **B** | `User → CartItem` | Simplest membership SoT; matches uniqueness key; mirrors Tag-style membership | No cart header for future multi-cart / named carts |

### 3.2 Recommendation (V1) — **Option B**

**Recommended:** `cart_items` owned by `user_id` (= `auth.users.id`). **No `carts` header table in V1.**

**Rationale:** V1 has exactly one implicit bag per user, no cart-level lifecycle, no multi-cart. A header table would be ceremony. If Future needs named carts / shared carts, introduce `carts` then without rewriting Catalog ownership.

**Does this block implementation?** No — recommended option is implementation-ready. Revisit only if product requires multi-cart before V1 ships.

### 3.3 Canonical CartItem fields (conceptual)

| Field | Required V1 | Notes |
|-------|-------------|-------|
| `id` (UUID) | Yes | CartItem primary key |
| `user_id` | Yes | FK → `auth.users` / User id; **never from client body as authority** |
| `catalog_product_id` | Yes | FK → Catalog identity |
| `added_at` | Yes | Membership created |
| `updated_at` | Yes | Last membership mutation |
| `source_collection_id` | Optional | Attribution |
| `source_creator_id` | Optional | Attribution |
| `source_collection_product_tag_id` | Optional | Strongest commerce attribution when known |
| `source_surface` | Optional | Coarse enum: `COLLECTION` \| `SEARCH` \| `PRODUCT_DETAILS` \| `OTHER` (keep tiny) |
| `status` / `deleted_at` | Depends on delete model | See §5 |
| `awaiting_purchase_confirmation` | **Not recommended in DB for V1** | See §8 |

**Do not store:** title, price, image URL, merchant name, shopping URL, quantity, offer snapshots as SoT.

---

## 4. Uniqueness and idempotency

### 4.1 Invariant

```text
At most one ACTIVE CartItem per (user_id, catalog_product_id)
```

### 4.2 Enforcement

| Layer | Requirement |
|-------|-------------|
| **DB** | Unique constraint / partial unique index on `(user_id, catalog_product_id)` for active rows |
| **Service** | Add path is idempotent: existing active line → return existing (200/OK), no error |

Prefer **both**.

### 4.3 `POST /cart/items` semantics

| Case | Result |
|------|--------|
| Valid `catalogProductId`, no existing line | Create line; 201 (or 200 with created flag) |
| Valid id, line already exists | **Idempotent success**; return existing membership; **do not** overwrite attribution on conflict (first-write wins) **or** document last-write — see OD-C3 |
| Missing / invalid id format | 400 |
| Product not found after active resolution | 404 |
| Product not cartable (e.g. HIDDEN with policy reject) | 404 or 409 per §7 — recommended **404** for non-public / non-cartable |
| Unauthenticated | 401 |

---

## 5. Lifecycle and remove semantics

### 5.1 Membership states (V1)

```text
ACTIVE  ──remove──►  (gone from active Cart)
```

Purchase confirmation is **not** a durable CartItem status machine beyond ACTIVE membership.

### 5.2 Remove options

| Option | Meaning | Fit |
|--------|---------|-----|
| **Hard delete** | Row removed | Simplest; uniqueness is plain UNIQUE; analytics via events if needed |
| **Soft delete** | `status=REMOVED` + `deleted_at`; partial unique on ACTIVE | Aligns with Tag/User soft-delete culture; retains row for audit |

### 5.3 Recommendation (V1) — **Hard delete**

**Recommended:** Hard delete on Remove and on Confirm-YES.

**Rationale:** Cart is a **current bag**, not a purchase history ledger. Engagement/Analytics (future) can observe remove events. Soft-delete adds index/query complexity without a V1 read of “removed items.”

**Alternative:** Soft-delete if product later requires “recently removed” restore — **Future**, not V1.

**Blocks implementation?** No.

---

## 6. Source attribution

### 6.1 Question

Should CartItem retain where the product was added from?

### 6.2 Recommendation (V1) — **Optional lightweight attribution on CartItem**

Store when the client supplies it on add:

| Field | When |
|-------|------|
| `source_collection_id` | Added from a Collection / Reel context |
| `source_creator_id` | Creator known |
| `source_collection_product_tag_id` | Tag id known (preferred commerce key per Engagement) |
| `source_surface` | Coarse surface enum |

**Rules:**

- Attribution is **not** required to add
- **First-write wins** on idempotent re-add (do not clobber)
- Attribution is **not** Product SoT and **not** Engagement SoT
- Do **not** duplicate Engagement click/save facts inside Cart
- Search query string **not** stored on CartItem V1 (high cardinality / PII-ish); Search telemetry stays in Search if needed

**Alternative:** Attribution only as Engagement/telemetry event — Cart stores membership only. Acceptable if product wants zero attribution columns; then FE still may send context to a future telemetry API.

**Blocks implementation?** No — columns optional; API accepts optional source object.

---

## 7. Product availability / staleness

Catalog remains Product truth. Cart membership may outlive presentation quality.

| Catalog condition | Membership | FE presentation | Buy |
|-------------------|------------|-----------------|-----|
| ACTIVE + resolvable shopping destination | Keep | Normal | Enabled (via Shopping) |
| ACTIVE + no shopping destination | Keep | Show item; Buy **disabled** | Disabled |
| MERGED | Keep; **resolve to survivor** on read/add/remap | Show survivor product | Per survivor |
| HIDDEN / DISCONTINUED / missing | Keep membership unless policy purges | **Unavailable** state; still **Removable** | Disabled |
| UNVERIFIED / UNRESOLVED | Keep | Follow ProductCard price rules (price may hide) | Buy if destination exists |
| Price / merchant destination changed | Keep | Show **current** Catalog/Shopping truth | Current destination |

**Do not** invent fake product fallbacks.  
**Do not** copy stale Catalog snapshots into Cart as SoT.  
Optional: periodic / on-read remap for MERGED ids (required for correctness).

---

## 8. Buy flow and purchase confirmation

### 8.1 Buy ownership

```text
Cart UI / orchestration
  → openProductShopping({ catalogProductId })   // existing FE shoppingClick.ts
  → GET /products/:id/redirect                   // existing Shopping
  → external merchant
```

Cart **must not** construct merchant URLs.

### 8.2 Confirmation UX (frozen)

```text
ACTIVE CartItem
  → User taps Buy
  → (optional FE) mark awaitingConfirmation for that catalogProductId
  → open external merchant
  → App returns to foreground (AppState)
  → “Did you buy this product?”
       YES → DELETE Cart item
       NO  → retain; clear awaitingConfirmation
```

### 8.3 Where does `awaitingConfirmation` live?

| Option | Pros | Cons |
|--------|------|------|
| **FE ephemeral state** | No schema; matches “not an order” | Lost if process killed |
| **DB flag** | Survives relaunch | Over-models transient UX; cleanup burden |

### 8.4 Recommendation (V1) — **FE ephemeral only**

Persist **membership** in DB. Persist **awaiting confirmation** only in FE memory (Cart screen / Cart client) keyed by `catalogProductId`.

If the app is killed mid-Buy, user simply has no prompt — item remains in Cart (safe default).

**Do not** add Order / Purchase aggregate in V1.  
**Do not** auto-detect purchase from redirect success.

**Blocks implementation?** No.

---

## 9. Multiple merchants

Cart is a **unified multi-merchant workspace**. There is **no combined checkout**.

**V1:** Flat list ordered by `added_at` DESC (recommended). **No merchant grouping required.**

Grouping by merchant is **Future** polish, not a correctness requirement.

---

## 10. API contract (authenticated)

Base path recommendation: `/cart` (register beside existing domain routes).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/cart` | Active membership + **hydrated** Catalog presentation |
| `POST` | `/cart/items` | Idempotent add |
| `DELETE` | `/cart/items/:catalogProductId` | Remove by Catalog id |

### 10.1 Why delete by `catalogProductId`

Uniqueness is per product; FE ProductCard/Cart rows already key on Catalog identity; avoids forcing clients to retain a separate line id for the common path.

Optionally also support `DELETE /cart/items/by-id/:cartItemId` — **not required** for V1 if catalog-keyed delete exists.

### 10.2 Why no PUT/PATCH in V1

No quantity, no mutable cart fields beyond optional attribution (first-write). Confirmation is FE. **No PATCH.**

### 10.3 Auth

Every endpoint:

- Requires `Authorization: Bearer <access_token>`
- Resolves user via Supabase `auth.getUser()` (same pattern as Engagement/User routes)
- **Never trusts** `userId` from body/query/path as authority

### 10.4 `GET /cart` response shape (conceptual)

```text
{
  items: [
    {
      cartItemId,
      catalogProductId,          // survivor / stored id after resolve policy
      addedAt,
      source?: { collectionId?, creatorId?, collectionProductTagId?, surface? },
      availability: "AVAILABLE" | "UNAVAILABLE" | "NO_DESTINATION",
      product: <CatalogProductViewModel-compatible payload>
    }
  ],
  itemCount: number
}
```

**Invariant:** `items[].product` is a **read projection from Catalog** (via CatalogService / Lookup Port), not a Cart-owned copy.

Batch Catalog lookup inside CartService — FE must not N+1 `GET /catalog/...`.

### 10.5 `POST /cart/items` body (conceptual)

```text
{
  catalogProductId: string,          // required
  source?: {
    collectionId?: string,
    creatorId?: string,
    collectionProductTagId?: string,
    surface?: "COLLECTION" | "SEARCH" | "PRODUCT_DETAILS" | "OTHER"
  }
}
```

### 10.6 Errors (conceptual)

| Code | When |
|------|------|
| 401 | Missing/invalid auth |
| 400 | Malformed id / body |
| 404 | Product not found / not cartable |
| 200/201 | Add success (idempotent or created) |
| 204/200 | Delete success (idempotent delete of missing → 204 recommended) |

---

## 11. Security

| Rule | Detail |
|------|--------|
| Owner-only | User A cannot read/add/remove User B’s items |
| Session-derived user | From Bearer token only |
| RLS | Enable RLS on `cart_items`; owner policies; service-role for server API writes (match User/Engagement conventions) |
| Catalog id validation | Format + active-product resolution |
| No arbitrary action params | Do not accept free-form “intent” payloads that trigger unrelated side effects |

---

## 12. Events / domain integration

### 12.1 Proposed events

| Event | V1 required? | Publisher | Consumer | Why |
|-------|--------------|-----------|----------|-----|
| `CartItemAdded` | **Recommended** (structured log) | CartService | Observability; **no required peer consumer in V1** | Audit + future Engagement `BuyIntent` / analytics |
| `CartItemRemoved` | **Recommended** | CartService | Observability | Distinguish user remove vs confirm-YES |
| `CartItemPurchaseConfirmed` | **Optional log only** | CartService **or FE-only** | None required | UX confirmation ≠ verified purchase; do **not** write Engagement `PurchaseAttributed` |

**Do not** invent a required Search / Recs / Feed consumer for V1.

### 12.2 Catalog merge

| Event / signal | Cart duty |
|----------------|-----------|
| Catalog product MERGED | Remap `catalog_product_id` → survivor; on unique collision, keep one ACTIVE line (prefer older `added_at` or survivor row — document in impl plan) |

### 12.3 Engagement boundary

| Signal | V1 |
|--------|-----|
| Cart membership | **Cart SoT** |
| MerchantClick / ProductClick | Already Shopping → Engagement |
| BuyIntent / ProductSave wishlist | **Future** Engagement — not Cart membership |
| “Added to Cart” telemetry to Engagement | **Future** unless product prioritizes; avoid duplicate SoT |

### 12.4 Search boundary

Cart **must not** write Search index. Search **must not** store Cart.

---

## 13. Authorization matrix

| Actor | GET /cart | POST items | DELETE item | Buy redirect |
|-------|-----------|------------|-------------|--------------|
| Anonymous | 401 | 401 | 401 | Allowed (Shopping optional auth) |
| Authenticated owner | Own bag | Own bag | Own bag | Allowed |
| Authenticated other user | Denied | Denied | Denied | N/A |

Note: Buy itself is not Cart-auth-gated (Phase 0); membership mutations are.

---

## 14. V1 vs Future

### V1

- Auth-only DB CartItem membership  
- Unique product lines; idempotent add  
- Hydrated GET /cart  
- Remove; Buy via Shopping; FE “Did you buy?”  
- Optional source attribution  
- Catalog merge remap  
- Structured add/remove logs  

### Future (explicitly out of V1)

- Quantities  
- Checkout / payment / orders / fulfillment  
- Guest cart / AsyncStorage SoT / merge  
- Wishlist / saved products  
- Coupons / price alerts / abandoned-cart notifications  
- Merchant grouping UI as requirement  
- Purchase verification  
- Multi-cart / shared carts  
- Engagement BuyIntent edge as Cart replacement  
- Cart header table (unless multi-cart arrives)

---

## 15. Open questions

| ID | Question | Recommendation | Alternatives | Blocks Phase 2A? |
|----|----------|----------------|--------------|------------------|
| **OD-C1** | Cart header table vs User→CartItem | **B: CartItem only** | A: Cart→CartItem | **No** |
| **OD-C2** | Hard vs soft delete | **Hard delete** | Soft-delete REMOVED | **No** |
| **OD-C3** | Attribution on idempotent re-add | **First-write wins** | Last-write / ignore body | **No** |
| **OD-C4** | Awaiting confirmation persistence | **FE only** | DB flag | **No** |
| **OD-C5** | Merchant grouping in list | **Flat list** | Group by merchant | **No** |
| **OD-C6** | Cart badge | **Yes if authenticated** — `itemCount` from GET /cart (or tiny count endpoint later) | No badge V1 | **No** |
| **OD-C7** | Delete key | **By catalogProductId** | By cartItemId only | **No** |
| **OD-C8** | Hydration embedding vs ids-only | **Embedded product projection on GET /cart** | Ids + separate batch Catalog route | **No** (embedded preferred) |
| **OD-C9** | Unavailable product: keep vs auto-purge | **Keep + UNAVAILABLE UI** | Auto-remove on read | **No** |
| **OD-C10** | BC placement name | **`backend/src/cart/` Cart BC** (not User; Shopping stays redirect) | Fold under “Commerce” mega-module | **No** |
| **OD-C11** | Emit Engagement fact on add | **Not V1** | Dual-write BuyIntent | **No** |

**Phase 0 OD-11 / OD-12 note:**  
- **OD-12** (intent resume) was **implemented** in Phase 1 / 1.1 via route params + OAuth `redirectTo` — Cart plans reuse it; do not reopen.  
- **OD-11** (Commerce vs Cart BC) → answered here as dedicated **Cart BC** with Shopping remaining redirect-only.

**No open question blocks starting Phase 2A** if recommendations above are accepted. Flag OD-C1/C2/C4 for product ack if desired; none are architectural dead-ends.

---

## 16. Consistency principles (normative)

1. Authenticated-only membership; DB SoT.  
2. Catalog is Product SoT; Cart stores references + membership state.  
3. One unique active product per user.  
4. No quantity / checkout / purchase verification in V1.  
5. Shopping owns Buy redirect.  
6. Engagement does not own Cart membership.  
7. Search does not own Cart.  
8. Product FE components remain presentation + callbacks.  
9. Auth orchestration remains outside Product components.  
10. No guest / AsyncStorage Cart SoT.

---

## 17. Document history

| Date | Change |
|------|--------|
| 2026-08-11 | Initial Cart Domain Spec (Phase 2 planning) |
