# Discover Anywhere — Phase 4: Non-promoting resolution and Bag fan-out

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 3: [`mystash-user-ingestion-phase-3-content-processing.md`](./mystash-user-ingestion-phase-3-content-processing.md).

Phase 4 resolves `content_source_products` with the **existing** Product Intelligence matcher.
A catalogue hit reuses `catalog_products`. A miss stores `discovered_products` only. The
resolved product is then added to every relevant user's Bag.

```
content_source_products
  → ProductResolver.resolveForUserImport (promoteOnMiss: false)
      YES catalogue hit → catalog_products
      NO  → discovered_products
  → all user_imports for that source
  → each user's Bag
```

Resolution is global. Bag membership is user-specific. 100 users sharing one Reel produce
one content source, one resolution result, and 100 Bag lines.

---

## 1. Schema

`supabase/migrations/20260920180000_discovered_products.sql` is additive.

### `discovered_products`

Global identity for a product extracted from user content that is not in the catalogue.
`UNIQUE (identity_key)`. Missing extracted fields stay null. `catalog_product_id` exists
only for a later explicit promotion — Phase 4 never writes it.

Identity reuses existing URL canonicalization: merchant URL → `externalIdForProductUrl`
(`m_…`); otherwise `n_` + sha256(name|brand|model).

### `content_source_products`

Each candidate binds to **exactly one** of `catalog_product_id` or `discovered_product_id`
(both null is allowed before bind). Extraction evidence is unchanged.

### `cart_items`

Polymorphic membership: XOR `catalog_product_id` / `discovered_product_id`. Partial unique
indexes `(user_id, catalog_product_id)` and `(user_id, discovered_product_id)`. Attribution
columns `source_content_source_id` and `source_user_import_id`, surface `USER_IMPORT`.

---

## 2. Resolution

`ProductResolver.resolveIngest(drafts, { promoteOnMiss })` is the single matcher.

| Path | `promoteOnMiss` | Miss behaviour |
| --- | --- | --- |
| Creator ingest (`resolveIngest` default) | `true` | Writes UNVERIFIED / UNRESOLVED `catalog_products` (unchanged) |
| User import (`resolveForUserImport`) | `false` | Returns a `discovered` payload. **Never** writes catalogue |

A local **VERIFIED** catalogue hit still reuses that `catalog_products` row. User-import hits
do not persist ingest drafts or enqueue background resolve (the draft id is a
`content_source_products` id, not `ingest_draft_products`).

Search success without a VERIFIED local hit is a miss on the user path — it is **not**
promotion into catalogue.

`ContentSourceResolutionService` calls `resolveForUserImport`, binds the candidate, then
fans out. There is no second matcher or AI extractor.

---

## 3. Bag

Existing `CartService` membership. `addItem` accepts exactly one of `catalogProductId` or
`discoveredProductId`. Canonical add/remove/merge behaviour is unchanged. Discovered add is
idempotent on `(user, discovered_product_id)`.

The same user/product from two sources produces one Bag line. First-write attribution is
kept (`USER_IMPORT` + content source + user import).

GET `/cart` hydrates discovered rows as a product projection. Internal
confidence / completeness / “discovered product” are not user-facing copy. Attribution is
preserved so a later Product Page can show “Found from this Reel”.

Late shares of an already-READY source do not re-queue. `UserImportService` applies Bag
membership through `applyIfResolved` after submit.

---

## 4. What this phase does not do

- Product Page / Search redesign
- Reviews, compare, media UI
- Automatic `discovered_products` → `catalog_products` promotion
- A second ProductResolver / MatchScorer / AI extractor

---

## 5. Tests

From `backend/`:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsx --test \
  src/product-intelligence/resolver/ProductResolver.test.ts \
  src/product-intelligence/discovered/identity.test.ts \
  src/discovered/DiscoveredProductService.test.ts \
  src/content-source/processing/ContentSourceResolutionService.test.ts \
  src/content-source/processing/ContentSourceProcessor.test.ts \
  src/cart/CartService.test.ts \
  src/cart/domain/lifecycle.test.ts \
  src/user-import/UserImportService.test.ts
```
