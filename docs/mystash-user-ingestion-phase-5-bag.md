# Discover Anywhere — Phase 5: My Bag experience

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 4: [`mystash-user-ingestion-phase-4-resolution.md`](./mystash-user-ingestion-phase-4-resolution.md).

Phase 5 is the **user-facing Bag** on top of the existing Cart membership. It does not add a
second saved-products system, does not redesign Search, and does not build a Product Page.

```
GET /cart  → hydrate canonical + discovered lines
GET /imports → looking | ready | nothing_yet | couldnt_finish
app/cart.tsx → BagItemCard (one visual row)
tap → existing ProductDetailsSheet (internal status hidden)
```

---

## 1. Reuse

| Existing | Role in Phase 5 |
| --- | --- |
| `GET/POST/DELETE /cart` | Membership SoT. Canonical add/remove/buy unchanged |
| `CartContext`, `cartApi`, `/cart` route | The only Bag client |
| `GET /imports` | Share progress banners, not a second bag |
| `ProductDetailsSheet` | Existing product experience (no new Product Page) |
| Phase 4 XOR membership + attribution | Hydrated, not redesigned |

---

## 2. One UI representation

`hydrateCartLines` maps both `catalogProductId` and `discoveredProductId` onto `CartLine`.
Shopping still requires a real catalogue id. `bagItemFromLine` then projects every line into
`BagItemView`: image, name, brand, price, category, source label.

`BagItemCard` replaces `ProductCard` on Bag so unverified catalogue gating and
`VerificationBadge` never appear. Price is shown when the projection has one.

Tapping a row opens `ProductDetailsSheet` with `hideInternalStatus`. Catalogue-backed rows
keep View Product / shopping redirect. Share-imported rows without a catalogue id open the
same sheet without shopping.

---

## 3. States

| State | Copy |
| --- | --- |
| looking | Finding products from your link / Reel / Short… |
| ready | Items appear in Bag; banner dismissed |
| nothing_yet | We couldn't find products in that link yet. |
| couldnt_finish | We couldn't finish that link. Try sharing it again. |
| empty | Your Bag is empty |
| error | Couldn’t load your Bag + Retry |

Empty + in-flight share shows the looking banner, not the empty state. Queue, resolver,
confidence, completeness, “discovered product”, and catalogue status stay off the UI.

Source attribution (`USER_IMPORT` + content source + user import) is kept on the line so a
later Product Page can show the originating Reel.

---

## 4. What this phase does not do

- Product Page / Search redesign
- Merchant price comparison, reviews, related Reels, compare
- A second Bag or saved-products architecture
- Automatic discovered → catalogue promotion

---

## 5. Tests

From the repo root:

```bash
./backend/node_modules/.bin/tsx --test \
  src/ui/bag.test.ts \
  src/ui/bagMembership.test.ts \
  src/services/cartApi.test.ts \
  src/ui/contracts.test.ts \
  src/ui/shareImport.test.ts \
  src/ui/chrome.test.ts
```

From `backend/`:

```bash
./node_modules/.bin/tsx --test \
  src/cart/CartService.test.ts \
  src/cart/domain/lifecycle.test.ts \
  src/user-import/UserImportService.test.ts \
  src/user-import/routes.test.ts
```
