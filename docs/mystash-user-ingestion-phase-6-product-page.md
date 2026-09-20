# Discover Anywhere — Phase 6: Product Page

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 5: [`mystash-user-ingestion-phase-5-bag.md`](./mystash-user-ingestion-phase-5-bag.md).

Phase 6 is the first-class **decision-oriented Product Page**. It is not a specs-first sheet.
Bag navigates here. Collection / Search / Creator keep `ProductDetailsSheet`.

```
GET /products/:id/page?contentSourceId=&userImportId=
  → one ProductPageView (catalogue or share-imported)
app/product/[productId].tsx → ProductPage composition
tap Bag item → /product/:id
```

Priority on the page: buying options → original Reel/Short/page → related media →
reviews → similar products → compare placeholder → description / specs.

---

## 1. Reuse

| Existing | Role |
| --- | --- |
| `ShoppingResolver` + `GET /products/:id/redirect` | Canonical buy authority |
| `ProductHeroImage`, `SpecificationGrid`, `ProductAiReviewCard`, `ProductCard` related | Sections |
| Collection YT/IG embeds | Original source player |
| `fetchProductAiReview` | Catalogue reviews only |
| `searchBlended` | Similar products (no new ranker) |
| Collection tags + `collection_media` | Related Reels already tagged to the product |
| Cart `contentSourceId` / `userImportId` | Original source attribution |

---

## 2. One page DTO

`GET /products/:id/page` resolves the id as a catalogue product, else a discovered
product. The client never receives `verificationStatus`, confidence, completeness,
or catalog/discovered labels. `shoppingProductId` is present only when ShoppingResolver
can own the click.

Offers are an array so Phase 7 can add merchant rows. Phase 6 emits 0–1 offers:
`buy` (catalogue) or `listing` (stored merchant URL on a share-imported product).

Share-imported listing clicks use the same redirect URL with the discovered id.
Canonical clicks still go through `ShoppingResolver`. Discovered products are **not**
written to `catalog_products`.

---

## 3. What this phase does not do

- Multi-merchant comparison engine (Phase 7)
- New review ingestion
- New related-media ranking
- Compare screen
- Search redesign
- Automatic catalogue promotion

---

## 4. Tests

From the repo root:

```bash
./backend/node_modules/.bin/tsx --test \
  src/ui/productPage.test.ts \
  src/ui/bag.test.ts
```

From `backend/`:

```bash
./node_modules/.bin/tsx --test \
  src/product-page/ProductPageService.test.ts \
  src/cart/CartService.test.ts
```
